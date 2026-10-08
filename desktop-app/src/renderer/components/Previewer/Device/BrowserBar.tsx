import {Icon} from '@iconify/react';
import cx from 'classnames';
import type {WebviewLocation} from './useWebviewLocation';

interface Props {
  width: number;
  /** Corner radius of the screen this bar sits on top of. */
  radius: number;
  dark: boolean;
  location: WebviewLocation;
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
  onStop: () => void;
}

const NavButton = ({
  title,
  icon,
  disabled = false,
  onClick,
}: {
  title: string;
  icon: string;
  disabled?: boolean;
  onClick: () => void;
}) => (
  <button
    type="button"
    title={title}
    aria-label={title}
    disabled={disabled}
    onClick={onClick}
    className="flex h-5 w-5 items-center justify-center rounded text-[13px] hover:bg-black/10 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent disabled:opacity-30 disabled:hover:bg-transparent"
  >
    <span className="pointer-events-none contents">
      <Icon icon={icon} />
    </span>
  </button>
);

/**
 * A browser's chrome above one laptop preview: the page's own title, address
 * and history, live. It sits outside the page, so it takes no pixels from it.
 * Back, forward, reload and stop act on this device only.
 */
const BrowserBar = ({
  width,
  radius,
  dark,
  location,
  onBack,
  onForward,
  onReload,
  onStop,
}: Props) => (
  <div
    data-testid="browser-bar"
    style={{width, borderRadius: `${radius}px ${radius}px 0 0`}}
    className={cx(
      'flex-shrink-0 overflow-hidden border-b',
      dark
        ? 'border-[#2b2f37] bg-[#1c1f25] text-[#a9aeb8]'
        : 'border-[#c8ccd4] bg-[#dfe2e8] text-[#5b6472]'
    )}
  >
    <div className="flex h-[22px] items-end gap-2 px-2">
      <span className="flex gap-[5px] self-center" aria-hidden>
        <i className="h-[9px] w-[9px] rounded-full bg-[#ff5f57]" />
        <i className="h-[9px] w-[9px] rounded-full bg-[#febc2e]" />
        <i className="h-[9px] w-[9px] rounded-full bg-[#28c840]" />
      </span>
      <span
        data-testid="browser-bar-title"
        className={cx(
          'ml-2 h-[18px] max-w-[240px] truncate rounded-t-md px-3 text-[11px] leading-[18px]',
          dark ? 'bg-[#262a32] text-[#e4e4e7]' : 'bg-[#f4f5f8] text-[#1f2328]'
        )}
      >
        {location.title || 'New tab'}
      </span>
    </div>
    <div
      className={cx(
        'flex h-[28px] items-center gap-1 px-2',
        dark ? 'bg-[#262a32]' : 'bg-[#f4f5f8]'
      )}
    >
      <NavButton
        title="Back"
        icon="lucide:arrow-left"
        disabled={!location.canGoBack}
        onClick={onBack}
      />
      <NavButton
        title="Forward"
        icon="lucide:arrow-right"
        disabled={!location.canGoForward}
        onClick={onForward}
      />
      {location.loading ? (
        <NavButton title="Stop loading" icon="lucide:x" onClick={onStop} />
      ) : (
        <NavButton title="Reload" icon="lucide:rotate-cw" onClick={onReload} />
      )}
      <span
        data-testid="browser-bar-url"
        className={cx(
          'ml-1 h-5 min-w-0 flex-1 truncate rounded-full px-3 font-mono text-[11px] leading-5',
          dark ? 'bg-[#14161a]' : 'bg-[#e6e8ee]'
        )}
      >
        {location.url}
      </span>
    </div>
  </div>
);

export default BrowserBar;
