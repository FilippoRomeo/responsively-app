import {Dialog, DialogPanel, DialogTitle} from '@headlessui/react';
import {Icon} from '@iconify/react';
import cx from 'classnames';
import {ReactNode} from 'react';
import useOverlayRegistry from 'renderer/hooks/useOverlayRegistry';

interface Props {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** Right of the title, before the close button (e.g. a stack picker). */
  actions?: ReactNode;
  /** `md` fits forms; `lg` fits two-pane managers. */
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  children: ReactNode;
}

const SIZES = {
  sm: 'w-[min(420px,94vw)]',
  md: 'w-[min(640px,94vw)]',
  lg: 'h-[min(700px,90vh)] w-[min(1060px,94vw)]',
};

/**
 * The app's dialog: themed panel, title row with close, focus trapped and
 * Escape to close (Headless UI), and docked devtools step aside while open.
 */
const DialogShell = ({open, onClose, title, actions, size = 'md', className, children}: Props) => {
  useOverlayRegistry(open);
  return (
    <Dialog open={open} onClose={onClose} className="relative z-50">
      <div className="fixed inset-0 bg-black/50" aria-hidden="true" />
      <div className="fixed inset-0 flex items-center justify-center p-6">
        <DialogPanel
          className={cx(
            'flex max-h-[90vh] flex-col overflow-hidden rounded-dialog border border-line bg-panel text-fg shadow-elevated',
            SIZES[size],
            className
          )}
        >
          <div className="flex items-center gap-3 border-b border-line-soft px-4 py-3">
            <DialogTitle className="m-0 text-title font-bold">{title}</DialogTitle>
            <span className="flex-1" />
            {actions}
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-fg focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
            >
              <Icon icon="lucide:x" />
            </button>
          </div>
          {children}
        </DialogPanel>
      </div>
    </Dialog>
  );
};

export default DialogShell;
