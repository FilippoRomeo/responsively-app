import {execFile} from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  createArgs,
  DOCKER_PS_FORMAT,
  type DockerContainer,
  IDLE_STOP_MS,
  isOurTmux,
  parseColimaList,
  parseDockerPs,
  parseSs,
  phaseFromColima,
  profileFor,
  sanitizeSandbox,
  sshConfigFor,
  sshHostFor,
  type SandboxPhase,
  type SandboxSettings,
  type SandboxState,
} from '../../common/sandbox';
import {
  clampTimeout,
  commandScript,
  MAX_WRITE_BYTES,
  readScript,
  tailOutput,
  workspacePath,
  writeScript,
} from '../../common/sandbox-exec';
import log from '../logging';

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

const COLIMA_PATHS = ['/opt/homebrew/bin/colima', '/usr/local/bin/colima'];
export const colimaHome = () => process.env.COLIMA_HOME || path.join(os.homedir(), '.colima');

export const findColima = (): string | null => {
  const wanted = process.env.RESPONSIVELY_COLIMA;
  if (wanted !== undefined) return fs.existsSync(wanted) ? wanted : null;
  return COLIMA_PATHS.find((p) => fs.existsSync(p)) ?? null;
};

/** A GUI app's PATH lacks Homebrew; colima needs limactl and qemu tools from it. */
export const toolEnv = (): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env))
    if (!/^(RESPONSIVELY_|ELECTRON_|NODE_OPTIONS$)/.test(k)) env[k] = v;
  env.PATH = `/opt/homebrew/bin:/usr/local/bin:${env.PATH ?? '/usr/bin:/bin'}`;
  return env;
};

const run = (file: string, args: string[], timeout: number, input?: string): Promise<Run> =>
  new Promise((resolve) => {
    const child = execFile(
      file,
      args,
      {env: toolEnv(), timeout, maxBuffer: 8_000_000, encoding: 'utf8'},
      (error, stdout, stderr) =>
        resolve({
          code: error ? (typeof error.code === 'number' ? error.code : 1) : 0,
          stdout: String(stdout),
          stderr: String(stderr),
        })
    );
    if (input !== undefined) child.stdin?.end(input);
  });

const tail = (text: string) =>
  text
    .trim()
    .split('\n')
    .filter((l) => !/^time=.*level=info/.test(l))
    .slice(-3)
    .join(' ')
    .slice(0, 300);

/** Every sandbox this app made on this Mac, for Settings › Storage. */
export const listSandboxProfiles = async () => {
  const colima = findColima();
  if (!colima) return [];
  const list = parseColimaList((await run(colima, ['list', '-j'], 20_000)).stdout).filter((p) =>
    p.name.startsWith('resp-')
  );
  return Promise.all(
    list.map(async (p) => {
      const r = await run(
        '/usr/bin/du',
        ['-sk', path.join(colimaHome(), '_lima', `colima-${p.name}`)],
        15_000
      );
      const kb = Number(r.stdout.split(/\s/)[0]);
      return {
        name: p.name,
        running: p.status === 'Running',
        bytes: Number.isFinite(kb) ? kb * 1024 : 0,
      };
    })
  );
};

export interface SandboxOptions {
  sessionId: string;
  sessionName: () => string;
  /** Where this Session keeps its sandbox bits (the folder shown inside it as /mnt). */
  root: string;
  load: () => unknown;
  save: (settings: SandboxSettings) => void;
  /** Tells whoever stops Sessions (a different process) what to do with this sandbox. */
  remember?: (settings: SandboxSettings) => void;
  emit: (state: SandboxState) => void;
}

/**
 * The Session's Sandbox: a colima/Lima machine, with the lifecycle shown only as
 * far as it is proved (running means a command inside answered).
 */
export class Sandbox {
  private settings: SandboxSettings;
  private phase: SandboxPhase = 'none';
  private step?: string;
  private progress?: number;
  private detail?: string;
  private diskBytes?: number;
  private lastUse = Date.now();
  private idleTimer: NodeJS.Timeout | null = null;
  private busy = false;
  readonly profile: string;

  constructor(private readonly o: SandboxOptions) {
    this.settings = sanitizeSandbox(o.load());
    this.profile = profileFor(o.sessionId);
  }

  state(): SandboxState {
    return {
      settings: this.settings,
      phase: this.phase,
      step: this.step,
      progress: this.progress,
      detail: this.detail,
      profile: this.profile,
      sessionName: this.o.sessionName(),
      diskBytes: this.diskBytes,
    };
  }

  private publish() {
    this.o.emit(this.state());
  }

  private set(phase: SandboxPhase, step?: string, progress?: number, detail?: string) {
    this.phase = phase;
    this.step = step;
    this.progress = progress;
    this.detail = detail;
    this.publish();
  }

