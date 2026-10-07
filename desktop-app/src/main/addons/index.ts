import {ChildProcess, execFile, spawn} from 'child_process';
import {app, BrowserWindow, ipcMain, session, WebContents} from 'electron';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {promisify} from 'util';
import log from 'electron-log';
import {IPC_MAIN_CHANNELS} from '../../common/constants';
import {
  Addon,
  AddonLog,
  AddonPart,
  AddonsRequest,
  AddonsState,
  matchesSite,
  partOn,
  SIX_MONTHS_MS,
  Stack,
} from '../../common/addons';
import store from '../../store';
import {atomicWrite} from '../sessions/registry';
import {sessionsRoot} from '../sessions/service';
import {isRegisteredWebview} from '../webview-registry';

const exec = promisify(execFile);

// Installed add-ons and stacks are shared by every Session (one library in
// the Sessions root); which stack a window uses is that window's own setting.
const root = () => path.join(sessionsRoot(), 'addons');
const libraryFile = () => path.join(root(), 'library.json');
const stagingDir = (id: string) => path.join(root(), '.staging', id);
const DEFAULT_STACK: Stack = {id: 'default', name: 'Default', addons: {}};

type Library = {addons: Addon[]; stacks: Stack[]; autoCleanup: boolean};

const readLibrary = (): Library => {
  try {
    const lib = JSON.parse(fs.readFileSync(libraryFile(), 'utf8')) as Library;
    if (!lib.stacks.some((s) => s.id === DEFAULT_STACK.id)) lib.stacks.unshift(DEFAULT_STACK);
    return lib;
  } catch {
    return {addons: [], stacks: [DEFAULT_STACK], autoCleanup: true};
  }
};

// Read, change, write in one go: other Sessions write the same file.
const updateLibrary = (change: (lib: Library) => void) => {
  const lib = readLibrary();
  change(lib);
  atomicWrite(libraryFile(), lib);
  BrowserWindow.getAllWindows().forEach((w) =>
    w.webContents.send(IPC_MAIN_CHANNELS.ADDONS_CHANGED)
  );
  syncStarts();
  return lib;
};

const stackId = (): string => (store.get('addons.stackId') as string | undefined) ?? 'default';
const currentStack = (lib: Library) => lib.stacks.find((s) => s.id === stackId()) ?? lib.stacks[0];

const state = (): AddonsState => {
  const lib = readLibrary();
  return {...lib, stackId: currentStack(lib).id};
};

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'addon';

const uniqueId = (base: string) => {
  const taken = new Set(readLibrary().addons.map((a) => a.id));
  let id = slug(base);
  for (let n = 2; taken.has(id); n += 1) id = `${slug(base)}-${n}`;
  return id;
};

const readJson = (file: string) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
};

/** What a source folder already offers, used as it is. */
const detect = (dir: string) => {
  const pkg = readJson(path.join(dir, 'package.json'));
  // Browser bundles a package declares, then a classic-script `main`
  // (proposed only: the user reviews every part before installing).
  const classicMain =
    pkg?.type !== 'module' && typeof pkg?.main === 'string' && /\.js$/.test(pkg.main)
      ? pkg.main
      : undefined;
  const declared = [
    pkg?.unpkg,
    pkg?.jsdelivr,
    typeof pkg?.browser === 'string' ? pkg.browser : undefined,
  ];
  const dist = path.join(dir, 'dist');
  const built = fs.existsSync(dist)
    ? fs
        .readdirSync(dist)
        .filter((f) => f.endsWith('.js'))
        .sort((a, b) => Number(b.endsWith('.min.js')) - Number(a.endsWith('.min.js')))
        .map((f) => `dist/${f}`)
    : [];
  const script = [...declared, ...built, classicMain].find(
    (f) => typeof f === 'string' && fs.existsSync(path.join(dir, f))
  );
  const parts: AddonPart[] = script
    ? [{id: 'script', kind: 'script', label: 'Page script', file: script, matches: ['localhost:*']}]
    : [];
  return {
    name: (pkg?.name as string | undefined) ?? path.basename(dir),
    about: (pkg?.description as string | undefined) ?? '',
    parts,
    buildCommand: !script && pkg?.scripts?.build ? 'npm install && npm run build' : undefined,
  };
};

