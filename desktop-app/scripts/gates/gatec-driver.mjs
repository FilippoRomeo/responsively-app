// Gate C (M6) driver: speaks MCP over stdio to a packaged bridge (cli.js) and
// checks that browser tools reach Sessions by UUID, before and after a restart;
// that a stop records who stopped it; that the attention panel appears (you
// answer on the terminal); and that a hung Session can be force quit, and only
// with confirmation. No dependencies. Writes results.json and bridge-stderr.log.
//
// node gatec-m6-driver.mjs --cli <cli.js> --app <App.app> --root <sessions root>
//   --shell-data <dir> --out <dir> --stale-port <port> --expected-exe <path> --log-dir <dir>
import {execFileSync, spawn} from 'child_process';
import fs from 'fs';
import http from 'http';
import path from 'path';
import readline from 'readline';
import {ReadStream as TtyReadStream} from 'tty';

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1 || !process.argv[i + 1]) throw new Error(`missing --${name}`);
  return process.argv[i + 1];
};
// Without questions (an install's own automated run) the three "your answer" steps are
// recorded as skipped, not failed; everything measured still runs.
const NO_QUESTIONS = process.argv.includes('--no-questions');
const CLI = arg('cli');
const APP = arg('app');
const ROOT = arg('root');
const SHELL_DATA = arg('shell-data');
const OUT = arg('out');
const STALE_PORT = arg('stale-port');
const EXPECTED_EXE = arg('expected-exe');

const BROWSER_TOOLS = [
  'get_app_state',
  'navigate',
  'list_devices',
  'set_active_devices',
  'set_device_browser',
  'evaluate',
  'list_addon_tools',
  'call_addon_tool',
  'get_rules',
  'get_prompts',
  'read_page',
  'click',
  'type_text',
  'screenshot',
  'set_conditions',
  'clear_conditions',
  'run_test',
  'list_reports',
  'get_report',
  'get_console',
  'get_network',
  'get_styles',
];
const results = [];
const started = Date.now();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Two local pages with distinct titles, so each Session's content is identifiable.
const page = (title) =>
  new Promise((resolve) => {
    const s = http.createServer((_req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.end(`<!doctype html><title>${title}</title><h1>${title}</h1>`);
    });
    s.listen(0, '127.0.0.1', () =>
      resolve({server: s, url: `http://127.0.0.1:${s.address().port}/`})
    );
  });
const pageA = await page('GATEC-A');
const pageA2 = await page('GATEC-A2');
const pageB = await page('GATEC-B');

const env = {...process.env};
for (const key of Object.keys(env)) if (key.startsWith('RESPONSIVELY_')) delete env[key];
Object.assign(env, {
  RESPONSIVELY_APP_PATH: APP,
  RESPONSIVELY_SESSIONS_ROOT: ROOT,
  RESPONSIVELY_USER_DATA_DIR: SHELL_DATA,
  RESPONSIVELY_MCP_PORT: STALE_PORT,
  // T3 creates its test Sessions; agents' bridges never get this.
  RESPONSIVELY_MCP_ALLOW_CREATE_SESSION: '1',
  RESPONSIVELY_DISABLE_PROTOCOL_REGISTRATION: 'true',
  // The test app's shell and controller log here, not into the installed app's log.
  RESPONSIVELY_LOG_DIR: arg('log-dir'),
  CI: 'true',
});
const child = spawn(process.execPath, [CLI], {env, stdio: ['pipe', 'pipe', 'pipe']});
const stderrLog = fs.createWriteStream(path.join(OUT, 'bridge-stderr.log'));
child.stderr.pipe(stderrLog);
let exited = null;
const pending = new Map();
child.on('exit', (code, signal) => {
  exited = {code, signal};
});
// After its output is fully read, nothing will answer: fail every open request at once.
let closed = false;
child.on('close', () => {
  closed = true;
  for (const resolve of pending.values()) resolve({error: {code: -1, message: 'bridge exited'}});
});
// Writing to a bridge that has exited raises EPIPE; record it instead of crashing.
let stdinError = null;
child.stdin.on('error', (error) => {
  stdinError = error.message;
});

