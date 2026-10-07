import cx from 'classnames';
import {useCallback, useEffect, useRef, useState} from 'react';
import {Channels, IPC_MAIN_CHANNELS} from 'common/constants';
import type {WindowDataUsage} from 'main/webview-storage-manager';

const invoke = (channel: Channels) =>
  window.electron.ipcRenderer.invoke<never, WindowDataUsage>(channel);

export const formatBytes = (bytes: number) => {
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  if (bytes >= 1e3) return `${Math.round(bytes / 1e3)} KB`;
  return `${Math.round(bytes)} B`;
};

export const totalBytes = (u: WindowDataUsage) =>
  u.cache + u.cookieBytes + u.storage + u.serviceWorkers;

const KEYS = ['cache', 'cookies', 'cookieBytes', 'storage', 'serviceWorkers'] as const;
const lerp = (a: WindowDataUsage, b: WindowDataUsage, k: number) => {
  const out = {...a};
  KEYS.forEach((key) => {
    out[key] = a[key] + (b[key] - a[key]) * k;
  });
  return out;
};
const COUNT_MS = 1200;

export type ClearPhase = 'idle' | 'clearing' | 'done';

/**
 * This window's cache, cookies, site storage and service workers. `clear`
 * empties them all, then counts the numbers down from the real "before" to
 * the real "after" (a few KB of database bookkeeping may stay on disk).
 */
export const useWindowData = ({measure = true}: {measure?: boolean} = {}) => {
  const [usage, setUsage] = useState<WindowDataUsage | null>(null);
  const [peak, setPeak] = useState(1);
  const [phase, setPhase] = useState<ClearPhase>('idle');
  const [cleared, setCleared] = useState(0);
  const busy = useRef(false);
  const run = useRef(0);
  const frame = useRef(0);
  const endCount = useRef<() => void>(() => {});

  const show = (value: WindowDataUsage) => {
    setUsage(value);
    setPeak(Math.max(1, value.cache, value.cookieBytes, value.storage, value.serviceWorkers));
  };

  useEffect(() => {
    if (measure)
      Promise.resolve(invoke(IPC_MAIN_CHANNELS.WINDOW_DATA_USAGE))
        .then((value) => value && show(value))
        .catch(() => {});
    return () => cancelAnimationFrame(frame.current);
  }, [measure]);

  /**
   * Resolves once the count reaches the end, or false when this run was
   * ignored (a clear already in flight) or replaced (pressed again mid-count).
   * `onCleared` runs as soon as the data is gone.
   */
  const clear = useCallback(async (onCleared?: () => void) => {
    if (busy.current) return false;
    busy.current = true;
    const id = ++run.current;
    cancelAnimationFrame(frame.current);
    endCount.current();
    setPhase('clearing');
    let before: WindowDataUsage;
    let after: WindowDataUsage;
    try {
      before = await invoke(IPC_MAIN_CHANNELS.WINDOW_DATA_USAGE);
      show(before);
      after = await invoke(IPC_MAIN_CHANNELS.WINDOW_DATA_CLEAR);
    } catch {
      setPhase('idle');
      return true;
    } finally {
      busy.current = false;
    }
    onCleared?.();
    setCleared(Math.max(0, totalBytes(before) - totalBytes(after)));
    const start = performance.now();
    await new Promise<void>((resolve) => {
      endCount.current = resolve;
      const tick = (now: number) => {
        const k = Math.min(1, (now - start) / COUNT_MS);
        setUsage(lerp(before, after, k));
        if (k < 1) frame.current = requestAnimationFrame(tick);
        else resolve();
      };
      frame.current = requestAnimationFrame(tick);
    });
    if (id !== run.current) return false;
    setPhase('done');
    return true;
  }, []);

  return {usage, peak, phase, cleared, clear};
};

export const WindowDataRows = ({
  usage,
  peak,
  done,
  bars = false,
}: {
  usage: WindowDataUsage;
  peak: number;
  done: boolean;
  bars?: boolean;
}) => {
  const rows: Array<[string, number, string]> = [
    ['Cache', usage.cache, formatBytes(usage.cache)],
    [
      'Cookies',
      usage.cookieBytes,
      `${Math.round(usage.cookies)} · ${formatBytes(usage.cookieBytes)}`,
    ],
    ['Site storage', usage.storage, formatBytes(usage.storage)],
    ['Service workers', usage.serviceWorkers, formatBytes(usage.serviceWorkers)],
  ];
  return (
    <div className="flex flex-col gap-[6px]">
      {rows.map(([name, bytes, label]) => (
        <div key={name} className="flex items-center gap-[10px] text-[12.5px]">
          <span className={cx(bars ? 'w-[110px] text-fg' : 'text-muted')}>{name}</span>
          {bars ? (
            <span className="h-1 flex-1 overflow-hidden rounded-sm bg-line-soft">
              <span
                className={cx('block h-full', done ? 'bg-accent' : 'bg-blue-400')}
                style={{width: `${Math.max(2, (bytes / peak) * 100)}%`}}
              />
            </span>
          ) : null}
          <span
            className={cx(
              'ml-auto min-w-[72px] text-right tabular-nums',
              done ? 'text-accent' : 'text-fg'
            )}
          >
            {label}
          </span>
        </div>
      ))}
    </div>
  );
};