const inspect = async (raw: string): Promise<Addon> => {
  const source = raw.trim();
  const now = new Date().toISOString();
  const base = {source, installedAt: now, lastUsedAt: now, permissions: [] as string[]};
  const github = source.match(
    /^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$|^([\w.-]+)\/([\w.-]+)$/
  );
  const npm = source.match(/^npm:(.+)$|^(?:https?:\/\/)?(?:www\.)?npmjs\.com\/package\/(.+?)\/?$/);
  const folder = source.replace(/^~(?=\/)/, os.homedir());

  if (/^https?:\/\//i.test(source) && !github && !npm) {
    const url = new URL(source);
    return {
      ...base,
      id: uniqueId(url.host),
      name: url.host,
      about: `The web app at ${url.origin}, in its own tab beside the previews.`,
      sourceKind: 'url',
      parts: [{id: 'panel', kind: 'panel', label: 'Panel', url: url.href}],
    };
  }
  if (path.isAbsolute(folder) && fs.existsSync(folder)) {
    const found = detect(folder);
    return {...base, ...found, id: uniqueId(found.name), sourceKind: 'folder', dir: folder};
  }
  if (github) {
    const owner = github[1] ?? github[3];
    const repo = github[2] ?? github[4];
    const id = uniqueId(repo);
    const dir = stagingDir(id);
    fs.rmSync(dir, {recursive: true, force: true});
    fs.mkdirSync(path.dirname(dir), {recursive: true});
    // gh uses the user's GitHub sign-in, so private repos work too.
    await exec('gh', ['repo', 'clone', `${owner}/${repo}`, dir, '--', '--depth', '1']);
    const found = detect(dir);
    return {...base, ...found, name: repo, id, sourceKind: 'github', dir};
  }
  if (npm) {
    const name = npm[1] ?? npm[2];
    const id = uniqueId(name);
    const dir = stagingDir(id);
    fs.rmSync(dir, {recursive: true, force: true});
    fs.mkdirSync(dir, {recursive: true});
    const {stdout} = await exec('npm', ['pack', name, '--pack-destination', dir, '--silent']);
    await exec('tar', ['-xzf', path.join(dir, stdout.trim().split('\n').pop() ?? ''), '-C', dir]);
    const found = detect(path.join(dir, 'package'));
    return {...base, ...found, id, sourceKind: 'npm', dir: path.join(dir, 'package')};
  }
  throw new Error(
    'Paste a web address, a GitHub repo (owner/repo), npm:<package> or a folder path'
  );
};

const permissionsFor = (addon: Addon) => [
  ...addon.parts.flatMap((p): string[] => {
    if (p.kind === 'panel') return [`Show ${new URL(p.url).origin} inside Responsively`];
    if (p.kind === 'script') return [`Run its code in previews on ${p.matches.join(', ')}`];
    return [`Run "${p.command}" on this Mac`];
  }),
  ...(addon.buildCommand ? [`Run "${addon.buildCommand}" to build it`] : []),
];

const install = (addon: Addon) => {
  let {dir} = addon;
  const staging = path.join(root(), '.staging') + path.sep;
  if (dir?.startsWith(staging)) {
    const target = path.join(root(), addon.id);
    const top = path.join(staging, path.relative(staging, dir).split(path.sep)[0]);
    fs.rmSync(target, {recursive: true, force: true});
    fs.renameSync(top, target);
    dir = path.join(target, path.relative(top, dir));
  }
  const saved = {...addon, dir, permissions: permissionsFor(addon)};
  updateLibrary((lib) => {
    lib.addons = [...lib.addons.filter((a) => a.id !== addon.id), saved];
    const stack = currentStack(lib);
    stack.addons[addon.id] = {enabled: true, off: {}};
  });
  return saved;
};

// Only folders Responsively made are ever deleted; a folder add-on stays.
const ownsDir = (addon: Addon) =>
  addon.dir !== undefined && addon.dir.startsWith(path.join(root(), path.sep).slice(0, -1));

