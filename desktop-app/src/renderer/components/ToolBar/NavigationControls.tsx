import {Icon} from '@iconify/react';
import cx from 'classnames';
import {useEffect, useRef, useState} from 'react';
import {webViewPubSub} from 'renderer/lib/pubsub';
import useKeyboardShortcut, {
  SHORTCUT_CHANNEL,
  ShortcutChannel,
} from '../KeyboardShortcutsManager/useKeyboardShortcut';
import {formatBytes, totalBytes, useWindowData, WindowDataRows} from '../WindowData';
import {IconButton} from './primitives';

export const NAVIGATION_EVENTS = {
  BACK: 'back',
  FORWARD: 'forward',
  RELOAD: 'reload',
};

interface NavigationItemProps {
  label: string;
  icon: string;
  shortcut: ShortcutChannel;
  action: () => void;
}

const TEST_ID_MAP: Record<string, string> = {
  Back: 'nav-back',
  Forward: 'nav-forward',
  Refresh: 'nav-refresh',
};

const NavigationButton = ({label, icon, shortcut, action}: NavigationItemProps) => {
  useKeyboardShortcut(shortcut, action);
  return (
    <IconButton onClick={action} title={label} data-testid={TEST_ID_MAP[label]}>
      <Icon icon={icon} />
    </IconButton>
  );
};

const ITEMS: NavigationItemProps[] = [
  {
    label: 'Back',
    icon: 'ic:round-arrow-back',
    shortcut: SHORTCUT_CHANNEL.BACK,
    action: () => {
      webViewPubSub.publish(NAVIGATION_EVENTS.BACK);
    },
  },
  {
    label: 'Forward',
    icon: 'ic:round-arrow-forward',
    shortcut: SHORTCUT_CHANNEL.FORWARD,
    action: () => {
      webViewPubSub.publish(NAVIGATION_EVENTS.FORWARD);
    },
  },
  {
    label: 'Refresh',
    icon: 'ic:round-refresh',
    shortcut: SHORTCUT_CHANNEL.RELOAD,
    action: () => {
      webViewPubSub.publish(NAVIGATION_EVENTS.RELOAD);
    },
  },
];

const TOAST_MS = 3000;

const NavigationControls = () => {
  const {usage, peak, phase, cleared, clear} = useWindowData({measure: false});
  const [toast, setToast] = useState(false);
  const hide = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(hide.current), []);

  // ⌘⇧R: empty this window's data (a Session's own profile) — cache, cookies,
  // storage, service workers — reload, and count the sizes down in a toast.
  const reloadClearingData = async () => {
    clearTimeout(hide.current);
    setToast(true);
    if (!(await clear(() => webViewPubSub.publish(NAVIGATION_EVENTS.RELOAD)))) return;
    hide.current = setTimeout(() => setToast(false), TOAST_MS);
  };
  useKeyboardShortcut(SHORTCUT_CHANNEL.RELOAD_CLEAR_CACHE, reloadClearingData);

  const done = phase === 'done';
  return (
    <div className="flex flex-shrink-0 gap-[2px]">
      {ITEMS.map((item) => (
        <NavigationButton {...item} key={item.label} />
      ))}
      {toast && usage ? (
        <div
          role="status"
          aria-live="polite"
          data-testid="clear-data-toast"
          className={cx(
            'absolute left-1/2 top-[calc(100%+8px)] z-50 flex w-[300px] -translate-x-1/2 flex-col gap-2 rounded-xl border bg-panel px-[14px] py-3 shadow-elevated',
            done ? 'border-accent' : 'border-line'
          )}
        >
          <div className="flex items-center gap-2">
            <span className="flex-1 text-[10.5px] font-bold uppercase tracking-[0.08em] text-muted">
              {done ? `Cleared ${formatBytes(cleared)} · reloaded` : 'Clearing this window…'}
            </span>
            <span className="rounded-[5px] border border-line bg-card px-[6px] text-[11.5px]">
              ⌘⇧R
            </span>
          </div>
          <div
            className={cx(
              'text-[26px] font-bold tabular-nums',
              done ? 'text-accent' : 'text-warning'
            )}
          >
            {formatBytes(totalBytes(usage))}
          </div>
          <WindowDataRows usage={usage} peak={peak} done={done} />
        </div>
      ) : null}
    </div>
  );
};

export default NavigationControls;