let buffer = '';
child.stdout.on('data', (chunk) => {
  buffer += chunk;
  let i;
  while ((i = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, i).trim();
    buffer = buffer.slice(i + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    pending.get(msg.id)?.(msg);
  }
});
let nextId = 1;
const rpc = (method, params, timeoutMs = 30_000) =>
  new Promise((resolve) => {
    if (exited !== null || !child.stdin.writable) {
      resolve({error: {code: -1, message: 'bridge exited'}});
      return;
    }
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve({timeout: true});
    }, timeoutMs);
    pending.set(id, (msg) => {
      clearTimeout(timer);
      pending.delete(id);
      resolve(msg);
    });
    child.stdin.write(`${JSON.stringify({jsonrpc: '2.0', id, method, params})}\n`);
  });

let interrupted = false;
const call = async (name, args = {}, timeoutMs = 30_000) => {
  // After Ctrl-C only cleanup may talk to the app, so nothing is reopened behind it.
  if (interrupted && name !== 'stop_session') return {ok: false, ms: 0, text: 'interrupted'};
  const t = Date.now();
  const msg = await rpc('tools/call', {name, arguments: args}, timeoutMs);
  const ms = Date.now() - t;
  if (msg.timeout) return {ok: false, ms, timeout: true, text: `timeout after ${timeoutMs}ms`};
  if (msg.error) return {ok: false, ms, text: `rpc error ${msg.error.code}: ${msg.error.message}`};
  const content = msg.result?.content ?? [];
  const text = content
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n');
  const images = content.filter((c) => c.type === 'image').length;
  return {ok: msg.result?.isError !== true, ms, text, images};
};
const json = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

// Questions and progress go to the terminal you started the gate from.
// Answers are read asynchronously, so Ctrl-C is handled even while a question waits.
let tty = null;
let ttyIn = null;
try {
  tty = fs.openSync('/dev/tty', 'w');
  ttyIn = new TtyReadStream(fs.openSync('/dev/tty', 'r'));
} catch {
  tty = null;
  ttyIn = null;
}
const say = (text) => {
  if (tty !== null) fs.writeSync(tty, `${text}\n`);
};
const typed = [];
let waiting = null;
let ttyClosed = ttyIn === null;
if (ttyIn !== null) {
  const lines = readline.createInterface({input: ttyIn, terminal: false});
  lines.on('line', (line) => {
    if (waiting) {
      const resolve = waiting;
      waiting = null;
      resolve(line.trim());
    } else typed.push(line.trim());
  });
  lines.on('close', () => {
    ttyClosed = true;
    waiting?.(null);
    waiting = null;
  });
}
const readTtyLine = () => {
  if (typed.length > 0) return Promise.resolve(typed.shift());
  if (ttyClosed) return Promise.resolve(null);
  return new Promise((resolve) => {
    waiting = resolve;
  });
};
/** Free text you type, recorded as evidence. */
const askText = async (question) => {
  if (tty === null) return 'not asked (no terminal)';
  if (interrupted) return 'not asked (interrupted)';
  say(`\n>>> ${question}`);
  say('    Type your answer, then Return:');
  return (await readTtyLine()) ?? 'no answer';
};
/** A yes/no question you answer; never a pass by itself unless you say yes. */
const ask = async (question) => {
  if (NO_QUESTIONS) return 'skipped';
  if (tty === null) return 'not asked (no terminal)';
  if (interrupted) return 'not asked (interrupted)';
  say(`\n>>> ${question}`);
  for (;;) {
    say('    Type y or n, then Return:');
    const answer = await readTtyLine();
    if (answer === null) return 'no answer';
    if (/^y(es)?$/i.test(answer)) return 'yes';
    if (/^no?$/i.test(answer)) return 'no';
  }
};

const record = (step, pass, detail) => {
  results.push({step, pass, atMs: Date.now() - started, ...detail});
  process.stderr.write(`[gatec] ${pass ? 'PASS' : 'FAIL'} ${step}\n`);
  say(`[gatec] ${pass ? 'PASS' : 'FAIL'} ${step}`);
  return pass;
};

