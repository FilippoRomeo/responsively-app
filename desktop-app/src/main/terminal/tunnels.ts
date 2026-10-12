import {spawn, execFile, type ChildProcess} from 'child_process';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import {
  backoffSeconds,
  classifyExit,
  sshArgs,
  validateTunnel,
  type PortInfo,
  type TunnelDef,
  type TunnelInfo,
} from '../../common/tunnel';

interface Run {
  session: string;
  info: TunnelInfo;
  child: ChildProcess | null;
  stderr: string;
  wanted: boolean;
  wasConnected: boolean;
  timers: NodeJS.Timeout[];
}

/** ssh gets the user's environment, not Responsively's or a test runner's Node settings. */
const sshEnv = () => {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env))
    if (!/^(RESPONSIVELY_|ELECTRON_|NODE_OPTIONS$)/.test(k)) env[k] = v;
  return env;
};

const sleepFree = (port: number) =>
  new Promise<boolean>((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
const anyFreePort = () =>
  new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const {port} = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });
const accepts = (port: number) =>
  new Promise<boolean>((resolve) => {
    const socket = net.connect(port, '127.0.0.1');
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });

export const parseLsof = (text: string): {pid: number; command: string; port: number}[] => {
  const out: {pid: number; command: string; port: number}[] = [];
  let pid = 0;
  let command = '';
  for (const line of text.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1));
    else if (line.startsWith('c')) command = line.slice(1);
    else if (line.startsWith('n')) {
      const m = /:(\d+)$/.exec(line);
      if (m && pid) out.push({pid, command, port: Number(m[1])});
    }
  }
  return out;
};

/** The roots and everything they started, from `ps -axo pid=,ppid=` output. */
export const descendants = (ps: string, roots: number[]): Set<number> => {
  const kids = new Map<number, number[]>();
  for (const line of ps.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s*$/.exec(line);
    if (m) kids.set(Number(m[2]), [...(kids.get(Number(m[2])) ?? []), Number(m[1])]);
  }
  const all = new Set<number>(roots);
  const queue = [...roots];
  while (queue.length > 0) {
    for (const k of kids.get(queue.shift()!) ?? []) {
      if (!all.has(k)) {
        all.add(k);
        queue.push(k);
      }
    }
  }
  return all;
};

const run = (cmd: string, args: string[]) =>
  new Promise<string>((resolve) => {
    execFile(cmd, args, {maxBuffer: 4_000_000, timeout: 5000}, (_e, stdout) =>
      resolve(String(stdout ?? ''))
    );
  });

/**
 * ssh processes this host started, kept on disk so a host that was killed
 * (a crash, a force quit) cannot leave a tunnel open: the next one ends them.
 */
const pidFile = () => path.join(os.tmpdir(), `responsively-tunnels-${os.userInfo().uid}.json`);
const readPids = (): number[] => {
  try {
    const v = JSON.parse(fs.readFileSync(pidFile(), 'utf8'));
    return Array.isArray(v) ? v.filter((n) => Number.isInteger(n)) : [];
  } catch {
    return [];
  }
};
const writePids = (pids: number[]) => {
  try {
    fs.writeFileSync(pidFile(), JSON.stringify(pids), {mode: 0o600});
  } catch {
    /* best effort */
  }
};
const remember = (pid: number) => writePids([...new Set([...readPids(), pid])]);
const forget = (pid: number) => writePids(readPids().filter((p) => p !== pid));

/** Ends tunnels a previous host left behind, only if the pid still is one of ours. */
export const reapStaleTunnels = async () => {
  for (const pid of readPids()) {
    const command = (await run('ps', ['-o', 'command=', '-p', String(pid)])).trim();
    if (command.includes('ExitOnForwardFailure=yes') && /\s-N\s/.test(command))
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        /* already gone */
      }
  }
  writePids([]);
};

/**
 * Runs the Mac's own OpenSSH, one foreground process per tunnel. A tunnel is
 * Connected only when its local port accepts a connection and ssh is still alive.
 */
export class TunnelManager {
  private runs = new Map<string, Run>();
  constructor(private readonly onChange: (session: string, info: TunnelInfo) => void) {}

  active() {
    return [...this.runs.values()].filter((r) =>
      ['connecting', 'connected', 'reconnecting'].includes(r.info.state)
    ).length;
  }

  list(session: string): TunnelInfo[] {
    return [...this.runs.values()].filter((r) => r.session === session).map((r) => r.info);
  }

  private set(r: Run, patch: Partial<TunnelInfo>) {
    r.info = {...r.info, ...patch};
    this.onChange(r.session, r.info);
  }

