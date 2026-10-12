/**
 * A Session's Sandbox: one small Linux machine (a colima/Lima VM) with its own
 * disk. Pure: names, the exact colima command lines, and how its status is read.
 */
export type SandboxMode = 'local' | 'sandbox';
export type SandboxSize = 1 | 2 | 4;
export const SANDBOX_SIZES: SandboxSize[] = [1, 2, 4];
export const IDLE_STOP_MS = 30 * 60 * 1000;
export const SANDBOX_DISK_GIB = 20;

export interface SandboxSettings {
  mode: SandboxMode;
  /** CPUs and GiB of memory (1 → 1 CPU · 1 GiB …). Fixed when created. */
  size: SandboxSize;
  /** Docker and Compose inside the sandbox. Fixed when created. */
  docker: boolean;
  /** Forward your ssh-agent into it. Fixed when created. */
  sshAgent: boolean;
  /** One optional Mac folder shown inside it. Fixed when created. */
  folder?: string;
  /** Stop after 30 minutes without use. */
  idleStop: boolean;
  /** New ports: ask, or publish at once. */
  publish: 'ask' | 'auto';
}

export const DEFAULT_SANDBOX: SandboxSettings = {
  mode: 'local',
  size: 2,
  docker: false,
  sshAgent: false,
  idleStop: true,
  publish: 'ask',
};

export type SandboxPhase =
  | 'none'
  | 'creating'
  | 'stopped'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'destroying'
  | 'missing-runtime';

export interface SandboxState {
  settings: SandboxSettings;
  phase: SandboxPhase;
  /** What it is doing right now, and how far along (0-100). */
  step?: string;
  progress?: number;
  /** Why the last action failed, or what to install. */
  detail?: string;
  profile: string;
  /** The Session's name, typed to confirm Destroy. */
  sessionName: string;
  diskBytes?: number;
}

/** Every Session gets its own colima profile, named from its id. */
export const profileFor = (sessionId: string) =>
  `resp-${
    sessionId
      .replace(/[^a-z0-9]/gi, '')
      .slice(0, 8)
      .toLowerCase() || 'main'
  }`;

export const instanceFor = (profile: string) => `colima-${profile}`;
export const sshHostFor = (profile: string) => `lima-${instanceFor(profile)}`;
export const sshConfigFor = (profile: string, colimaHome: string) =>
  `${colimaHome.replace(/\/+$/, '')}/_lima/${instanceFor(profile)}/ssh.config`;

export const validFolder = (folder: unknown): folder is string =>
  typeof folder === 'string' &&
  folder.startsWith('/') &&
  !folder.includes('\0') &&
  folder !== '/' &&
  !/^\/(etc|System|Library|private|usr|bin|sbin|var)(\/|$)/.test(folder);

/** Merge what the window sends with the defaults, dropping anything unknown or invalid. */
export const sanitizeSandbox = (raw: unknown): SandboxSettings => {
  const v = (raw && typeof raw === 'object' ? raw : {}) as Partial<SandboxSettings>;
  return {
    mode: v.mode === 'sandbox' ? 'sandbox' : 'local',
    size: SANDBOX_SIZES.includes(v.size as SandboxSize) ? (v.size as SandboxSize) : 2,
    docker: v.docker === true,
    sshAgent: v.sshAgent === true,
    ...(validFolder(v.folder) ? {folder: v.folder} : {}),
    idleStop: v.idleStop !== false,
    publish: v.publish === 'auto' ? 'auto' : 'ask',
  };
};

/**
 * The colima command for creating the machine. Only the folders listed here are
 * visible inside it (colima's default is your whole home folder); it never
 * changes your Docker context; ports are published by Responsively, not by Lima.
 */
export const createArgs = (profile: string, s: SandboxSettings, exchangeDir: string): string[] => [
  'start',
  profile,
  '--cpu',
  String(s.size),
  '--memory',
  String(s.size),
  '--disk',
  String(SANDBOX_DISK_GIB),
  '--vm-type',
  'vz',
  '--mount-type',
  'virtiofs',
  '--mount',
  `${exchangeDir}:w`,
  ...(s.folder ? ['--mount', `${s.folder}:w`] : []),
  '--runtime',
  s.docker ? 'docker' : 'none',
  '--port-forwarder',
  'none',
  '--activate=false',
  ...(s.sshAgent ? ['--ssh-agent'] : []),
];

export interface ColimaProfile {
  name: string;
  status: string;
  cpus: number;
  memory: number;
  disk: number;
  runtime: string;
}

/** `colima list -j` prints one JSON object per line. */
export const parseColimaList = (text: string): ColimaProfile[] =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('{'))
    .flatMap((l) => {
      try {
        const v = JSON.parse(l);
        return typeof v.name === 'string' ? [v as ColimaProfile] : [];
      } catch {
        return [];
      }
    });

export const phaseFromColima = (p: ColimaProfile | undefined): SandboxPhase => {
  if (!p) return 'none';
  return p.status === 'Running' ? 'running' : 'stopped';
};

/** tmux session names this app made inside the sandbox. */
export const tmuxNameFor = (terminalId: string) => `resp-${terminalId}`;
export const isOurTmux = (name: string) => /^resp-[a-f0-9]{16}$/.test(name);
export const terminalIdOfTmux = (name: string) => name.replace(/^resp-/, '');

/** Ports listening in the guest, from `ss -ltnH`, excluding the machine's own services. */
export const parseSs = (text: string): number[] => {
  const ports = new Set<number>();
  for (const line of text.split('\n')) {
    const m = /^LISTEN\s+\d+\s+\d+\s+(\S+):(\d+)\s/.exec(line.trim());
    if (!m) continue;
    const [, addr, port] = m;
    // Only loopback and wildcard listeners are services of the user's; skip the host-facing ones (DNS, ssh).
    if (!['127.0.0.1', '0.0.0.0', '*', '[::]', '[::1]', '::'].includes(addr)) continue;
    const n = Number(port);
    if (n === 22 || n === 53 || n < 1024) continue;
    ports.add(n);
  }
  return [...ports].sort((a, b) => a - b);
};
