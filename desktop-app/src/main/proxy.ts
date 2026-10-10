import {ipcMain, session, webContents} from 'electron';
import {IPC_MAIN_CHANNELS} from '../common/constants';
import {parseProxyAddress} from '../common/session-proxy';
import store from '../store';
import log from './logging';

/**
 * This Session's proxy. Every Session is its own process with its own default
 * session, which its previews use, so setting the proxy there leaves other
 * Sessions alone. The window's own pages stay direct (loopback is never proxied).
 */
const ECHO = process.env.RESPONSIVELY_PROXY_ECHO || 'https://api.ipify.org?format=json';

const guests = () => webContents.getAllWebContents().filter((c) => c.getType() === 'webview');

/** Chromium sends WebRTC over UDP, around any proxy: keep it from leaking this Mac's address. */
export const webRtcPolicy = () =>
  store.get('sessionProxy.enabled') === true ? 'disable_non_proxied_udp' : 'default';

export const applyProxy = async () => {
  const enabled = store.get('sessionProxy.enabled') === true;
  const parsed = parseProxyAddress(String(store.get('sessionProxy.address') ?? ''));
  const ses = session.defaultSession;
  if (enabled && parsed.ok) await ses.setProxy({mode: 'fixed_servers', proxyRules: parsed.rules});
  else await ses.setProxy({mode: 'system'});
  await ses.closeAllConnections();
  guests().forEach((c) =>
    c.setWebRTCIPHandlingPolicy(enabled && parsed.ok ? 'disable_non_proxied_udp' : 'default')
  );
};

/** Reaches an address-echo service through the proxy in a throwaway session. */
const test = async (rules: string): Promise<string> => {
  const ses = session.fromPartition(`proxy-test-${Date.now()}`);
  try {
    await ses.setProxy({mode: 'fixed_servers', proxyRules: rules});
    const res = await ses.fetch(ECHO, {signal: AbortSignal.timeout(10_000)});
    const body = (await res.json()) as {ip?: string};
    if (!body.ip) throw new Error('No answer');
    return body.ip;
  } finally {
    await ses.clearCache().catch(() => {});
  }
};

export const initSessionProxy = () => {
  applyProxy().catch((e) => log.warn('[proxy] could not apply', e));
  ipcMain.removeHandler(IPC_MAIN_CHANNELS.PROXY_GET);
  ipcMain.handle(IPC_MAIN_CHANNELS.PROXY_GET, () => ({
    enabled: store.get('sessionProxy.enabled') === true,
    address: String(store.get('sessionProxy.address') ?? ''),
  }));
  ipcMain.removeHandler(IPC_MAIN_CHANNELS.PROXY_SET);
  ipcMain.handle(
    IPC_MAIN_CHANNELS.PROXY_SET,
    async (_e, req: {enabled?: unknown; address?: unknown}) => {
      const address = typeof req?.address === 'string' ? req.address : '';
      if (req?.enabled !== true) {
        store.set('sessionProxy', {enabled: false, address});
        await applyProxy();
        return {ok: true as const, ip: null};
      }
      const parsed = parseProxyAddress(address);
      if (!parsed.ok) return {ok: false as const, error: parsed.error};
      try {
        const ip = await test(parsed.rules);
        store.set('sessionProxy', {enabled: true, address: parsed.rules});
        await applyProxy();
        return {ok: true as const, ip};
      } catch {
        return {ok: false as const, error: 'Could not connect. Nothing was changed.'};
      }
    }
  );
};