  /** Reads what colima says and proves it with a command inside. */
  async refresh(): Promise<SandboxState> {
    if (this.busy) return this.state();
    const colima = findColima();
    if (!colima) {
      this.set(
        'missing-runtime',
        undefined,
        undefined,
        'Sandboxes use colima. Install it with:  brew install colima'
      );
      return this.state();
    }
    const list = await run(colima, ['list', '-j'], 20_000);
    const found = parseColimaList(list.stdout).find((p) => p.name === this.profile);
    let phase = phaseFromColima(found);
    if (phase === 'running' && !(await this.prove())) phase = 'starting';
    this.set(
      phase,
      undefined,
      undefined,
      this.detail && phase === 'none' ? this.detail : undefined
    );
    if (found) this.diskBytes = await this.measureDisk();
    this.armIdle();
    this.publish();
    return this.state();
  }

  private async measureDisk(): Promise<number | undefined> {
    const dir = path.join(colimaHome(), '_lima', `colima-${this.profile}`);
    const r = await run('/usr/bin/du', ['-sk', dir], 15_000);
    const kb = Number(r.stdout.split(/\s/)[0]);
    return Number.isFinite(kb) ? kb * 1024 : undefined;
  }

  setSettings(patch: Partial<SandboxSettings>) {
    const next = sanitizeSandbox({...this.settings, ...patch});
    // What the machine was built with cannot change afterwards.
    if (this.phase !== 'none' && this.phase !== 'missing-runtime') {
      next.size = this.settings.size;
      next.docker = this.settings.docker;
      next.sshAgent = this.settings.sshAgent;
      next.folder = this.settings.folder;
    }
    this.settings = next;
    this.o.save(next);
    this.o.remember?.(next);
    this.armIdle();
    this.publish();
    return this.state();
  }

  // ---- reaching it ---------------------------------------------------------

  target() {
    return {config: sshConfigFor(this.profile, colimaHome()), host: sshHostFor(this.profile)};
  }

  private sshArgs(command: string): string[] {
    const t = this.target();
    return ['-F', t.config, '-o', 'ConnectTimeout=5', '-o', 'LogLevel=ERROR', t.host, command];
  }

  /** A command inside; no agent is forwarded (the Lima config does not ask for it). */
  exec(command: string, timeoutMs = 30_000) {
    this.touch();
    return run('/usr/bin/ssh', this.sshArgs(command), timeoutMs);
  }

  /** An agent's command: in the workspace, with a hard time limit, no tty, no agent forwarded. */
  async runCommand(command: string, cwd: string | undefined, timeoutSeconds: unknown) {
    const seconds = clampTimeout(timeoutSeconds);
    const r = await this.exec(commandScript(command, cwd, seconds), seconds * 1000 + 20_000);
    const out = tailOutput(r.stdout);
    const err = tailOutput(r.stderr);
    return {
      exitCode: r.code,
      timedOut: r.code === 137,
      stdout: out.text,
      stderr: err.text,
      truncated: out.truncated || err.truncated,
    };
  }

  async readFile(path_: unknown): Promise<string> {
    const r = await this.exec(readScript(workspacePath(path_)), 30_000);
    if (r.code !== 0) throw new Error(r.stderr.trim() || 'Could not read that file.');
    return r.stdout;
  }

  async writeFile(path_: unknown, content: unknown): Promise<number> {
    if (typeof content !== 'string') throw new Error('The content must be text.');
    if (Buffer.byteLength(content) > MAX_WRITE_BYTES)
      throw new Error(`Files are limited to ${MAX_WRITE_BYTES} bytes here.`);
    this.touch();
    const r = await run(
      '/usr/bin/ssh',
      this.sshArgs(writeScript(workspacePath(path_))),
      60_000,
      content
    );
    if (r.code !== 0) throw new Error(r.stderr.trim() || 'Could not write that file.');
    return Buffer.byteLength(content);
  }

  private async prove() {
    return (await run('/usr/bin/ssh', this.sshArgs('true'), 8000)).code === 0;
  }

  async tmuxSessions(): Promise<string[]> {
    const r = await this.exec(
      "tmux list-sessions -F '#{session_name}' 2>/dev/null || true",
      10_000
    );
    return r.stdout
      .split('\n')
      .map((l) => l.trim())
      .filter(isOurTmux);
  }

  async killTmux(name: string) {
    if (isOurTmux(name))
      await this.exec(`tmux kill-session -t ${name} 2>/dev/null || true`, 10_000);
  }

  async listeningPorts(): Promise<number[]> {
    const r = await this.exec('ss -ltnH', 10_000);
    return r.code === 0 ? parseSs(r.stdout) : [];
  }

