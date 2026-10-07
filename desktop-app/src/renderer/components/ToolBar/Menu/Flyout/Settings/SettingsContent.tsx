import cx from 'classnames';
import {useId, useState} from 'react';
import {useDispatch, useSelector} from 'react-redux';

import Button from 'renderer/components/Button';
import {
  formatBytes,
  totalBytes,
  useWindowData,
  WindowDataRows,
} from 'renderer/components/WindowData';
import {selectClassicToolbar, setClassicToolbar} from 'renderer/store/features/ui';
import {BrowsersSettings} from './BrowsersSettings';
import {SettingsContentHeaders} from './SettingsContentHeaders';

const WindowDataCard = () => {
  const {usage, peak, phase, clear} = useWindowData();
  const done = phase === 'done';
  const total = usage ? totalBytes(usage) : 0;
  return (
    <div
      data-testid="settings-window-data"
      className="my-4 flex flex-col gap-3 rounded-[10px] border border-line bg-card p-3"
    >
      <div className="flex items-center gap-3">
        <span
          className={cx('flex-1 text-[22px] font-bold tabular-nums', {
            'text-accent': done,
            'text-amber-400': !done && total > 30e6,
          })}
        >
          {usage ? `${formatBytes(total)}${done ? ' — cleared' : ''}` : 'Measuring…'}
        </span>
        <button
          type="button"
          data-testid="settings-clear-window-data"
          disabled={phase === 'clearing'}
          onClick={() => clear()}
          className={cx(
            'h-[30px] whitespace-nowrap rounded-[7px] border px-3 text-[13px] disabled:opacity-60',
            done ? 'border-accent text-accent' : 'border-red-500 text-red-400 hover:bg-hover'
          )}
        >
          {done ? 'Cleared ✓' : 'Clear everything'}
        </button>
      </div>
      {usage ? <WindowDataRows usage={usage} peak={peak} done={done} bars /> : null}
      <p className="text-sm text-gray-500 dark:text-gray-400">
        This window&apos;s cache and cookies, and the storage and service workers of the sites open
        in it. Clearing empties every site&apos;s; ⌘⇧R does the same and reloads.
      </p>
    </div>
  );
};

interface Props {
  onClose: () => void;
}

export const SettingsContent = ({onClose}: Props) => {
  const id = useId();
  const dispatch = useDispatch();
  const classicToolbar = useSelector(selectClassicToolbar);
  const [screenshotSaveLocation, setScreenshotSaveLocation] = useState<string>(
    window.electron.store.get('userPreferences.screenshot.saveLocation')
  );
  const [webRequestHeaderAcceptLanguage, setWebRequestHeaderAcceptLanguage] = useState<string>(
    window.electron.store.get('userPreferences.webRequestHeaderAcceptLanguage')
  );
  const [popupBehavior, setPopupBehavior] = useState<string>(
    window.electron.store.get('userPreferences.popupBehavior') ?? 'in-preview'
  );
  const [locationError, setLocationError] = useState<boolean>(false);

  const onSave = () => {
    if (screenshotSaveLocation === '' || screenshotSaveLocation == null) {
      setLocationError(true);
      return;
    }

    window.electron.store.set('userPreferences.screenshot.saveLocation', screenshotSaveLocation);

    window.electron.store.set(
      'userPreferences.webRequestHeaderAcceptLanguage',
      webRequestHeaderAcceptLanguage
    );

    window.electron.store.set('userPreferences.popupBehavior', popupBehavior);

    onClose();
  };

  return (
    <div className="w-[75vw] max-w-3xl">
      <h2>This window&apos;s data</h2>
      <WindowDataCard />

      <h2>Screenshots</h2>
      <div className="my-4 flex flex-col space-y-4 text-sm">
        <div className="flex flex-col space-y-2">
          <label htmlFor={id} className="flex flex-col">
            Location
            <input
              data-testid="settings-screenshot_location-input"
              type="text"
              id={id}
              className="mt-2 rounded-md border border-gray-300 px-4 py-2 text-base focus-visible:outline-gray-400 dark:border-gray-500 dark:bg-slate-900"
              value={screenshotSaveLocation}
              aria-invalid={locationError || undefined}
              onChange={(e) => {
                setScreenshotSaveLocation(e.target.value);
                setLocationError(false);
              }}
            />
          </label>
          {locationError && (
            <p role="alert" className="text-sm text-red-500">
              Please enter a valid location.
            </p>
          )}
          <p className="text-sm text-gray-500 dark:text-gray-400">
            The location where screenshots will be saved.
          </p>
        </div>
      </div>

      <h2>Popups</h2>
      <div className="my-4 flex flex-col space-y-2 text-sm">
        <label htmlFor={`${id}-popup-behavior`} className="flex flex-col">
          When a page opens a new window
          <select
            data-testid="settings-popup_behavior-select"
            id={`${id}-popup-behavior`}
            className="mt-2 rounded-md border border-gray-300 px-4 py-2 text-base focus-visible:outline-gray-400 dark:border-gray-500 dark:bg-slate-900"
            value={popupBehavior}
            onChange={(e) => setPopupBehavior(e.target.value)}
          >
            <option value="in-preview">Open it in the previews</option>
            <option value="external">Open it in the default browser</option>
          </select>
        </label>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Applies to links with target=&quot;_blank&quot; and window.open calls.
        </p>
      </div>

      <SettingsContentHeaders
        acceptLanguage={webRequestHeaderAcceptLanguage}
        setAcceptLanguage={setWebRequestHeaderAcceptLanguage}
      />

      <h2>Browsers</h2>
      <BrowsersSettings />

      <h2>Toolbar</h2>
      <div className="my-4 flex items-center gap-3 text-sm">
        <span className="flex-1">
          {classicToolbar
            ? 'The tools are in the Session menu, as before.'
            : 'Put the toolbar back the way it was, with the tools in the Session menu.'}
        </span>
        <Button
          data-testid="settings-toolbar-reset"
          className="px-4 py-1"
          isTextButton
          onClick={() => dispatch(setClassicToolbar(!classicToolbar))}
        >
          {classicToolbar ? 'Use the icon toolbar' : 'Reset toolbar'}
        </Button>
      </div>

      <Button
        data-testid="settings-save-button"
        className="mt-6 px-5 py-1"
        onClick={onSave}
        isPrimary
        isTextButton
      >
        Save
      </Button>
    </div>
  );
};
