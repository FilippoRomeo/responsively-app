import {Icon} from '@iconify/react';
import cx from 'classnames';
import {IPC_MAIN_CHANNELS} from 'common/constants';
import {useCallback, useEffect, useState} from 'react';
import Popover from 'renderer/components/Popover';

type Mode = 'address' | 'wireguard';
interface ProxyState {
  enabled: boolean;
  mode: Mode;
  address: string;
  hasConfig: boolean;
  endpoint: string | null;
  running: boolean;
}
type Result = {ok: true; ip: string | null} | {ok: false; error: string};

const invoke = <R,>(...args: unknown[]) =>
  window.electron.ipcRenderer.invoke<unknown, R>(IPC_MAIN_CHANNELS.PROXY_SET, ...args);

/** Network for this Session: send its previews through a proxy or a WireGuard tunnel. */
const NetworkButton = () => {
  const [state, setState] = useState<ProxyState>({
    enabled: false,
    mode: 'address',
    address: '',
    hasConfig: false,
    endpoint: null,
    running: false,
  });
  const [mode, setMode] = useState<Mode>('address');
  const [address, setAddress] = useState('');
  const [conf, setConf] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{good: boolean; text: string} | null>(null);

  const load = useCallback(
    () =>
      window.electron.ipcRenderer
        .invoke<unknown, ProxyState>(IPC_MAIN_CHANNELS.PROXY_GET)
        .then((value) => {
          setState(value);
          return value;
        })
        .catch(() => null),
    []
  );

  useEffect(() => {
    load()
      .then((value) => {
        if (value) {
          setEnabled(value.enabled);
          setMode(value.mode);
          setAddress(value.address);
        }
        return value;
      })
      .catch(() => {});
  }, [load]);

  const apply = async (nextEnabled: boolean, extra: Record<string, unknown> = {}) => {
    setBusy(true);
    setMessage(null);
    const result = await invoke<Result>({
      enabled: nextEnabled,
      mode,
      address,
      conf: mode === 'wireguard' && conf.trim() ? conf : undefined,
      ...extra,
    });
    setBusy(false);
    await load();
    if (result.ok) {
      if (nextEnabled) setConf('');
      setMessage(
        nextEnabled
          ? {good: true, text: `Works. Pages now leave from ${result.ip}.`}
          : {good: true, text: 'Off.'}
      );
    } else setMessage({good: false, text: result.error});
  };

  const needsConfig = mode === 'wireguard' && !state.hasConfig && conf.trim() === '';

  return (
    <Popover
      triggerTitle="Network for this Session"
      anchor="bottom end"
      className="w-[400px] p-4"
      triggerClassName={cx(
        'flex h-[30px] items-center gap-[6px] rounded-lg px-[7px] text-[16px] transition-colors',
        state.enabled ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-hover hover:text-fg'
      )}
      trigger={
        <span className="pointer-events-none contents" data-testid="network-button">
          <Icon icon="lucide:globe" />
          {state.enabled ? (
            <span className="text-[11.5px]">{state.mode === 'wireguard' ? 'vpn' : 'proxy'}</span>
          ) : null}
        </span>
      }
    >
      {() => (
        <div data-testid="network-panel">
          <div className="text-[13.5px] font-bold">Network for this Session</div>
          <label className="mt-3 flex items-center gap-2 text-[12.5px]">
            <input
              type="checkbox"
              checked={enabled}
              disabled={busy}
              onChange={() => {
                const next = !enabled;
                setEnabled(next);
                if (!next && state.enabled) apply(false);
              }}
              className="m-0 accent-accent"
            />
            Send this Session&apos;s pages through a proxy or VPN
          </label>
          <div className={cx('mt-3', enabled ? '' : 'opacity-50')}>
            <div
              role="group"
              aria-label="Kind"
              className="mb-3 flex gap-[2px] rounded-lg border border-line p-[2px]"
            >
              {(['address', 'wireguard'] as Mode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  disabled={!enabled || busy}
                  aria-pressed={mode === m}
                  onClick={() => {
                    setMode(m);
                    setMessage(null);
                  }}
                  className={cx(
                    'h-[26px] flex-1 rounded-md px-[9px] text-[11.5px] focus:outline-none focus-visible:ring-1 focus-visible:ring-accent',
                    mode === m ? 'bg-accent-soft text-accent' : 'text-fg hover:bg-hover'
                  )}
                >
                  {m === 'address' ? 'Proxy address' : 'WireGuard config'}
                </button>
              ))}
            </div>
            {mode === 'address' ? (
              <>
                <input
                  aria-label="Proxy address"
                  value={address}
                  disabled={!enabled || busy}
                  onChange={(e) => {
                    setAddress(e.target.value);
                    setMessage(null);
                  }}
                  placeholder="socks5://127.0.0.1:9050"
                  className="h-[30px] w-full rounded-lg border border-line bg-transparent px-[10px] text-[12.5px]"
                />
                <p className="mt-[6px] text-[11.5px] leading-[1.5] text-muted">
                  socks5://, http:// or https:// with a port (a proxy that needs a login is not
                  supported yet).
                </p>
              </>
            ) : (
              <>
                {state.hasConfig ? (
                  <p className="mb-2 flex items-center gap-2 text-[12px]">
                    <span>
                      Saved config{state.endpoint ? ` for ${state.endpoint}` : ''}
                      {state.enabled && state.mode === 'wireguard'
                        ? state.running
                          ? ' · connected'
                          : ' · not running'
                        : ''}
                    </span>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => apply(false, {forget: true})}
                      className="text-accent hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                    >
                      Remove it
                    </button>
                  </p>
                ) : null}
                <textarea
                  aria-label="WireGuard config"
                  value={conf}
                  disabled={!enabled || busy}
                  onChange={(e) => {
                    setConf(e.target.value);
                    setMessage(null);
                  }}
                  rows={5}
                  placeholder={
                    state.hasConfig
                      ? 'Paste a different .conf to replace the saved one'
                      : '[Interface]\nPrivateKey = …\n\n[Peer]\nPublicKey = …\nEndpoint = host:51820'
                  }
                  className="w-full rounded-lg border border-line bg-transparent p-[10px] font-mono text-[11px]"
                />
                <p className="mt-[6px] text-[11.5px] leading-[1.5] text-muted">
                  The .conf file your VPN gives you (Proton, Mullvad and others). It stays in this
                  Session&apos;s folder and is never shown again. If the tunnel stops, pages stop
                  rather than go around it.
                </p>
              </>
            )}
            <p className="mt-[6px] text-[11.5px] leading-[1.5] text-muted">
              Only this Session&apos;s previews use it, not other Sessions and not localhost.
              Testing asks api.ipify.org for the address it sees.
            </p>
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                disabled={!enabled || busy || needsConfig}
                onClick={() => apply(true)}
                className="h-[30px] rounded-lg bg-accent px-[14px] text-[12.5px] font-bold text-black focus:outline-none focus-visible:ring-2 focus-visible:ring-fg disabled:opacity-50"
              >
                {busy ? 'Testing…' : 'Test and apply'}
              </button>
              {message ? (
                <span
                  role="status"
                  className={cx('text-[12px]', message.good ? 'text-accent' : 'text-red-400')}
                >
                  {message.text}
                </span>
              ) : null}
            </div>
          </div>
          <p className="mt-4 border-t border-line pt-[10px] text-[11.5px] leading-[1.5] text-muted">
            Real iOS Safari previews run in the Simulator, outside this app: they follow this
            Mac&apos;s own network, not the proxy.
          </p>
        </div>
      )}
    </Popover>
  );
};

export default NetworkButton;
