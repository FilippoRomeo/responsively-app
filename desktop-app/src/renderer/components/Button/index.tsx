import React, {useEffect, useRef, useState} from 'react';
import cx from 'classnames';
import {Icon} from '@iconify/react';

interface CustomProps {
  className?: string;
  /**
   * Marks a toggle button. Passing it (either value) makes the button expose
   * `aria-pressed`, which is both the correct a11y contract and what tests
   * should assert on instead of styling classes.
   */
  isActive?: boolean;
  isLoading?: boolean;
  isPrimary?: boolean;
  isTextButton?: boolean;
  disableHoverEffects?: boolean;
  isActionButton?: boolean;
  subtle?: boolean;
  disabled?: boolean;
}

const Button = ({
  className = '',
  isActive,
  isLoading = false,
  isPrimary = false,
  isTextButton = false,
  isActionButton = false,
  subtle: _subtle = false,
  disableHoverEffects = false,
  disabled = false,
  children,
  ...props
}: CustomProps &
  React.DetailedHTMLProps<React.ButtonHTMLAttributes<HTMLButtonElement>, HTMLButtonElement>) => {
  const [isLoadingDone, setIsLoadingDone] = useState<boolean>(false);
  const prevLoadingState = useRef(false);

  useEffect(() => {
    if (!isLoading && prevLoadingState.current === true) {
      setIsLoadingDone(true);
      setTimeout(() => {
        setIsLoadingDone(false);
      }, 800);
    }
    prevLoadingState.current = isLoading;
  }, [isLoading]);

  // Theme tokens (App.css) — one value per theme, no dark: variants. `subtle`
  // is kept for callers; the token hover is already the subtle one.
  const hoverBg = isPrimary ? 'hover:brightness-110' : 'hover:bg-hover';

  return (
    <button
      className={cx(
        {[className]: className?.length},
        `flex items-center justify-center rounded-sm p-1 ${
          disableHoverEffects === false ? hoverBg : ''
        } focus:outline-none focus-visible:ring-1 focus-visible:ring-accent`,
        {
          'bg-active': isActive && !isPrimary,
          'bg-accent text-on-accent': isPrimary,
          'bg-active text-fg': isActionButton,
          'px-2': isActionButton || isTextButton,
          'cursor-not-allowed opacity-40': disabled,
          'hover:bg-transparent dark:hover:bg-transparent': disabled,
        }
      )}
      type="button"
      disabled={disabled}
      aria-pressed={isActive}
      {...props}
    >
      {/* pointer-events-none keeps mouse events targeting the stable button
          node — icon SVGs can be re-rendered mid-click (e.g. by an input
          blur), which makes the browser drop the click entirely. */}
      <span className="pointer-events-none contents">
        {isLoading ? <Icon icon="line-md:loading-twotone-loop" /> : null}
        {isLoadingDone ? <Icon icon="line-md:circle-to-confirm-circle-transition" /> : null}
        {!isLoading && !isLoadingDone ? children : null}
      </span>
    </button>
  );
};

export default Button;
