import {useId} from 'react';

interface Props {
  isOn: boolean;
  onChange?: React.ChangeEventHandler<HTMLInputElement>;
  'aria-label'?: string;
  disabled?: boolean;
}

/**
 * The app's one on/off switch: a checkbox announced as a switch, with an off
 * track that stays visible against panels (WCAG 1.4.11).
 */
const Toggle = ({isOn, onChange, 'aria-label': ariaLabel, disabled = false}: Props) => {
  const id = useId();
  return (
    <label
      htmlFor={id}
      className={`relative inline-flex shrink-0 items-center ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
    >
      <input
        type="checkbox"
        role="switch"
        checked={isOn}
        id={id}
        disabled={disabled}
        className="peer sr-only"
        onChange={onChange}
        aria-label={ariaLabel}
      />
      <div className="peer h-5 w-9 rounded-full bg-control-off after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-all after:content-[''] peer-checked:bg-accent peer-checked:after:translate-x-full peer-focus-visible:ring-2 peer-focus-visible:ring-accent peer-focus-visible:ring-offset-1 peer-focus-visible:ring-offset-panel" />
    </label>
  );
};

export default Toggle;
