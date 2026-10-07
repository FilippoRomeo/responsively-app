import {Icon} from '@iconify/react';
import {useState} from 'react';
import Popover from 'renderer/components/Popover';
import MenuRow from 'renderer/components/MenuRow';
import SectionCaption from 'renderer/components/SectionCaption';
import Toggle from 'renderer/components/Toggle';

const hostLabel = (address: string): string => {
  if (address.startsWith('file://')) {
    return 'LOCAL FILE';
  }
  try {
    return new URL(address).host.toUpperCase();
  } catch {
    return 'THIS SITE';
  }
};

interface Action {
  title: string;
  label: string;
  icon: string;
  note: string;
  isLoading: boolean;
  run: () => void;
}

interface Props {
  address: string;
  actions: Action[];
  onShowPermissions: () => void;
}

/**
 * The site-tools menu behind the address bar's globe button: per-site data
 * actions plus the permissions entry point (Hybrid Studio design).
 */
const SiteToolsPopover = ({address, actions, onShowPermissions}: Props) => {
  const [sslAllowed, setSslAllowed] = useState<boolean>(
    Boolean(window.electron.store.get('userPreferences.allowInsecureSSLConnections'))
  );
  return (
    <Popover
      triggerTitle="Site tools"
      triggerClassName="flex h-[26px] items-center justify-center gap-[2px] rounded-full px-2 text-[15px] text-muted hover:bg-hover hover:text-fg"
      anchor="bottom start"
      className="w-[264px] p-[6px]"
      trigger={
        <span className="pointer-events-none contents">
          <Icon icon="mdi:web" />
          <Icon icon="mdi:chevron-down" fontSize={12} />
        </span>
      }
    >
      {({close}) => (
        <>
          <SectionCaption className="px-[10px] pb-1 pt-2">
            Site data — {hostLabel(address)}
          </SectionCaption>
          {actions.map((action) => (
            <MenuRow
              key={action.title}
              title={action.title}
              onClick={() => {
                // Close first: the action's loading state re-renders this
                // subtree, and a menu that stays open also traps focus,
                // which silently breaks keyboard shortcuts app-wide.
                close();
                action.run();
              }}
              leading={
                <Icon
                  icon={action.isLoading ? 'line-md:loading-twotone-loop' : action.icon}
                  className="text-muted"
                  fontSize={16}
                />
              }
              label={action.label}
              trailing={<span className="text-caption text-muted">{action.note}</span>}
            />
          ))}
          <div className="mx-1 my-[6px] border-t border-line-soft" />
          <div
            data-testid="ssl-toggle-row"
            className="flex items-center justify-between px-[10px] py-2"
          >
            <span className="text-[13.5px] text-fg">Allow insecure SSL</span>
            <Toggle
              isOn={sslAllowed}
              aria-label="Allow insecure SSL"
              onChange={(e) => {
                setSslAllowed(e.target.checked);
                window.electron.store.set(
                  'userPreferences.allowInsecureSSLConnections',
                  e.target.checked
                );
              }}
            />
          </div>
          <MenuRow
            title="Site permissions"
            onClick={() => {
              close();
              onShowPermissions();
            }}
            leading={<Icon icon="mdi:shield-key-outline" className="text-muted" fontSize={16} />}
            label="Site permissions"
          />
        </>
      )}
    </Popover>
  );
};

export default SiteToolsPopover;
