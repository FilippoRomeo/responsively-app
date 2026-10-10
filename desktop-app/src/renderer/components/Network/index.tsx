import {Icon} from '@iconify/react';
import cx from 'classnames';
import {IPC_MAIN_CHANNELS} from 'common/constants';
import {useEffect, useState} from 'react';
import Popover from 'renderer/components/Popover';

interface ProxyState {
  enabled: boolean;
  address: string;
}
type Result = {ok: true; ip: string | null} | {ok: false; error: string};

/** Network for this Session: send its previews through a proxy. */
const NetworkButton = () => {
  const [state, setState] = useState<ProxyState>({enabled: false, address: ''});
  const [address, setAddress] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{good: boolean; text: string} | null>(null);

  useEffect(() => {
    window.electron.ipcRenderer
      .invoke<unknown, ProxyState>(IPC_MAIN_CHANNELS.PROXY_GET)
      .then((value) => {
        setState(value);
        setEnabled(value.enabled);
        setAddress(value.address);
        return value;
      })
      .catch(() => {});
  }, []);

  const apply = async (nextEnabled: boolean) => {
    setBusy(true);
    setMessage(null);
    const result = await window.electron.ipcRenderer.invoke<unknown, Result>(
      IPC_MAIN_CHANNELS.PROXY_SET,
      {enabled: nextEnabled, address}
    );
    setBusy(false);
    if (result.ok) {
      setState({enabled: nextEnabled, address});
      setMessage(
        nextEnabled
          ? {good: true, text: `Works. Pages now leave from ${result.ip}.`}
          : {good: true, text: 'The proxy is off.'}
      );
    } else setMessage({good: false, text: result.error});
  };

  return (
    <Popover
      triggerTitle="Network for this Session"
      anchor="bottom end"
      className="w-[380px] p-4"
      triggerClassName={cx(
        'flex h-[30px] items-center gap-[6px] rounded-lg px-[7px] text-[16px] transition-colors',
        state.enabled ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-hover hover:text-fg'
      )}
      trigger={
        <span className="pointer-events-none contents" data-testid="network-button">
          <Icon icon="lucide:globe" />
          {state.enabled ? <span className="text-[11.5px]">proxy</span> : null}
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
            Send this Session&apos;s pages through a proxy
          </label>
          <div className={cx('mt-3', enabled ? '' : 'opacity-50')}>
            <div className="mb-[6px] text-[10px] font-bold uppercase tracking-[0.08em] text-muted">
              Proxy address
            </div>
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
              supported yet). Only this Session&apos;s previews use it; other Sessions do not, and
              neither does localhost. Testing asks api.ipify.org for the address it sees.
            </p>
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                disabled={!enabled || busy}
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
