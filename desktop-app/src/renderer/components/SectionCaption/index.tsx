import cx from 'classnames';
import {ReactNode} from 'react';

/** The small uppercase heading over a group of rows or controls. */
const SectionCaption = ({children, className}: {children: ReactNode; className?: string}) => (
  <div
    className={cx(
      'text-[10.5px] font-bold uppercase tracking-[0.08em] text-muted',
      className ?? 'px-[10px] pb-[3px] pt-[10px]'
    )}
  >
    {children}
  </div>
);

export default SectionCaption;
