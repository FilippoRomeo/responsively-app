import {Icon} from '@iconify/react';
import cx from 'classnames';
import {IPC_MAIN_CHANNELS} from 'common/constants';
import {useEffect, useState} from 'react';
import Popover from 'renderer/components/Popover';
import {
  isPreviewAudible,
  isPreviewMuted,
  previewVolume,
  previewWebviews,
  setPreviewMuted,
  setPreviewVolume,
  useAudioChanges,
} from 'renderer/components/Previewer/Device/audio';

/** Re-reads the previews' audio state while `active`: Chromium has no "audible" event for a webview. */
const usePoll = (active: boolean, ms: number) => {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => setTick((t) => t + 1), ms);
    return () => clearInterval(timer);
  }, [active, ms]);
  return tick;
};

/**
 * Speaker: one click mutes every device (as before; a Session remembers it).
 * ▾: each device's own mute, whether it is playing, and its volume.
 */
const SoundMenu = () => {
  const [muted, setMuted] = useState(false);
  const [open, setOpen] = useState(false);
  useAudioChanges();
  usePoll(true, open ? 500 : 2000);

  useEffect(() => {
    window.electron.ipcRenderer
      .invoke<never, boolean>(IPC_MAIN_CHANNELS.AUDIO_MUTED_GET)
      .then(setMuted)
      .catch(() => {});
    return window.electron.ipcRenderer.on<boolean>(IPC_MAIN_CHANNELS.AUDIO_MUTED_CHANGED, setMuted);
  }, []);
  const setAll = (value: boolean) => {
    window.electron.ipcRenderer
      .invoke<boolean, boolean>(IPC_MAIN_CHANNELS.AUDIO_MUTED_SET, value)
      .then(setMuted)
      .catch(() => {});
  };

  const webviews = previewWebviews();
  const playing = webviews.some((w) => isPreviewAudible(w) && !isPreviewMuted(w));
  return (
    <div className="flex items-center">
      <button
        type="button"
        onClick={() => setAll(!muted)}
        data-testid="audio-mute"
        aria-pressed={muted}
        title={muted ? 'Muted — click to turn sound on' : 'Sound on — click to mute'}
        className={cx(
          'relative flex h-[30px] w-[30px] items-center justify-center rounded-l-lg text-[15px] focus:outline-none focus-visible:ring-1 focus-visible:ring-accent',
          muted ? 'bg-accent-soft text-accent' : 'text-fg hover:bg-hover'
        )}
      >
        <span className="pointer-events-none contents">
          <Icon icon={muted ? 'lucide:volume-x' : 'lucide:volume-2'} />
          {playing ? (
            <span
              data-testid="sound-playing"
              className="absolute right-[4px] top-[5px] h-[6px] w-[6px] rounded-full bg-accent"
            />
          ) : null}
        </span>
      </button>
      <Popover
        triggerTitle="Sound for each device"
        triggerClassName="flex h-[30px] w-[16px] items-center justify-center rounded-r-lg text-muted hover:bg-hover hover:text-fg data-[open]:bg-accent-soft data-[open]:text-accent focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
        trigger={
          <span className="pointer-events-none contents" data-testid="sound-menu-button">
            <Icon icon="lucide:chevron-down" fontSize={11} />
          </span>
        }
        onOpenChange={setOpen}
        className="w-[340px] p-[6px]"
      >
        <div data-testid="sound-menu">
          <div className="flex items-center px-[10px] pb-[6px] pt-2">
            <span className="flex-1 text-[10px] font-bold uppercase tracking-[0.08em] text-muted">
              Sound · all devices
            </span>
            <button
              type="button"
              onClick={() => {
                // Mute all also clears per-device choices, so "all" means all.
                webviews.forEach((w) => setPreviewMuted(w, !muted));
                setAll(!muted);
              }}
              className="h-6 rounded-md border border-line px-2 text-[11.5px] text-fg hover:bg-hover focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
            >
              {muted ? 'Unmute all' : 'Mute all'}
            </button>
          </div>
          {webviews.length === 0 ? (
            <div className="px-[10px] py-2 text-[12.5px] text-muted">No devices.</div>
          ) : null}
          {webviews.map((w) => {
            const deviceMuted = isPreviewMuted(w);
            const audible = isPreviewAudible(w) && !deviceMuted;
            return (
              <div
                key={w.id}
                data-testid={`sound-row-${w.id}`}
                className="flex items-center gap-[10px] rounded-[7px] px-[10px] py-[6px] text-[13px]"
              >
                <Icon
                  icon="lucide:audio-lines"
                  fontSize={15}
                  className={audible ? 'text-accent' : 'text-transparent'}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{w.id}</span>
                  <span className="block text-[11px] text-muted">
                    {deviceMuted ? 'Muted' : audible ? 'Playing' : 'Silent'}
                  </span>
                </span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  aria-label={`${w.id} volume`}
                  title="Volume of audio and video on this page"
                  value={Math.round(previewVolume(w) * 100)}
                  onChange={(e) => setPreviewVolume(w, Number(e.target.value) / 100)}
                  className="w-[90px] accent-accent"
                />
                <button
                  type="button"
                  aria-pressed={deviceMuted}
                  title={deviceMuted ? `Unmute ${w.id}` : `Mute ${w.id}`}
                  onClick={() => setPreviewMuted(w, !deviceMuted)}
                  className={cx(
                    'flex h-7 w-7 items-center justify-center rounded-[7px] text-[15px] focus:outline-none focus-visible:ring-1 focus-visible:ring-accent',
                    deviceMuted ? 'text-muted hover:bg-hover' : 'text-fg hover:bg-hover'
                  )}
                >
                  <span className="pointer-events-none contents">
                    <Icon icon={deviceMuted ? 'lucide:volume-x' : 'lucide:volume-2'} />
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      </Popover>
    </div>
  );
};

export default SoundMenu;
