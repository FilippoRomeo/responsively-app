import {randomBytes, timingSafeEqual} from 'crypto';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import * as pty from 'node-pty';
import {reapStaleTunnels, TunnelManager} from './tunnels';
import {
  clampSize,
  HostMessage,
  HostRequest,
  LineReader,
  MAX_TERMINALS_PER_SESSION,
  Scrollback,
  TerminalInfo,
} from '../../common/terminal';

/**
 * The terminal host: owns every PTY, so a tab outlives its panel and its
 * Session window. Loopback only; a connection must present the token first.
 * Pure Node (no Electron API) so it also runs under a plain test.
 */
interface Conn {
  socket: net.Socket;
  authed: boolean;
  attached: Set<string>;
}
interface Term {
  info: TerminalInfo;
  pty: pty.IPty;
  scrollback: Scrollback;
}

/** node-pty's prebuilt helper loses its executable bit on some installs; it cannot spawn without it. */
const ensureHelperExecutable = () => {
  try {
    const dir = path
      .dirname(require.resolve('node-pty/package.json'))
      .replace('app.asar', 'app.asar.unpacked');
    const prebuilds = path.join(dir, 'prebuilds');
    for (const platform of fs.readdirSync(prebuilds))
      try {
        fs.chmodSync(path.join(prebuilds, platform, 'spawn-helper'), 0o755);
      } catch {
        /* that platform has no helper */
      }
  } catch {
    /* no prebuilds: node-pty was built from source */
  }
};

/** The user's shell gets their environment, not Responsively's own plumbing. */
const shellEnv = (): Record<string, string> => {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env))
    if (v !== undefined && !/^(RESPONSIVELY_|ELECTRON_)/.test(k)) env[k] = v;
  return {...env, TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'Responsively'};
};

const validCwd = (cwd: unknown): string => {
  if (typeof cwd === 'string' && path.isAbsolute(cwd)) {
    try {
      if (fs.statSync(cwd).isDirectory()) return cwd;
    } catch {
      /* fall through to home */
    }
  }
  return os.homedir();
};

