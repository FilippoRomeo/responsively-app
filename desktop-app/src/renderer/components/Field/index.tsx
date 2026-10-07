import cx from 'classnames';
import {ReactNode, useId} from 'react';

interface Props {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  className?: string;
  /** Receives the id to put on the control, so the label and hints point at it. */
  children: (control: {
    id: string;
    'aria-describedby'?: string;
    'aria-invalid'?: true;
  }) => ReactNode;
}

/** A visible label, the control, then a hint or an error (WCAG 3.3.1/3.3.2). */
const Field = ({label, hint, error, className, children}: Props) => {
  const id = useId();
  const described = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className={cx('flex flex-col gap-1', className)}>
      <label htmlFor={id} className="text-small text-muted">
        {label}
      </label>
      {children({
        id,
        'aria-describedby': described,
        ...(error ? {'aria-invalid': true as const} : {}),
      })}
      {error ? (
        <p id={`${id}-error`} role="alert" className="m-0 text-small text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="m-0 text-small text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
};

export const inputClass =
  'h-8 rounded-md border border-line bg-input px-2 text-body text-fg focus:outline-none focus-visible:ring-1 focus-visible:ring-accent aria-[invalid=true]:border-danger';

export default Field;
