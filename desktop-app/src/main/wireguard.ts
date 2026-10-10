import {spawn, type ChildProcess} from 'child_process';
import fs from 'fs';
import net from 'net';
import path from 'path';
import {app} from 'electron';
import log from './logging';

/**
 * A WireGuard config turned into a local SOCKS5 port by wireproxy (userspace:
 * no root, no network interface). The config, which holds a private key, lives
 * in this Session's own folder with mode 0600 and never goes back to the window.
 */
const dir = () => app.getPath('userData');
const confPath = () => path.join(dir(), 'wireguard.conf');
const runPath = () => path.join(dir(), 'wireproxy-run.conf');

const binary = (): string => {
  const candidates = [
    path.join(process.resourcesPath ?? '', 'assets', 'bin', 'wireproxy'),
    path.join(app.getAppPath(), '..', '..', 'assets', 'bin', 'wireproxy'),
  ];
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) throw new Error('The WireGuard helper is missing from this build.');
  return found;
};

export const hasWireguardConf = () => fs.existsSync(confPath());
export const saveWireguardConf = (conf: string) =>
  fs.writeFileSync(confPath(), conf, {mode: 0o600});
export const removeWireguardConf = () => fs.rmSync(confPath(), {force: true});

let child: ChildProcess | null = null;
let port = 0;
let onDied: (() => void) | null = null;

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const {port: p} = server.address() as net.AddressInfo;
      server.close(() => resolve(p));
    });
  });

const listening = (p: number) =>
  new Promise<boolean>((resolve) => {
    const socket = net.connect(p, '127.0.0.1');
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });

export const stopWireguard = () => {
  const c = child;
  child = null;
  port = 0;
  if (c && !c.killed) c.kill('SIGTERM');
  fs.rmSync(runPath(), {force: true});
};

/** Starts wireproxy on a free loopback port; resolves with the SOCKS address. */
export const startWireguard = async (died?: () => void): Promise<string> => {
  stopWireguard();
  onDied = died ?? null;
  const p = await freePort();
  fs.writeFileSync(
    runPath(),
    `${fs.readFileSync(confPath(), 'utf8')}\n[Socks5]\nBindAddress = 127.0.0.1:${p}\n`,
    {
      mode: 0o600,
    }
  );
  const c = spawn(binary(), ['-s', '-c', runPath()], {stdio: ['ignore', 'ignore', 'pipe']});
  child = c;
  port = p;
  let stderr = '';
  c.stderr?.on('data', (d) => {
    stderr = (stderr + String(d)).slice(-400);
  });
  c.once('exit', (code) => {
    if (child === c) {
      child = null;
      port = 0;
      fs.rmSync(runPath(), {force: true});
      log.warn('[wireguard] helper exited', code);
      onDied?.();
    }
  });
  for (let i = 0; i < 40; i += 1) {
    if (child !== c)
      throw new Error(`The WireGuard helper stopped: ${stderr.trim() || 'bad config'}`);

    if (await listening(p)) return `socks5://127.0.0.1:${p}`;

    await new Promise<void>((resolve) => {
      setTimeout(resolve, 200);
    });
  }
  stopWireguard();
  throw new Error('The WireGuard helper did not start.');
};

export const wireguardRunning = () => child !== null && port !== 0;

app.on('will-quit', stopWireguard);
