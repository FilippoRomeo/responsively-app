import {Icon} from '@iconify/react';
import cx from 'classnames';
import {
  DEFAULT_TOOLBAR_LAYOUT,
  isHidden,
  moveTool,
  TOOL_INFO,
  toggleToolHidden,
  type ToolId,
  type ToolSection,
} from 'common/toolbar-layout';
import {useRef, useState} from 'react';
import {useDispatch, useSelector} from 'react-redux';
import Modal from 'renderer/components/Modal';
import Toggle from 'renderer/components/Toggle';
import {selectToolbarLayout, setToolbarLayout} from 'renderer/store/features/ui';

const SECTIONS: {section: ToolSection; title: string}[] = [
  {section: 'group', title: 'In the “All devices” group'},
  {section: 'right', title: 'On the right of the bar'},
];

const Arrow = ({
  label,
  icon,
  disabled,
  onClick,
}: {
  label: string;
  icon: string;
  disabled: boolean;
  onClick: () => void;
}) => (
  <button
    type="button"
    aria-label={label}
    disabled={disabled}
    onClick={onClick}
    className="flex h-6 w-6 items-center justify-center rounded-md text-[13px] text-muted hover:bg-hover hover:text-fg focus:outline-none focus-visible:ring-1 focus-visible:ring-accent disabled:opacity-25 disabled:hover:bg-transparent"
  >
    <span className="pointer-events-none contents">
      <Icon icon={icon} />
    </span>
  </button>
);

/**
 * Show, hide and reorder the toolbar's buttons. Changes apply at once and are
 * saved for every window; hidden buttons stay under ⋮ › More tools.
 */
const ToolbarCustomizer = ({isOpen, onClose}: {isOpen: boolean; onClose: () => void}) => {
  const dispatch = useDispatch();
  const layout = useSelector(selectToolbarLayout);
  // Native drag and drop within one section; ↑ ↓ do the same from the keyboard.
  const dragging = useRef<{section: ToolSection; index: number} | null>(null);
  const [dragged, setDragged] = useState<ToolId | null>(null);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Customize toolbar">
      <div data-testid="toolbar-customizer" className="w-[440px] max-w-full">
        <p className="-mt-2 mb-3 text-[12px] text-muted">
          Drag a row, or use the arrows, to reorder. Hidden buttons stay under ⋮ › More tools.
        </p>
        {SECTIONS.map(({section, title}) => (
          <div key={section} className="mb-3">
            <div className="px-2 pb-1 text-[10px] font-bold uppercase tracking-[0.08em] text-muted">
              {title}
            </div>
            <ul>
              {layout[section].map((id, index, list) => (
                <li
                  key={id}
                  data-testid={`customize-row-${id}`}
                  draggable
                  onDragStart={() => {
                    dragging.current = {section, index};
                    setDragged(id);
                  }}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => {
                    const from = dragging.current;
                    if (from && from.section === section)
                      dispatch(setToolbarLayout(moveTool(layout, section, from.index, index)));
                    dragging.current = null;
                    setDragged(null);
                  }}
                  onDragEnd={() => {
                    dragging.current = null;
                    setDragged(null);
                  }}
                  className={cx(
                    'flex items-center gap-[10px] rounded-lg px-2 py-[6px] text-[13px]',
                    dragged === id ? 'bg-hover opacity-60' : 'hover:bg-hover/50'
                  )}
                >
                  <Icon icon="lucide:grip-vertical" className="cursor-grab text-muted" />
                  <Icon
                    icon={TOOL_INFO[id].icon}
                    fontSize={16}
                    className={isHidden(layout, id) ? 'text-muted' : undefined}
                  />
                  <span className={cx('flex-1', {'text-muted': isHidden(layout, id)})}>
                    {TOOL_INFO[id].name}
                  </span>
                  <Arrow
                    label={`Move ${TOOL_INFO[id].name} up`}
                    icon="lucide:chevron-up"
                    disabled={index === 0}
                    onClick={() =>
                      dispatch(setToolbarLayout(moveTool(layout, section, index, index - 1)))
                    }
                  />
                  <Arrow
                    label={`Move ${TOOL_INFO[id].name} down`}
                    icon="lucide:chevron-down"
                    disabled={index === list.length - 1}
                    onClick={() =>
                      dispatch(setToolbarLayout(moveTool(layout, section, index, index + 1)))
                    }
                  />
                  <Toggle
                    isOn={!isHidden(layout, id)}
                    aria-label={`Show ${TOOL_INFO[id].name}`}
                    onChange={() => dispatch(setToolbarLayout(toggleToolHidden(layout, id)))}
                  />
                </li>
              ))}
            </ul>
          </div>
        ))}
        <div className="mt-2 flex items-center gap-[10px] border-t border-line-soft pt-3">
          <span className="flex-1 text-[11.5px] text-muted">
            Saved on this Mac, for every Session window.
          </span>
          <button
            type="button"
            onClick={() => dispatch(setToolbarLayout(DEFAULT_TOOLBAR_LAYOUT))}
            className="h-[30px] rounded-[7px] border border-line px-3 text-[12.5px] hover:bg-hover focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
          >
            Reset to default
          </button>
          <button
            type="button"
            onClick={onClose}
            className="h-[30px] rounded-[7px] bg-accent px-[14px] text-[12.5px] font-bold text-on-accent focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
          >
            Done
          </button>
        </div>
      </div>
    </Modal>
  );
};

export default ToolbarCustomizer;