// The test controller's own authenticated endpoint (only inside the test root).
const controllerCall = async (payload, timeoutMs = 60_000) => {
  if (interrupted) return {ok: false, error: 'interrupted'};
  try {
    const endpoint = JSON.parse(fs.readFileSync(path.join(ROOT, 'controller.json'), 'utf8'));
    return await new Promise((resolve) => {
      const body = JSON.stringify(payload);
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: endpoint.port,
          method: 'POST',
          path: '/',
          headers: {
            authorization: `Bearer ${endpoint.token}`,
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(body),
          },
        },
        (res) => {
          let data = '';
          res.on('data', (c) => {
            data += c;
          });
          res.on('end', () => {
            let value = null;
            try {
              value = JSON.parse(data);
            } catch {
              value = data;
            }
            resolve(
              res.statusCode === 200 ? {ok: true, value} : {ok: false, error: value?.error ?? data}
            );
          });
        }
      );
      req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
      req.on('error', (error) => resolve({ok: false, error: error.message}));
      req.end(body);
    });
  } catch (error) {
    return {ok: false, error: error.message};
  }
};
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
};
const leaseOf = (id) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'runtimes', `${id}.json`), 'utf8'));
  } catch {
    return null;
  }
};
// Same regex as src/main/sessions/process-proof.ts at a109e9a.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const parsePs = (output) => {
  const m =
    /^\w{3} (?:(\w{3}) +(\d{1,2})|(\d{1,2}) (\w{3})) (\d{2}):(\d{2}):(\d{2}) (\d{4}) +(.+)$/.exec(
      output.trim()
    );
  if (!m) return null;
  const [, mf, da, df, ma, hh, mi, ss, yy, exe] = m;
  const month = MONTHS.indexOf(mf ?? ma);
  if (month < 0) return null;
  const at = new Date(Number(yy), month, Number(da ?? df), Number(hh), Number(mi), Number(ss));
  return {startedAt: at.toISOString(), executable: exe.trim()};
};
const ps = (pid, args, env) => {
  try {
    return execFileSync('/bin/ps', [...args, '-p', String(pid)], {
      encoding: 'utf8',
      timeout: 3000,
      env,
    });
  } catch (error) {
    return `ps failed: ${error.message}`;
  }
};
let frozenPid = null;
/** The app macOS has in front, by name and pid; no permission needed. */
const frontApp = () => {
  try {
    const asn = execFileSync('/usr/bin/lsappinfo', ['front'], {
      encoding: 'utf8',
      timeout: 3000,
    }).trim();
    const only = (key) =>
      execFileSync('/usr/bin/lsappinfo', ['info', '-only', key, asn], {
        encoding: 'utf8',
        timeout: 3000,
      });
    const info = `${only('name')}\n${only('pid')}`;
    const name = /"LSDisplayName"="([^"]*)"/.exec(info)?.[1] ?? null;
    const pid = Number(/"pid"\s*=\s*(\d+)/.exec(info)?.[1]) || null;
    return {asn, name, pid, raw: info.trim()};
  } catch (error) {
    return {error: error.message};
  }
};

// Browser calls right after an Open can race the runtime's window; retry briefly.
const callUntil = async (name, args, accept, deadlineMs = 45_000) => {
  const end = Date.now() + deadlineMs;
  let last;
  do {
    last = await call(name, args, 40_000);
    if (accept(last)) return last;
    await sleep(1500);
  } while (Date.now() < end);
  return last;
};

const shellQuit = async () => {
  try {
    const endpoint = JSON.parse(fs.readFileSync(path.join(ROOT, 'shell.json'), 'utf8'));
    await new Promise((resolve, reject) => {
      const body = JSON.stringify({operation: 'quit'});
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: endpoint.port,
          method: 'POST',
          path: '/',
          headers: {
            authorization: `Bearer ${endpoint.token}`,
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(body),
          },
        },
        (res) => {
          res.resume();
          res.on('end', resolve);
        }
      );
      req.setTimeout(5000, () => req.destroy(new Error('timeout')));
      req.on('error', reject);
      req.end(body);
    });
    return 'quit requested';
  } catch (error) {
    return `no shell quit: ${error.message}`;
  }
};