  async start(session: string, def: TunnelDef): Promise<TunnelInfo> {
    const problem = validateTunnel(def);
    if (problem) throw new Error(problem);
    const existing = this.runs.get(def.id);
    if (existing && existing.wanted && existing.session === session) return existing.info;
    if (existing) this.clear(existing);
    const r: Run = {
      session,
      info: {def, state: 'connecting', localPort: def.localPort, attempts: 0},
      child: null,
      stderr: '',
      wanted: true,
      wasConnected: false,
      timers: [],
    };
    this.runs.set(def.id, r);
    this.onChange(session, r.info);
    await this.launch(r);
    return r.info;
  }

  private async launch(r: Run) {
    if (!r.wanted) return;
    let port = r.info.def.localPort;
    if (!(await sleepFree(port))) {
      if (!r.info.def.anyPort) {
        this.set(r, {
          state: 'port-conflict',
          detail: `Port ${port} is already in use on this Mac.`,
        });
        r.wanted = false;
        return;
      }
      port = await anyFreePort();
    }
    r.stderr = '';
    r.wasConnected = false;
    this.set(r, {state: r.info.attempts > 0 ? 'reconnecting' : 'connecting', localPort: port});
    const child = spawn(process.env.RESPONSIVELY_SSH || '/usr/bin/ssh', sshArgs(r.info.def, port), {
      stdio: ['ignore', 'ignore', 'pipe'],
      env: sshEnv(),
    });
    r.child = child;
    if (child.pid) remember(child.pid);
    child.stderr?.on('data', (d) => {
      r.stderr = (r.stderr + String(d)).slice(-2000);
    });
    child.once('error', (e) => {
      if (r.child !== child) return;
      r.child = null;
      r.wanted = false;
      this.set(r, {state: 'failed', detail: e.message});
    });
    child.once('exit', (code) => {
      if (child.pid) forget(child.pid);
      if (r.child !== child) return;
      r.child = null;
      r.timers.forEach(clearTimeout);
      r.timers = [];
      if (!r.wanted) return;
      const verdict = classifyExit(code, r.stderr, r.wasConnected || r.info.attempts > 0);
      if (verdict.state === 'reconnecting') {
        const attempts = r.info.attempts + 1;
        this.set(r, {state: 'reconnecting', detail: verdict.detail, attempts});
        r.timers.push(setTimeout(() => void this.launch(r), backoffSeconds(attempts) * 1000));
      } else {
        r.wanted = false;
        this.set(r, {state: verdict.state, detail: verdict.detail});
      }
    });
    // Connected only on proof: the port accepts and the process lives.
    const started = Date.now();
    const probe = setInterval(async () => {
      if (r.child !== child) {
        clearInterval(probe);
        return;
      }
      if (await accepts(port)) {
        if (r.child !== child || child.exitCode !== null) return;
        clearInterval(probe);
        r.wasConnected = true;
        this.set(r, {state: 'connected', detail: undefined, attempts: 0});
      } else if (Date.now() - started > 30_000) {
        clearInterval(probe);
        r.wanted = false;
        child.kill();
        this.set(r, {state: 'failed', detail: 'No answer from the server within 30 s.'});
      }
    }, 400);
    r.timers.push(probe);
  }

  private clear(r: Run) {
    r.wanted = false;
    r.timers.forEach((t) => {
      clearTimeout(t);
      clearInterval(t);
    });
    r.timers = [];
    const c = r.child;
    r.child = null;
    if (c && c.exitCode === null) c.kill('SIGTERM');
  }

  stop(id: string) {
    const r = this.runs.get(id);
    if (!r) return;
    this.clear(r);
    this.set(r, {state: 'stopped', detail: undefined, attempts: 0});
  }

  killSession(session: string) {
    for (const r of this.runs.values()) if (r.session === session) this.stop(r.info.def.id);
  }

  stopAll() {
    [...this.runs.keys()].forEach((id) => this.stop(id));
  }

  /** Listening ports owned by these shells (and what they started), and this Session's tunnels. */
  async ports(session: string, shellPids: number[]): Promise<PortInfo[]> {
    const [ps, lsof] = await Promise.all([
      run('ps', ['-axo', 'pid=,ppid=']),
      run('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-Fpcn']),
    ]);
    const mine = descendants(ps, shellPids);
    const tunnels = new Map<number, TunnelInfo>();
    for (const r of this.runs.values())
      if (r.session === session && r.child?.pid) tunnels.set(r.child.pid, r.info);
    const seen = new Set<string>();
    const out: PortInfo[] = [];
    for (const l of parseLsof(lsof)) {
      const tunnel = tunnels.get(l.pid);
      if (!tunnel && !mine.has(l.pid)) continue;
      const key = `${l.pid}:${l.port}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        port: l.port,
        pid: l.pid,
        process: tunnel ? 'ssh' : l.command,
        tunnel: tunnel?.def.name,
        source: tunnel ? 'tunnel' : 'terminal',
      });
    }
    return out.sort((a, b) => a.port - b.port);
  }
}
