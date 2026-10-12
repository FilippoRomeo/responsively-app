/**
 * Saved SSH tunnels (remote service → this Mac's loopback) and the local ports
 * the Session's terminals have opened. Pure: validation, the exact ssh
 * command line, and how an exit is read.
 */
export interface TunnelDef {
  id: string;
  name: string;
  /** An alias from ~/.ssh/config, or user@host. */
  host: string;
  /** Where the service is, as the server sees it: localhost:8188. */
  remote: string;
  /** The Mac's loopback port that reaches it. */
  localPort: number;
  /** If that port is taken, use the next free one instead of failing. */
  anyPort: boolean;
  /** Start when the Session opens. */
  autoStart: boolean;
  /** A Lima ssh config to use (a sandbox's own), instead of ~/.ssh/config. */
  sshConfig?: string;
}

export type TunnelState =
  | 'stopped'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'auth-required'
  | 'port-conflict'
  | 'failed';

export interface TunnelInfo {
  def: TunnelDef;
  state: TunnelState;
  /** The port actually used (differs from def.localPort when it was taken). */
  localPort: number;
  /** What the last exit said, trimmed. */
  detail?: string;
  /** Reconnect attempts since it last connected. */
  attempts: number;
}

export interface PortInfo {
  port: number;
  pid: number;
  /** vite, postgres, python…: from the process, not guessed from the port. */
  process: string;
  /** The tunnel that owns it, when it is one. */
  tunnel?: string;
  source: 'terminal' | 'tunnel' | 'sandbox';
  /** A sandbox port reachable on this Mac at this port, once published. */
  publishedAt?: number;
}

const HOST = /^[A-Za-z0-9_][A-Za-z0-9._@-]{0,127}$/;
const REMOTE = /^([A-Za-z0-9_][A-Za-z0-9._-]{0,127}|\[[0-9a-fA-F:]+\]):(\d{1,5})$/;

export const validateTunnel = (def: Partial<TunnelDef>): string | null => {
  if (typeof def.name !== 'string' || def.name.trim() === '' || def.name.length > 80)
    return 'Give the tunnel a name.';
  if (typeof def.host !== 'string' || !HOST.test(def.host))
    return 'The server must be an alias from your ~/.ssh/config, or user@host.';
  const m = typeof def.remote === 'string' ? REMOTE.exec(def.remote) : null;
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 65535)
    return 'The remote service looks like localhost:8188 (as the server sees it).';
  if (def.sshConfig !== undefined && !/^\/[^\0\n]*\/ssh\.config$/.test(def.sshConfig))
    return 'That ssh config is not valid.';
  if (!Number.isInteger(def.localPort) || def.localPort! < 1024 || def.localPort! > 65535)
    return 'The local port must be between 1024 and 65535.';
  return null;
};

/** The exact ssh arguments: foreground, key-less prompts fail fast, dead links are noticed. */
export const sshArgs = (def: TunnelDef, localPort: number): string[] => [
  // A Lima config shares one master connection, and then `ssh -N -L` hands the forward to it and
  // exits at once, leaving the port open after the tunnel is "stopped": give each tunnel its own.
  ...(def.sshConfig
    ? ['-F', def.sshConfig, '-o', 'ControlMaster=no', '-o', 'ControlPath=none']
    : []),
  '-N',
  '-o',
  'ExitOnForwardFailure=yes',
  '-o',
  'BatchMode=yes',
  '-o',
  'ServerAliveInterval=15',
  '-o',
  'ServerAliveCountMax=3',
  '-o',
  'ConnectTimeout=10',
  '-L',
  `127.0.0.1:${localPort}:${def.remote}`,
  '--',
  def.host,
];

/** What an ssh exit means, from its code and what it printed. */
export const classifyExit = (
  code: number | null,
  stderr: string,
  wasConnected: boolean
): {state: TunnelState; detail: string} => {
  const text = stderr.trim().split('\n').slice(-3).join(' ').slice(0, 240);
  if (/Address already in use|cannot listen to port|bind.*in use/i.test(stderr))
    return {state: 'port-conflict', detail: text};
  if (
    /Permission denied|Host key verification failed|Too many authentication failures|Authentication failed|REMOTE HOST IDENTIFICATION HAS CHANGED/i.test(
      stderr
    )
  )
    return {state: 'auth-required', detail: text};
  if (wasConnected) return {state: 'reconnecting', detail: text || `ssh exited (${code})`};
  return {state: 'failed', detail: text || `ssh exited (${code})`};
};

/** Seconds to wait before reconnect attempt n (1, 2, 4, 8… up to 60). */
export const backoffSeconds = (attempt: number) => Math.min(60, 2 ** Math.max(0, attempt - 1));

/** Host aliases a person can pick: plain names from ~/.ssh/config, no patterns. */
export const parseSshHosts = (config: string): string[] => {
  const seen = new Set<string>();
  for (const line of config.split(/\r?\n/)) {
    const m = /^\s*Host\s+(.+?)\s*$/i.exec(line);
    if (!m) continue;
    for (const name of m[1].split(/\s+/))
      if (!/[*?!]/.test(name) && HOST.test(name)) seen.add(name);
  }
  return [...seen];
};

export const describeState = (s: TunnelState): string =>
  ({
    stopped: 'Stopped',
    connecting: 'Connecting…',
    connected: 'Connected',
    reconnecting: 'Reconnecting…',
    'auth-required': 'Needs authentication',
    'port-conflict': 'Port in use',
    failed: 'Failed',
  })[s];
