import cx from 'classnames';
import type {IosSimRequest, IosSimState} from 'common/ios-simulator';
import {useCallback, useEffect, useState} from 'react';
import {formatGB, iosSim, runtimeLabel} from 'renderer/components/IosSafari';

const btn = 'h-7 whitespace-nowrap rounded-[7px] border px-3 text-[12.5px] disabled:opacity-50';

/** Two clicks to delete: the first asks, the second deletes. */
const DeleteButton = ({sizeBytes, onDelete}: {sizeBytes: number; onDelete: () => void}) => {
  const [asking, setAsking] = useState(false);
  return (
    <button
      type="button"
      onClick={() => (asking ? onDelete() : setAsking(true))}
      onBlur={() => setAsking(false)}
      className={cx(btn, 'border-red-500 text-red-400 hover:bg-hover')}
    >
      {asking ? `Delete ${formatGB(sizeBytes)}?` : 'Delete'}
    </button>
  );
};

/**
 * Settings › Browsers: the iOS versions and the Simulators this app made, with
 * their disk use, so a version or Simulator nobody needs can be removed.
 */
export const BrowsersSettings = () => {
  const [state, setState] = useState<IosSimState | null>(null);
  const [busy, setBusy] = useState('');
  const refresh = useCallback(() => {
    Promise.resolve(iosSim<IosSimState>({operation: 'list'}))
      .then((value) => value && setState(value))
      .catch(() => {});
  }, []);
  useEffect(refresh, [refresh]);

  const run = async (key: string, req: IosSimRequest) => {
    setBusy(key);
    try {
      await iosSim(req);
    } finally {
      setBusy('');
      refresh();
    }
  };

  if (state === null) return <p className="my-4 text-sm text-muted">Looking for iOS versions…</p>;
  if (!state.available) return <p className="my-4 text-sm text-muted">{state.reason}</p>;

  const total =
    state.runtimes.reduce((a, r) => a + r.sizeBytes, 0) +
    state.devices.reduce((a, d) => a + d.sizeBytes, 0);
  const running = state.devices.filter((d) => d.booted).length;

  return (
    <div data-testid="settings-browsers" className="my-4 flex flex-col gap-3 text-sm">
      <p className="text-muted">
        Real Safari runs in the iOS Simulator. AI agents and the device picker use the versions
        below; delete any you no longer use.
      </p>
      <div className="flex items-baseline gap-2">
        <span className="text-[22px] font-bold tabular-nums">{formatGB(total)}</span>
        <span className="text-muted">
          on disk · {running} Simulator{running === 1 ? '' : 's'} running
        </span>
      </div>
      <div className="rounded-[10px] border border-line bg-card">
        <div className="px-3 pb-2 pt-[10px] text-[10px] font-bold uppercase tracking-[0.08em] text-muted">
          iOS versions
        </div>
        {state.runtimes.length === 0 ? (
          <div className="border-t border-line-soft px-3 py-[10px] text-muted">
            None installed. Add one in Xcode › Settings › Components.
          </div>
        ) : null}
        {state.runtimes.map((r) => (
          <div
            key={r.id}
            className="flex items-center gap-[10px] border-t border-line-soft px-3 py-[10px]"
          >
            <span className="flex-1">{r.name}</span>
            <span className="min-w-[64px] text-right tabular-nums">{formatGB(r.sizeBytes)}</span>
            {r.deletable ? (
              <DeleteButton
                sizeBytes={r.sizeBytes}
                onDelete={() => run(r.id, {operation: 'delete-runtime', runtime: r.id})}
              />
            ) : null}
          </div>
        ))}
      </div>
      <div className="rounded-[10px] border border-line bg-card">
        <div className="px-3 pb-2 pt-[10px] text-[10px] font-bold uppercase tracking-[0.08em] text-muted">
          Simulators
        </div>
        {state.devices.length === 0 ? (
          <div className="border-t border-line-soft px-3 py-[10px] text-muted">
            None yet — pick iOS Safari on a device to make one.
          </div>
        ) : null}
        {state.devices.map((d) => (
          <div
            key={d.udid}
            className="flex items-center gap-[10px] border-t border-line-soft px-3 py-[10px]"
          >
            <span className="flex-1">
              {d.name} · {runtimeLabel(d.runtime)}
              <span className="block text-[11.5px] text-muted">
                {d.booted ? 'Running' : 'Stopped'}
              </span>
            </span>
            <span className="min-w-[64px] text-right tabular-nums">{formatGB(d.sizeBytes)}</span>
            {d.booted ? (
              <button
                type="button"
                disabled={busy === d.udid}
                onClick={() => run(d.udid, {operation: 'stop', udid: d.udid})}
                className={cx(btn, 'border-line text-fg hover:bg-hover')}
              >
                Stop
              </button>
            ) : null}
            <DeleteButton
              sizeBytes={d.sizeBytes}
              onDelete={() => run(d.udid, {operation: 'delete-device', udid: d.udid})}
            />
          </div>
        ))}
      </div>
    </div>
  );
};
