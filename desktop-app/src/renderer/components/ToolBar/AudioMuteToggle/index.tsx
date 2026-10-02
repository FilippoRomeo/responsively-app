import {Icon} from '@iconify/react';
import {IPC_MAIN_CHANNELS} from 'common/constants';
import {useEffect, useState} from 'react';
import {ToolbarAction} from '../primitives';

/** Mutes page sound in every preview of this window (or this Session). */
const AudioMuteToggle = () => {
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    window.electron.ipcRenderer
      .invoke<never, boolean>(IPC_MAIN_CHANNELS.AUDIO_MUTED_GET)
      .then(setMuted)
      .catch(() => {});
    // Also changed from Manage Sessions while this window is open.
    return window.electron.ipcRenderer.on<boolean>(IPC_MAIN_CHANNELS.AUDIO_MUTED_CHANGED, setMuted);
  }, []);

  return (
    <ToolbarAction
      onClick={() => {
        window.electron.ipcRenderer
          .invoke<boolean, boolean>(IPC_MAIN_CHANNELS.AUDIO_MUTED_SET, !muted)
          .then(setMuted)
          .catch(() => {});
      }}
      isActive={muted}
      title={muted ? 'Unmute sound' : 'Mute sound'}
    >
      <Icon icon={muted ? 'lucide:volume-x' : 'lucide:volume-2'} fontSize={15} />
      {muted ? 'Muted' : 'Sound'}
    </ToolbarAction>
  );
};

export default AudioMuteToggle;