export const startTerminalHost = async (opts: {onCount?: (running: number) => void} = {}) => {
  ensureHelperExecutable();
  await reapStaleTunnels();
  const token = randomBytes(32).toString('hex');
  const terms = new Map<string, Term>();
  const conns = new Set<Conn>();
  const counters = new Map<string, number>();
  const tunnels = new TunnelManager((session, tunnel) => {
    conns.forEach((c) => c.authed && send(c, {type: 'tunnel', session, tunnel}));
    reportCount();
  });
  // Anything that must keep the controller alive: running shells and live tunnels.
  const running = () =>
    [...terms.values()].filter((t) => t.info.state === 'running').length + tunnels.active();
  function reportCount() {
    opts.onCount?.(running());
  }

  const send = (c: Conn, m: HostMessage) => {
    if (!c.socket.destroyed) c.socket.write(`${JSON.stringify(m)}\n`);
  };
  const broadcast = (id: string, m: HostMessage) =>
    conns.forEach((c) => c.attached.has(id) && send(c, m));

  const create = (session: string, cwd: unknown, cols: unknown, rows: unknown): TerminalInfo => {
    const count = [...terms.values()].filter((t) => t.info.session === session).length;
    if (count >= MAX_TERMINALS_PER_SESSION)
      throw new Error(
        `A Session can have ${MAX_TERMINALS_PER_SESSION} terminals: close one first.`
      );
    const size = clampSize(cols, rows);
    const dir = validCwd(cwd);
    // Your login shell; tests name a plain one so a prompt-heavy dotfile cannot eat keystrokes.
    const wanted = process.env.RESPONSIVELY_TERMINAL_SHELL || process.env.SHELL;
    const shell = wanted && path.isAbsolute(wanted) ? wanted : '/bin/zsh';
    const id = randomBytes(8).toString('hex');
    const n = (counters.get(session) ?? 0) + 1;
    counters.set(session, n);
    const proc = pty.spawn(shell, ['-l'], {
      name: 'xterm-256color',
      cols: size.cols,
      rows: size.rows,
      cwd: dir,
      env: shellEnv(),
    });
    const info: TerminalInfo = {
      id,
      session,
      title: `${path.basename(shell)} ${n}`,
      cwd: dir,
      state: 'running',
      cols: size.cols,
      rows: size.rows,
    };
    const term: Term = {info, pty: proc, scrollback: new Scrollback()};
    terms.set(id, term);
    proc.onData((data) => {
      term.scrollback.push(data);
      broadcast(id, {type: 'data', id, data});
    });
    proc.onExit(({exitCode}) => {
      term.info.state = 'exited';
      term.info.exitCode = exitCode;
      broadcast(id, {type: 'exit', id, exitCode});
      reportCount();
    });
    reportCount();
    return info;
  };

  const remove = (id: string) => {
    const term = terms.get(id);
    if (!term) return;
    terms.delete(id);
    if (term.info.state === 'running') {
      try {
        term.pty.kill();
      } catch {
        /* already gone */
      }
    }
    broadcast(id, {type: 'closed', id});
    conns.forEach((c) => c.attached.delete(id));
    reportCount();
  };

  const handle = (c: Conn, req: HostRequest) => {
    const reply = (m: HostMessage) => send(c, {...m, reqId: req.reqId} as HostMessage);
    if (req.op === 'auth') {
      const given = Buffer.from(String(req.token));
      const want = Buffer.from(token);
      if (given.length === want.length && timingSafeEqual(given, want)) {
        c.authed = true;
        reply({type: 'ok'});
      } else c.socket.destroy();
      return;
    }
    if (!c.authed) {
      c.socket.destroy();
      return;
    }
    try {
      switch (req.op) {
        case 'list':
          reply({
            type: 'list',
            terminals: [...terms.values()]
              .filter((t) => t.info.session === req.session)
              .map((t) => t.info),
          });
          break;
        case 'create': {
          const info = create(String(req.session), req.cwd, req.cols, req.rows);
          reply({type: 'created', terminal: info});
          break;
        }
        case 'attach': {
          const term = terms.get(req.id);
          if (!term) throw new Error('That terminal is gone.');
          c.attached.add(req.id);
          send(c, {
            type: 'snapshot',
            id: req.id,
            data: term.scrollback.text(),
            terminal: term.info,
          });
          reply({type: 'ok'});
          break;
        }
        case 'detach':
          c.attached.delete(req.id);
          reply({type: 'ok'});
          break;
        case 'input': {
          const term = terms.get(req.id);
          if (term && term.info.state === 'running' && typeof req.data === 'string')
            term.pty.write(req.data);
          break;
        }
        case 'resize': {
          const term = terms.get(req.id);
          if (term && term.info.state === 'running') {
            const size = clampSize(req.cols, req.rows);
            term.pty.resize(size.cols, size.rows);
            term.info.cols = size.cols;
            term.info.rows = size.rows;
          }
          break;
        }
        case 'close':
          remove(req.id);
          reply({type: 'ok'});
          break;
        case 'kill-session':
          [...terms.values()]
            .filter((t) => t.info.session === req.session)
            .forEach((t) => remove(t.info.id));
          tunnels.killSession(req.session);
          reply({type: 'ok'});
          break;
        case 'tunnel-start':
          tunnels
            .start(String(req.session), req.def)
            .then((tunnel) => reply({type: 'tunnels', tunnels: [tunnel]}))
            .catch((e) =>
              reply({type: 'error', message: e instanceof Error ? e.message : String(e)})
            );
          break;
        case 'tunnel-stop':
          tunnels.stop(String(req.id));
          reply({type: 'ok'});
          break;
        case 'tunnel-list':
          reply({type: 'tunnels', tunnels: tunnels.list(String(req.session))});
          break;
        case 'ports':
          tunnels
            .ports(
              String(req.session),
              [...terms.values()]
                .filter((t) => t.info.session === req.session && t.info.state === 'running')
                .map((t) => t.pty.pid)
            )
            .then((ports) => reply({type: 'ports', ports}))
            .catch((e) =>
              reply({type: 'error', message: e instanceof Error ? e.message : String(e)})
            );
          break;
        default:
          throw new Error('Unknown request');
      }
    } catch (e) {
      reply({type: 'error', message: e instanceof Error ? e.message : String(e)});
    }
  };

  const server = net.createServer((socket) => {
    const c: Conn = {socket, authed: false, attached: new Set()};
    conns.add(c);
    const timer = setTimeout(() => !c.authed && socket.destroy(), 3000);
    const reader = new LineReader((line) => {
      let req: HostRequest;
      try {
        req = JSON.parse(line) as HostRequest;
      } catch {
        socket.destroy();
        return;
      }
      handle(c, req);
    });
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      try {
        reader.push(String(chunk));
      } catch {
        socket.destroy();
      }
    });
    socket.on('close', () => {
      clearTimeout(timer);
      conns.delete(c);
    });
    socket.on('error', () => socket.destroy());
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = (server.address() as net.AddressInfo).port;
  return {
    port,
    token,
    terminalCount: () => terms.size,
    activeCount: () => running(),
    stop: () => {
      [...terms.keys()].forEach(remove);
      tunnels.stopAll();
      conns.forEach((c) => c.socket.destroy());
      server.close();
    },
  };
};
