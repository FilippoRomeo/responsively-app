import {Icon} from '@iconify/react';
import {webViewPubSub} from 'renderer/lib/pubsub';
import useKeyboardShortcut, {
  SHORTCUT_CHANNEL,
  ShortcutChannel,
} from '../KeyboardShortcutsManager/useKeyboardShortcut';
import {ADDRESS_BAR_EVENTS} from './AddressBar';
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

// ⌘⇧R: clear this window's HTTP cache (a Session's own profile), then reload.
// Cookies and site storage are kept.
const reloadClearingCache = async () => {
  await webViewPubSub.publish(ADDRESS_BAR_EVENTS.DELETE_CACHE);
  await webViewPubSub.publish(NAVIGATION_EVENTS.RELOAD);
};

const NavigationControls = () => {
  useKeyboardShortcut(SHORTCUT_CHANNEL.RELOAD_CLEAR_CACHE, reloadClearingCache);
  return (
    <div className="flex flex-shrink-0 gap-[2px]">
      {ITEMS.map((item) => (
        <NavigationButton {...item} key={item.label} />
      ))}
    </div>
  );
};

export default NavigationControls;