const ids = {};
let finishing = false;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    interrupted = true;
    record(`interrupted by ${signal}`, false, {});
    void finish();
  });
}
try {
  const init = await rpc('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: {name: 'gatec-m6-driver', version: '1'},
  });
  child.stdin.write(`${JSON.stringify({jsonrpc: '2.0', method: 'notifications/initialized'})}\n`);
  record('T0 initialize', Boolean(init.result), {
    server: init.result?.serverInfo,
    error: init.error,
  });

  const list = await rpc('tools/list', {});
  const tools = list.result?.tools ?? [];
  const withSession = tools
    .filter((t) => t.inputSchema?.properties?.session)
    .map((t) => t.name)
    .sort();
  record(
    'T1 tools/list: session argument on all 22 browser tools',
    JSON.stringify(withSession) === JSON.stringify([...BROWSER_TOOLS].sort()),
    {withSession, toolCount: tools.length}
  );

  // The controller may take a while to start cold; list_sessions starts it.
  let listed;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    listed = await call('list_sessions', {}, 60_000);
    if (listed.ok) break;
    await sleep(5000);
  }
  const existing = json(listed.text);
  const isolated = record(
    'T2 isolated registry is empty (your real Sessions are not visible)',
    listed.ok && Array.isArray(existing) && existing.length === 0,
    {ms: listed.ms, text: listed.text}
  );
  // Never create anything unless the registry is provably the isolated one.
  if (!isolated)
    throw new Error('ABORT: registry is not the empty test registry; nothing was created');

  for (const [key, url] of [
    ['A', pageA.url],
    ['B', pageB.url],
  ]) {
    const created = await call(
      'create_session',
      {name: `gatec-m6-${key}`, url, open: true},
      120_000
    );
    const info = json(created.text);
    ids[key] = info?.id;
    record(`T3 create_session ${key} opens and runs`, created.ok && info?.status === 'running', {
      ms: created.ms,
      id: info?.id,
      status: info?.status,
      mcpPort: info?.runtime?.mcpPort,
      text: created.ok ? undefined : created.text,
    });
  }

  const runtimeOf = async (key) =>
    json((await call('get_session', {id: ids[key]})).text)?.runtime ?? {};
  const runtimeA1 = await runtimeOf('A');
  const portA1 = runtimeA1.mcpPort;
  const portB = (await runtimeOf('B')).mcpPort;
  record(
    'T4 two Sessions have distinct verified MCP ports',
    Number.isInteger(portA1) && Number.isInteger(portB) && portA1 !== portB,
    {portA1, portB, stalePortInBridgeConfig: Number(STALE_PORT)}
  );

  const stateUrl = (r) => json(r.text)?.url ?? '';
  const onPage = (target) => (r) => r.ok && stateUrl(r).startsWith(target);
  const stA = await callUntil('get_app_state', {session: ids.A}, onPage(pageA.url));
  record('T5a get_app_state {session:A} reaches A', onPage(pageA.url)(stA), {
    ms: stA.ms,
    url: stateUrl(stA),
    text: stA.ok ? undefined : stA.text,
  });
  const stB = await callUntil('get_app_state', {session: ids.B}, onPage(pageB.url));
  record('T5b get_app_state {session:B} reaches B', onPage(pageB.url)(stB), {
    ms: stB.ms,
    url: stateUrl(stB),
    text: stB.ok ? undefined : stB.text,
  });

  const nav = await call('navigate', {session: ids.A, url: pageA2.url}, 60_000);
  const afterA = await call('get_app_state', {session: ids.A});
  const afterB = await call('get_app_state', {session: ids.B});
  record(
    'T6 navigate {session:A} changes A only',
    nav.ok && onPage(pageA2.url)(afterA) && onPage(pageB.url)(afterB),
    {
      navMs: nav.ms,
      nav: nav.ok ? undefined : nav.text,
      aUrl: stateUrl(afterA),
      bUrl: stateUrl(afterB),
    }
  );

  const shot = await call('screenshot', {session: ids.B}, 60_000);
  record(
    "T7 screenshot {session:B} returns an image of B's page",
    shot.ok && shot.images > 0 && shot.text.includes(pageB.url),
    {
      ms: shot.ms,
      images: shot.images,
      labels: shot.text,
    }
  );

  const stopped = await call('stop_session', {id: ids.A}, 60_000);
  record('T8a stop_session A', stopped.ok && json(stopped.text)?.status === 'stopped', {
    ms: stopped.ms,
    text: stopped.ok ? undefined : stopped.text,
  });
  const afterStop = json((await call('get_session', {id: ids.A})).text);
  record(
    'T8c M6: stop_session through MCP records "stopped by an agent"',
    afterStop?.lastStop?.by === 'agent',
    {
      lastStop: afterStop?.lastStop,
    }
  );
  // M6 attention: the gate measures focus itself; you only look.
  if (tty !== null) {
    say('\n>>> Next the gate makes an agent call a stopped Session, which shows you a panel.');
    say(
      '    Click in this Terminal window, press Return, then do not touch the mouse or keyboard until asked.'
    );
    await readTtyLine();
  }
  await sleep(1500);
  const frontBefore = frontApp();
  const refused = await call('get_app_state', {session: ids.A}, 30_000);
  record(
    'T8b browser call to stopped A fails fast with a clear message',
    !refused.ok && /is stopped/.test(refused.text) && refused.ms < 5000,
    {ms: refused.ms, text: refused.text}
  );
  await sleep(3000);
  const frontAfter = frontApp();
  record(
    'T8d M6: the attention panel did not take focus (front app unchanged, measured)',
    Boolean(frontBefore.pid) &&
      frontBefore.pid === frontAfter.pid &&
      frontBefore.name === frontAfter.name,
    {frontBefore, frontAfter}
  );
  say('Do not click anything yet.');
  const q3 = await ask(
    'Without clicking anything: is there a "!" next to the test app\'s icon in the menu bar (look on every monitor)?'
  );
  const answered = (value) => value === 'yes' || (NO_QUESTIONS && value === 'skipped');
  record('Q3 M6: menu-bar attention badge (your answer)', answered(q3), {answer: q3});
  const q1 = await ask(
    'Did a Sessions panel appear by itself, saying "gatec-m6-A" needs attention and "Stopped by an agent", with Open, Reset… and Delete… buttons? (It may be on another monitor.)'
  );
  record(
    'Q1 M6: attention panel appeared with the reason and actions (your answer)',
    answered(q1),
    {answer: q1}
  );
  say('Now click Dismiss in that panel (not Open). Then find the window titled "gatec-m6-B".');
  const q4 = await ask(
    'In the "gatec-m6-B" window, the Session name is in its tab at the top (no longer on the toolbar). Click ⋮ at the right end of the toolbar, then "Manage Sessions…". Does the tab read "gatec-m6-B", and does a Sessions list open that includes "gatec-m6-B"? (Press Esc to close it.)'
  );
  const q4detail = {answer: q4};
  if (q4 !== 'yes' && !NO_QUESTIONS) {
    q4detail.saw = await askText(
      'What did you see instead? (for example: "tab reads Sessions", "no Manage Sessions in ⋮", "list empty")'
    );
    const shot = await askText(
      'To save a picture of that window: type y, then click the "gatec-m6-B" window. macOS may ask to allow Screen Recording for Terminal; allowing it is optional. Type n to skip.'
    );
    if (/^y/i.test(shot)) {
      const file = path.join(OUT, 'q4-window.png');
      try {
        execFileSync('/usr/sbin/screencapture', ['-W', '-o', file], {
          stdio: 'ignore',
          timeout: 120_000,
        });
        q4detail.screenshot = fs.existsSync(file) ? 'q4-window.png' : 'not saved';
      } catch (error) {
        q4detail.screenshot = `failed: ${error.message}`;
      }
    }
  }
  record(
    'Q4 M2: the tab names the Session and ⋮ › Manage Sessions… lists it (your answer)',
    answered(q4),
    q4detail
  );
  say('Thanks. The gate continues on its own now; keep this window open.');

  const reopened = await call('open_session', {id: ids.A}, 120_000);
  record('T9a open_session A', reopened.ok && json(reopened.text)?.status === 'running', {
    ms: reopened.ms,
    text: reopened.ok ? undefined : reopened.text,
  });
  const runtimeA2 = await runtimeOf('A');
  const again = await callUntil('get_app_state', {session: ids.A}, (r) => r.ok);
  // A new PID proves the call reached the restarted process; the port may or may not change.
  const newProcess = Number.isInteger(runtimeA2.pid) && runtimeA2.pid !== runtimeA1.pid;
  record(
    'T9b same UUID reaches the restarted A process, no config change',
    again.ok && newProcess,
    {
      pidBefore: runtimeA1.pid,
      pidAfter: runtimeA2.pid,
      portBefore: portA1,
      portAfter: runtimeA2.mcpPort,
      portChanged: portA1 !== runtimeA2.mcpPort,
      url: stateUrl(again),
      ms: again.ms,
      text: again.ok ? undefined : again.text,
    }
  );

  // M6 force quit, on test Session B only.
  const leaseB = leaseOf(ids.B);
  const pidB = leaseB?.pid;
  const cEnv = {...process.env, LC_ALL: 'C'};
  const raw = {
    appCommand: ps(pidB, ['-ww', '-o', 'lstart=', '-o', 'comm='], cEnv),
    yourLocale: ps(pidB, ['-o', 'lstart=', '-o', 'comm=']),
  };
  const facts = raw.appCommand.startsWith('ps failed') ? null : parsePs(raw.appCommand);
  const skewMs =
    facts && leaseB ? Math.abs(Date.parse(facts.startedAt) - Date.parse(leaseB.startedAt)) : null;
  const provenB =
    Boolean(facts) && facts.executable === EXPECTED_EXE && skewMs !== null && skewMs <= 10_000;
  record(
    'T10a M6: ps from a non-terminal process gives the full app path and a start time within 10 s of the lease',
    provenB,
    {pid: pidB, leaseStartedAt: leaseB?.startedAt, facts, expectedExe: EXPECTED_EXE, skewMs, raw}
  );

  // Pause only a PID proven to be test Session B: an unproven one may be any process of yours.
  // Never after Ctrl-C: cleanup has already passed its resume step.
  if (!interrupted && provenB && Number.isInteger(pidB) && alive(pidB)) {
    process.kill(pidB, 'SIGSTOP'); // Paused: alive but not answering, exactly a hang.
    frozenPid = pidB;
  }
  let hungInfo = null;
  for (let i = 0; i < 20 && !hungInfo?.hung; i += 1) {
    await sleep(1000);
    hungInfo = json((await call('get_session', {id: ids.B}, 30_000)).text);
  }
  record(
    'T10b M6: a paused runtime is reported as hung',
    hungInfo?.hung === true && hungInfo?.status === 'error',
    {
      status: hungInfo?.status,
      hung: hungInfo?.hung,
      error: hungInfo?.error,
    }
  );

  const unconfirmed = await controllerCall({operation: 'force-stop', id: ids.B});
  record(
    'T10c M6: force quit without confirmation is refused and signals nothing',
    !unconfirmed.ok && /confirmation/.test(String(unconfirmed.error)) && alive(pidB),
    {error: unconfirmed.error, stillAlive: alive(pidB)}
  );

  const t = Date.now();
  const forced = await controllerCall({operation: 'force-stop', id: ids.B, confirmed: true});
  const forcedMs = Date.now() - t;
  if (!alive(pidB)) frozenPid = null;
  const afterForce = json((await call('get_session', {id: ids.B})).text);
  record(
    'T10d M6: confirmed force quit ends the process, removes its lease, records "user"',
    forced.ok &&
      !alive(pidB) &&
      leaseOf(ids.B) === null &&
      afterForce?.status === 'stopped' &&
      afterForce?.lastStop?.by === 'user',
    {
      ms: forcedMs,
      result: forced.ok ? forced.value?.status : forced.error,
      stillAlive: alive(pidB),
      leaseLeft: leaseOf(ids.B) !== null,
      status: afterForce?.status,
      lastStop: afterForce?.lastStop,
    }
  );
  const refusedB = await call('get_app_state', {session: ids.B}, 30_000);
  record(
    'T10e after force quit, a browser call to B fails fast as stopped',
    !refusedB.ok && /is stopped/.test(refusedB.text),
    {
      ms: refusedB.ms,
      text: refusedB.text,
    }
  );
} catch (error) {
  record('driver exception', false, {error: String(error?.stack ?? error)});
} finally {
  await finish();
}

