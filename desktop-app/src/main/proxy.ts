import fs from 'fs';
import {app, ipcMain, session, webContents} from 'electron';
import {IPC_MAIN_CHANNELS} from '../common/constants';
import {parseProxyAddress} from '../common/session-proxy';
import {parseWireguardConf} from '../common/wireguard-conf';
import store from '../store';
import log from './logging';
import {
  hasWireguardConf,
  removeWireguardConf,
  saveWireguardConf,
  startWireguard,
  stopWireguard,
  wireguardRunning,
} from './wireguard';

/**
 * This Session's proxy: an address the user gives, or a WireGuard config run
 * locally by wireproxy. Every Session is its own process with its own default
 * session, which its previews use, so setting the proxy there leaves other
 * Sessions alone. The window's own pages stay direct (loopback is never proxied).
 */
const ECHO = process.env.RESPONSIVELY_PROXY_ECHO || 'https://api.ipify.org?format=json';
/** If the tunnel dies, pages go to a closed port (no connection) rather than around it. */
const FAIL_CLOSED = 'socks5://127.0.0.1:1';

type Mode = 'address' | 'wireguard';
const mode = (): Mode => (store.get('sessionProxy.mode') === 'wireguard' ? 'wireguard' : 'address');
const enabled = () => store.get('sessionProxy.enabled') === true;

const guests = () => webContents.getAllWebContents().filter((c) => c.getType() === 'webview');

/** Chromium sends WebRTC over UDP, around any proxy: keep it from leaking this Mac's address. */
export const webRtcPolicy = () => (enabled() ? 'disable_non_proxied_udp' : 'default');

const readConfEndpoint = (): string | null => {
  try {
    const confFile = `${app.getPath('userData')}/wireguard.conf`;
    const parsed = parseWireguardConf(fs.readFileSync(confFile, 'utf8'));
    return parsed.ok ? parsed.endpoint : null;
  } catch {
    return null;
  }
};

let wgRules: string | null = null;

const setRules = async (rules: string | null) => {
  const ses = session.defaultSession;
  await ses.setProxy(rules ? {mode: 'fixed_servers', proxyRules: rules} : {mode: 'system'});
  await ses.closeAllConnections();
  guests().forEach((c) =>
    c.setWebRTCIPHandlingPolicy(rules ? 'disable_non_proxied_udp' : 'default')
  );
};

export const applyProxy = async () => {
  if (!enabled()) {
    stopWireguard();
    wgRules = null;
    await setRules(null);
    return;
  }
  if (mode() === 'address') {
    stopWireguard();
    wgRules = null;
    const parsed = parseProxyAddress(String(store.get('sessionProxy.address') ?? ''));
    await setRules(parsed.ok ? parsed.rules : null);
    return;
  }
  try {
    if (!wireguardRunning()) {
      wgRules = await startWireguard(() => {
        setRules(FAIL_CLOSED).catch(() => {});
      });
    }
    await setRules(wgRules);
  } catch (e) {
    log.warn('[proxy] WireGuard did not start', e);
    await setRules(FAIL_CLOSED);
  }
};

/** Reaches an address-echo service through the proxy in a throwaway session. */
const test = async (rules: string): Promise<string> => {
  const ses = session.fromPartition(`proxy-test-${Date.now()}`);
  try {
    await ses.setProxy({mode: 'fixed_servers', proxyRules: rules});
    const res = await ses.fetch(ECHO, {signal: AbortSignal.timeout(15_000)});
    const body = (await res.json()) as {ip?: string};
    if (!body.ip) throw new Error('No answer');
    return body.ip;
  } finally {
    await ses.clearCache().catch(() => {});
  }
};

interface SetRequest {
  enabled?: unknown;
  mode?: unknown;
  address?: unknown;
  conf?: unknown;
  forget?: unknown;
}

const set = async (req: SetRequest) => {
  const nextMode: Mode = req?.mode === 'wireguard' ? 'wireguard' : 'address';
  const address = typeof req?.address === 'string' ? req.address : '';
  if (req?.forget === true) {
    stopWireguard();
    removeWireguardConf();
    store.set('sessionProxy', {enabled: false, address, mode: nextMode});
    await applyProxy();
    return {ok: true as const, ip: null};
  }
  if (req?.enabled !== true) {
    store.set('sessionProxy', {enabled: false, address, mode: nextMode});
    await applyProxy();
    return {ok: true as const, ip: null};
  }
  if (nextMode === 'address') {
    const parsed = parseProxyAddress(address);
    if (!parsed.ok) return {ok: false as const, error: parsed.error};
    try {
      const ip = await test(parsed.rules);
      store.set('sessionProxy', {enabled: true, address: parsed.rules, mode: 'address'});
      await applyProxy();
      return {ok: true as const, ip};
    } catch {
      return {ok: false as const, error: 'Could not connect. Nothing was changed.'};
    }
  }
  // WireGuard: a pasted config replaces the saved one only if it works.
  const previous = hasWireguardConf()
    ? fs.readFileSync(`${app.getPath('userData')}/wireguard.conf`, 'utf8')
    : null;
  if (typeof req.conf === 'string' && req.conf.trim() !== '') {
    const parsed = parseWireguardConf(req.conf);
    if (!parsed.ok) return {ok: false as const, error: parsed.error};
    saveWireguardConf(parsed.conf);
  } else if (!hasWireguardConf()) {
    return {ok: false as const, error: 'Paste a WireGuard config first.'};
  }
  try {
    const rules = await startWireguard(() => {
      setRules(FAIL_CLOSED).catch(() => {});
    });
    const ip = await test(rules);
    wgRules = rules;
    store.set('sessionProxy', {enabled: true, address, mode: 'wireguard'});
    await applyProxy();
    return {ok: true as const, ip};
  } catch (e) {
    stopWireguard();
    if (previous === null) removeWireguardConf();
    else saveWireguardConf(previous);
    const detail = e instanceof Error && /helper/.test(e.message) ? ` ${e.message}` : '';
    return {
      ok: false as const,
      error: `Could not connect through that config. Nothing was changed.${detail}`,
    };
  }
};

export const initSessionProxy = () => {
  applyProxy().catch((e) => log.warn('[proxy] could not apply', e));
  ipcMain.removeHandler(IPC_MAIN_CHANNELS.PROXY_GET);
  ipcMain.handle(IPC_MAIN_CHANNELS.PROXY_GET, () => ({
    enabled: enabled(),
    mode: mode(),
    address: String(store.get('sessionProxy.address') ?? ''),
    hasConfig: hasWireguardConf(),
    endpoint: readConfEndpoint(),
    running: wireguardRunning(),
  }));
  ipcMain.removeHandler(IPC_MAIN_CHANNELS.PROXY_SET);
  ipcMain.handle(IPC_MAIN_CHANNELS.PROXY_SET, (_e, req: SetRequest) => set(req));
};
