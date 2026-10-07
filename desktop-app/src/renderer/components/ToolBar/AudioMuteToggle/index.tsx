import {Icon} from '@iconify/react';
import {IPC_MAIN_CHANNELS} from 'common/constants';
import {useEffect, useState} from 'react';
import {ToolbarAction} from '../primitives';

/**
 * Mutes page sound in every preview of this window (or this Session). `compact`
 * is the speaker beside the Session name: one click, no label.
 */
const AudioMuteToggle = ({compact = false}: {compact?: boolean}) => {
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    window.electron.ipcRenderer
      .invoke<never, boolean>(IPC_MAIN_CHANNELS.AUDIO_MUTED_GET)
      .then(setMuted)
      .catch(() => {});
    // Also changed from Manage Sessions while this window is open.
    return window.electron.ipcRenderer.on<boolean>(IPC_MAIN_CHANNELS.AUDIO_MUTED_CHANGED, setMuted);
  }, []);

  const toggle = () => {
    window.electron.ipcRenderer
      .invoke<boolean, boolean>(IPC_MAIN_CHANNELS.AUDIO_MUTED_SET, !muted)
      .then(setMuted)
      .catch(() => {});
  };
  if (compact)
    return (
      <button
        type="button"
        onClick={toggle}
        data-testid="audio-mute"
        aria-pressed={muted}
        title={muted ? 'Muted — click to turn sound on' : 'Sound on — click to mute'}
        className="flex h-[30px] w-[26px] items-center justify-center rounded-[7px] text-muted hover:bg-hover hover:text-fg focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
      >
        <Icon icon={muted ? 'lucide:volume-x' : 'lucide:volume-2'} fontSize={15} />
      </button>
    );
  return (
    <ToolbarAction
      onClick={toggle}
      data-testid="audio-mute"
      isActive={muted}
      title={muted ? 'Unmute sound' : 'Mute sound'}
    >
      <Icon icon={muted ? 'lucide:volume-x' : 'lucide:volume-2'} fontSize={15} />
      {muted ? 'Muted' : 'Sound'}
    </ToolbarAction>
  );
};

export default AudioMuteToggle;
