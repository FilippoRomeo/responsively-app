import cx from 'classnames';
import {ReactNode} from 'react';

type Props = {
  /** Icon or check mark before the label. */
  leading?: ReactNode;
  label: ReactNode;
  /** A second, muted line. */
  sub?: ReactNode;
  /** Right-aligned note, count or chevron. */
  trailing?: ReactNode;
  bold?: boolean;
  className?: string;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'>;

/** One row of a popover menu (⋮ menu, Simulate, Site tools, browser picker…). */
const MenuRow = ({leading, label, sub, trailing, bold, className, ...props}: Props) => (
  <button
    type="button"
    className={cx(
      'flex w-full items-center gap-[10px] rounded-control px-[10px] py-[7px] text-left text-fg hover:bg-hover focus:outline-none focus-visible:bg-hover disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent',
      className
    )}
    {...props}
  >
    {/* pointer-events-none: icons swapped mid-click must not swallow it. */}
    <span className="pointer-events-none contents">
      {leading}
      <span className="min-w-0 flex-1">
        <span className={cx('block text-body', {'font-bold': bold})}>{label}</span>
        {sub ? <span className="block text-[11.5px] text-muted">{sub}</span> : null}
      </span>
      {trailing}
    </span>
  </button>
);

export default MenuRow;
