import {Icon} from '@iconify/react';
import {DOCK_POSITION} from 'common/constants';
import {ReactNode, useState} from 'react';
import {useDispatch, useSelector} from 'react-redux';
import MenuRow from 'renderer/components/MenuRow';
import Modal from 'renderer/components/Modal';
import Toggle from 'renderer/components/Toggle';
import {selectDockPosition, setDockPosition} from 'renderer/store/features/devtools';
import {selectClassicToolbar, selectToolbarLayout} from 'renderer/store/features/ui';
import {TOOL_INFO} from 'common/toolbar-layout';
import ToolbarCustomizer from '../../ToolbarCustomizer';
import {MANAGE_SESSIONS_EVENT} from 'renderer/components/Sessions';
import ShortcutsModal from '../../Shortcuts/ShortcutsModal';
import Bookmark from './Bookmark';
import {SettingsContent} from './Settings/SettingsContent';

interface MenuItemProps {
  icon: string;
  iconClassName?: string;
  label: string;
  trailing?: ReactNode;
  onClick: () => void;
}

/** One 232px-panel row (Hybrid Studio kebab menu). */
export const MenuItem = ({icon, iconClassName, label, trailing, onClick}: MenuItemProps) => (
  <MenuRow
    onClick={onClick}
    leading={<Icon icon={icon} fontSize={15} className={iconClassName ?? 'text-muted'} />}
    label={label}
    trailing={trailing}
  />
);

interface Props {
  closeFlyout: () => void;
}

const MenuFlyout = ({closeFlyout}: Props) => {
  const dispatch = useDispatch();
  const dockPosition = useSelector(selectDockPosition);
  const classic = useSelector(selectClassicToolbar);
  const layout = useSelector(selectToolbarLayout);
  const [isCustomizeOpen, setIsCustomizeOpen] = useState<boolean>(false);
  // Hidden buttons, in toolbar order, each opened through its real (invisible) button.
  const hiddenTools = [...layout.group, ...layout.right].filter((id) => layout.hidden.includes(id));
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [isShortcutsOpen, setIsShortcutsOpen] = useState<boolean>(false);

  return (
    <>
      <div className="absolute right-0 top-[30px] z-50 w-[232px] rounded-[10px] border border-line bg-panel p-[6px] text-fg shadow-elevated focus:outline-none">
        {classic ? null : (
          <MenuItem
            icon="lucide:panels-top-left"
            label="Manage Sessions…"
            trailing={<span className="text-[11px] text-muted">⌘⇧M</span>}
            onClick={() => {
              closeFlyout();
              window.dispatchEvent(new Event(MANAGE_SESSIONS_EVENT));
            }}
          />
        )}
        <Bookmark />
        {classic ? null : (
          <>
            <div className="mx-1 my-[6px] border-t border-line-soft" />
            <div className="px-[10px] pb-1 pt-2 text-[10px] font-bold uppercase tracking-[0.08em] text-muted">
              More tools
            </div>
            {hiddenTools.length === 0 ? (
              <div className="px-[10px] pb-2 text-[12px] text-muted">Nothing is hidden.</div>
            ) : null}
            {hiddenTools.map((id) => (
              <MenuItem
                key={id}
                icon={TOOL_INFO[id].icon}
                label={TOOL_INFO[id].name}
                onClick={() => {
                  closeFlyout();
                  document
                    .querySelector<HTMLElement>(
                      `[data-tool="${id}"] button[title^="${TOOL_INFO[id].button}"]`
                    )
                    ?.click();
                }}
              />
            ))}
            <MenuItem
              icon="lucide:sliders-horizontal"
              iconClassName="text-accent"
              label="Customize toolbar…"
              onClick={() => {
                closeFlyout();
                setIsCustomizeOpen(true);
              }}
            />
          </>
        )}
        <div className="mx-1 my-[6px] border-t border-line-soft" />
        <div className="flex items-center justify-between px-[10px] py-2">
          <span className="text-[13.5px]">Dock devtools</span>
          <Toggle
            isOn={dockPosition !== DOCK_POSITION.UNDOCKED}
            aria-label="Dock devtools"
            onChange={(e) =>
              dispatch(
                setDockPosition(e.target.checked ? DOCK_POSITION.BOTTOM : DOCK_POSITION.UNDOCKED)
              )
            }
          />
        </div>
        <MenuItem
          icon="lucide:settings"
          label="Settings"
          onClick={() => {
            closeFlyout();
            setIsSettingsOpen(true);
          }}
        />
        <MenuItem
          icon="iconoir:apple-shortcuts"
          label="Keyboard shortcuts"
          onClick={() => {
            closeFlyout();
            setIsShortcutsOpen(true);
          }}
        />
      </div>
      <Modal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} title="Settings">
        <SettingsContent onClose={() => setIsSettingsOpen(false)} />
      </Modal>
      <ToolbarCustomizer isOpen={isCustomizeOpen} onClose={() => setIsCustomizeOpen(false)} />
      <ShortcutsModal isOpen={isShortcutsOpen} onClose={() => setIsShortcutsOpen(false)} />
    </>
  );
};

export default MenuFlyout;