// Runs once, on normal completion or on Ctrl-C / SIGTERM.
async function finish() {
  if (finishing) return;
  finishing = true;
  const cleanup = {};
  // Never leave a test process paused: resume it so the normal stop can end it.
  if (frozenPid !== null && alive(frozenPid)) {
    process.kill(frozenPid, 'SIGCONT');
    cleanup.resumed = frozenPid;
    await sleep(2000);
  }
  for (const key of Object.keys(ids)) {
    if (ids[key]) cleanup[`stop ${key}`] = (await call('stop_session', {id: ids[key]}, 60_000)).ok;
  }
  cleanup.shell = await shellQuit();
  child.stdin.end();
  await sleep(1000);
  if (exited === null) child.kill();
  for (let i = 0; i < 30 && !closed; i += 1) await sleep(100);
  for (const p of [pageA, pageA2, pageB]) p.server.close();
  const summary = {
    passed: results.filter((r) => r.pass).length,
    failed: results.filter((r) => !r.pass).length,
    total: results.length,
  };
  fs.writeFileSync(
    path.join(OUT, 'results.json'),
    JSON.stringify({summary, ids, cleanup, bridgeExit: exited, stdinError, results}, null, 2)
  );
  process.stderr.write(`[gatec] ${summary.passed}/${summary.total} passed\n`);
  // Let the bridge's last stderr lines reach the log before exiting (at most 3 s).
  await new Promise((resolve) => {
    if (stderrLog.writableFinished) return resolve();
    stderrLog.once('finish', resolve);
    setTimeout(resolve, 3000);
    child.stderr.unpipe(stderrLog);
    if (!stderrLog.writableEnded) stderrLog.end();
  });
  ttyIn?.destroy();
  if (tty !== null) fs.closeSync(tty);
  process.exit(summary.failed === 0 && summary.total > 0 ? 0 : 1);
}