const uninstall = async (id: string) => {
  const addon = readLibrary().addons.find((a) => a.id === id);
  if (!addon) return;
  stopStarts((key) => key.startsWith(`${id}:`));
  if (ownsDir(addon)) fs.rmSync(path.join(root(), addon.id), {recursive: true, force: true});
  await session.fromPartition(`persist:addon-${id}`).clearStorageData();
  updateLibrary((lib) => {
    lib.addons = lib.addons.filter((a) => a.id !== id);
    lib.stacks.forEach((s) => {
      delete s.addons[id];
    });
  });
};

const dirBytes = async (dir: string) => {
  try {
    const {stdout} = await exec('du', ['-sk', dir]);
    return Number(stdout.split('\t')[0]) * 1024;
  } catch {
    return 0;
  }
};

// Build commands run in a login shell so the user's PATH (node, conda,
// python) is there; output streams to the window that asked.
let runCount = 0;
const run = (sender: WebContents, addon: {dir?: string}, command: string) => {
  runCount += 1;
  const runId = `run-${runCount}`;
  const send = (entry: Omit<AddonLog, 'runId'>) => {
    if (!sender.isDestroyed()) sender.send(IPC_MAIN_CHANNELS.ADDONS_LOG, {runId, ...entry});
  };
  const child = spawn(process.env.SHELL || '/bin/zsh', ['-lc', command], {
    cwd: addon.dir,
    env: process.env,
  });
  child.stdout.on('data', (d) => send({text: d.toString()}));
  child.stderr.on('data', (d) => send({text: d.toString()}));
  child.on('error', (e) => send({text: `${e.message}\n`, done: true, code: null}));
  child.on('close', (code) => send({text: '', done: true, code}));
  return runId;
};

// Start commands (the app a panel shows): run while a window using them is
// open, skipped when their address already answers (e.g. another Session).
const starts = new Map<string, ChildProcess>();
const stopStarts = (which: (key: string) => boolean = () => true) => {
  starts.forEach((child, key) => {
    if (!which(key)) return;
    child.kill();
    starts.delete(key);
  });
};
const answers = async (url?: string) => {
  if (!url) return false;
  try {
    await fetch(url, {method: 'HEAD', signal: AbortSignal.timeout(1000)});
    return true;
  } catch {
    return false;
  }
};
const syncStarts = () => {
  const lib = readLibrary();
  const stack = currentStack(lib);
  const wanted = new Set<string>();
  lib.addons.forEach((addon) =>
    addon.parts.forEach((part) => {
      if (part.kind !== 'start' || !partOn(stack, addon.id, part.id)) return;
      const key = `${addon.id}:${part.id}`;
      wanted.add(key);
      if (starts.has(key)) return;
      answers(part.url)
        .then((up) => {
          if (up || starts.has(key)) return;
          const out = fs.openSync(path.join(addon.dir ?? os.tmpdir(), `${part.id}.log`), 'a');
          const child = spawn(process.env.SHELL || '/bin/zsh', ['-lc', part.command], {
            cwd: addon.dir,
            stdio: ['ignore', out, out],
          });
          child.on('exit', () => starts.delete(key));
          starts.set(key, child);
          return undefined;
        })
        .catch(() => {});
    })
  );
  stopStarts((key) => !wanted.has(key));
};