  /** The containers of the sandbox's own Docker, when it has one and is running. */
  async dockerContainers(): Promise<DockerContainer[]> {
    if (!this.settings.docker || this.phase !== 'running') return [];
    const r = await this.exec(`docker ps --format '${DOCKER_PS_FORMAT}' 2>/dev/null`, 15_000);
    return r.code === 0 ? parseDockerPs(r.stdout) : [];
  }

  isRunning() {
    return this.phase === 'running';
  }

  touch() {
    this.lastUse = Date.now();
  }

  // ---- lifecycle -----------------------------------------------------------

  private async guarded(
    phase: SandboxPhase,
    work: () => Promise<void>,
    failureStep: string
  ): Promise<SandboxState> {
    if (this.busy) throw new Error('The sandbox is busy: wait for it to finish.');
    this.busy = true;
    try {
      this.set(phase);
      await work();
    } catch (e) {
      log.warn('[sandbox]', failureStep, e);
      this.busy = false;
      await this.refresh();
      this.detail = `${failureStep}: ${(e as Error).message}`;
      this.publish();
      return this.state();
    }
    this.busy = false;
    return this.refresh();
  }

  private colima() {
    const c = findColima();
    if (!c) throw new Error('colima is not installed (brew install colima)');
    return c;
  }

  create() {
    return this.guarded(
      'creating',
      async () => {
        if (this.settings.mode !== 'sandbox') throw new Error('Choose Sandbox first.');
        const exchange = path.join(this.o.root, 'exchange');
        fs.mkdirSync(exchange, {recursive: true});
        this.set(
          'creating',
          'Creating the machine (the first time downloads its base system)…',
          15
        );
        const made = await run(
          this.colima(),
          createArgs(this.profile, this.settings, exchange),
          20 * 60_000
        );
        if (made.code !== 0)
          throw new Error(tail(made.stderr || made.stdout) || 'colima could not start it');
        this.set('creating', 'Installing tmux and git inside…', 75);
        const prov = await this.exec(
          'sudo DEBIAN_FRONTEND=noninteractive apt-get update -qq >/dev/null 2>&1; ' +
            'sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq tmux git >/dev/null 2>&1; ' +
            'mkdir -p "$HOME/workspace"; command -v tmux',
          5 * 60_000
        );
        if (prov.code !== 0)
          throw new Error('Could not install tmux inside it (is there a network connection?)');
        this.set('creating', 'Checking that a command inside answers…', 95);
        if (!(await this.prove())) throw new Error('It started but does not answer.');
      },
      'Could not create the sandbox'
    );
  }

  start() {
    return this.guarded(
      'starting',
      async () => {
        this.set('starting', 'Starting the machine…', 30);
        const r = await run(
          this.colima(),
          ['start', this.profile, '--activate=false'],
          10 * 60_000
        );
        if (r.code !== 0)
          throw new Error(tail(r.stderr || r.stdout) || 'colima could not start it');
        this.set('starting', 'Waiting for a command inside to answer…', 85);
        if (!(await this.prove())) throw new Error('It started but does not answer.');
        this.touch();
      },
      'Could not start the sandbox'
    );
  }

  stop() {
    return this.guarded(
      'stopping',
      async () => {
        this.set('stopping', 'Ending terminals and shutting down…', 40);
        const r = await run(this.colima(), ['stop', this.profile], 5 * 60_000);
        if (r.code !== 0) throw new Error(tail(r.stderr || r.stdout));
      },
      'Could not stop the sandbox'
    );
  }

  async restart() {
    await this.stop();
    if (this.phase !== 'stopped') return this.state();
    return this.start();
  }

  destroy(typedName: string) {
    if (typedName !== this.o.sessionName())
      throw new Error('Type the Session name exactly to delete its sandbox.');
    if (this.phase !== 'stopped') throw new Error('Stop the sandbox first.');
    return this.guarded(
      'destroying',
      async () => {
        this.set('destroying', 'Deleting its disk…', 50);
        const r = await run(this.colima(), ['delete', this.profile, '--force'], 5 * 60_000);
        if (r.code !== 0) throw new Error(tail(r.stderr || r.stdout));
        fs.rmSync(path.join(this.o.root, 'exchange'), {recursive: true, force: true});
        this.diskBytes = undefined;
      },
      'Could not delete the sandbox'
    );
  }

  // ---- idle ----------------------------------------------------------------

  private armIdle() {
    if (this.idleTimer) clearInterval(this.idleTimer);
    this.idleTimer = null;
    if (!this.settings.idleStop) return;
    this.idleTimer = setInterval(() => {
      if (this.phase === 'running' && !this.busy && Date.now() - this.lastUse > IDLE_STOP_MS) {
        log.info('[sandbox] stopping after 30 minutes idle');
        void this.stop();
      }
    }, 60_000);
    this.idleTimer.unref();
  }

  dispose() {
    if (this.idleTimer) clearInterval(this.idleTimer);
  }
}