// Page scripts: read fresh on each page load, so changes made in another
// Session apply on the next load. Marks the add-on used (at most daily).
const pageScripts = (url: string) => {
  const lib = readLibrary();
  const stack = currentStack(lib);
  const used: string[] = [];
  const code = lib.addons.flatMap((addon) =>
    addon.parts.flatMap((part) => {
      if (part.kind !== 'script' || !partOn(stack, addon.id, part.id)) return [];
      if (!addon.dir || !matchesSite(part.matches, url)) return [];
      try {
        used.push(addon.id);
        const code = fs.readFileSync(path.join(addon.dir, part.file), 'utf8');
        const full = part.init ? `${code}\n;${part.init}` : code;
        if (part.when === 'start') return [full];
        // Global-scope eval keeps the script's top-level names on window.
        return [
          `(() => { const run = () => (0, eval)(${JSON.stringify(full)}); ` +
            `if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, {once: true}); else run(); })();`,
        ];
      } catch (error) {
        log.warn('[addons] page script unreadable', addon.id, error);
        return [];
      }
    })
  );
  const day = Date.now() - 24 * 60 * 60 * 1000;
  if (used.some((id) => Date.parse(lib.addons.find((a) => a.id === id)!.lastUsedAt) < day)) {
    updateLibrary((l) =>
      l.addons.forEach((a) => {
        if (used.includes(a.id)) a.lastUsedAt = new Date().toISOString();
      })
    );
  }
  return code;
};

const handle = async (sender: WebContents, req: AddonsRequest): Promise<unknown> => {
  switch (req.operation) {
    case 'state':
      return state();
    case 'inspect':
      return inspect(req.source);
    case 'install':
      return install(req.addon);
    case 'cancel-install':
      fs.rmSync(stagingDir(req.id), {recursive: true, force: true});
      return {done: true};
    case 'run': {
      // A source being inspected is not in the library yet: its folder is
      // the one inspect returned (staging, or the user's own folder).
      const installed = readLibrary().addons.find((a) => a.id === req.id);
      const dir = installed?.dir ?? req.dir;
      if (!dir || !fs.existsSync(dir)) throw new Error('Unknown add-on folder');
      return {runId: run(sender, {dir}, req.command)};
    }
    case 'uninstall':
      await uninstall(req.id);
      return {done: true};
    case 'use-stack':
      store.set('addons.stackId', req.stackId);
      updateLibrary(() => {});
      return state();
    case 'save-stack': {
      const lib = updateLibrary((l) => {
        const from = currentStack(l);
        const id = uniqueId(`stack-${req.name}`);
        l.stacks.push({id, name: req.name, addons: structuredClone(from.addons)});
        store.set('addons.stackId', id);
      });
      return {...lib, stackId: stackId()};
    }
    case 'set-enabled':
      updateLibrary((lib) => {
        const stack = currentStack(lib);
        stack.addons[req.addonId] = {
          ...(stack.addons[req.addonId] ?? {off: {}}),
          enabled: req.enabled,
        };
      });
      return state();
    case 'set-part':
      updateLibrary((lib) => {
        const entry = currentStack(lib).addons[req.addonId];
        if (entry) entry.off[req.partId] = !req.on;
      });
      return state();
    case 'sizes': {
      const {addons} = readLibrary();
      const sizes = await Promise.all(
        addons.map(async (a) => [a.id, a.dir && ownsDir(a) ? await dirBytes(a.dir) : 0])
      );
      return Object.fromEntries(sizes);
    }
    case 'set-auto-cleanup':
      updateLibrary((lib) => {
        lib.autoCleanup = req.on;
      });
      return state();
    case 'stale': {
      const lib = readLibrary();
      if (!lib.autoCleanup) return [];
      return lib.addons.filter((a) => Date.now() - Date.parse(a.lastUsedAt) > SIX_MONTHS_MS);
    }
    case 'keep':
      updateLibrary((lib) =>
        lib.addons.forEach((a) => {
          if (a.id === req.id) a.lastUsedAt = new Date().toISOString();
        })
      );
      return state();
    default:
      throw new Error('Unknown operation');
  }
};

export const initAddonsHandlers = () => {
  ipcMain.handle(IPC_MAIN_CHANNELS.ADDONS, (event, req: AddonsRequest) =>
    handle(event.sender, req)
  );
  // Preview preloads ask synchronously so scripts run before the page's own.
  ipcMain.on(IPC_MAIN_CHANNELS.ADDONS_PAGE_SCRIPTS, (event, url: string) => {
    event.returnValue = isRegisteredWebview(event.sender.id) ? pageScripts(url) : [];
  });
  app
    .whenReady()
    .then(syncStarts)
    .catch(() => {});
  app.on('will-quit', () => stopStarts());
};
