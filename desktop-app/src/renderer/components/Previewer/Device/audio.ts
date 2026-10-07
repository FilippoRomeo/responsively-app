import {IPC_MAIN_CHANNELS} from 'common/constants';
import {useEffect, useState} from 'react';

/**
 * Per-device sound, shared by the toolbar's Sound menu and each device header:
 * a preview's own mute (Chromium's, per page) and its media volume.
 */
const CHANGED = 'responsively:device-audio';
const notify = () => window.dispatchEvent(new Event(CHANGED));
const volumes = new Map<number, number>();
const watched = new WeakSet<Electron.WebviewTag>();

/** Every preview in this window; the element id is the device name. */
export const previewWebviews = () =>
  Array.from(document.querySelectorAll('webview')) as Electron.WebviewTag[];

/** Throws until the webview has emitted dom-ready; callers get a default instead. */
const safe = <T>(read: () => T, fallback: T) => {
  try {
    return read();
  } catch {
    return fallback;
  }
};
export const isPreviewMuted = (w: Electron.WebviewTag) => safe(() => w.isAudioMuted(), false);
export const isPreviewAudible = (w: Electron.WebviewTag) =>
  safe(() => w.isCurrentlyAudible(), false);
export const previewVolume = (w: Electron.WebviewTag) =>
  volumes.get(safe(() => w.getWebContentsId(), -1)) ?? 1;

export const setPreviewMuted = (w: Electron.WebviewTag, muted: boolean) => {
  safe(() => w.setAudioMuted(muted), undefined);
  notify();
};

// ponytail: <audio>/<video> elements only; Web Audio graphs keep their own gain.
const volumeScript = (v: number) => `(() => {
  window.__responsivelyVolume = ${v};
  const apply = () => document.querySelectorAll('audio,video').forEach((el) => { el.volume = window.__responsivelyVolume; });
  apply();
  if (!window.__responsivelyVolumeWatch) {
    window.__responsivelyVolumeWatch = new MutationObserver(apply);
    window.__responsivelyVolumeWatch.observe(document.documentElement, {childList: true, subtree: true});
  }
})()`;

export const setPreviewVolume = (w: Electron.WebviewTag, volume: number) => {
  const id = safe(() => w.getWebContentsId(), -1);
  if (id === -1) return;
  const v = Math.min(1, Math.max(0, volume));
  volumes.set(id, v);
  w.executeJavaScript(volumeScript(v)).catch(() => {});
  // A navigation loses the page's state: put the volume back on every new page.
  if (!watched.has(w)) {
    watched.add(w);
    w.addEventListener('dom-ready', () => {
      const current = volumes.get(id);
      if (current !== undefined && current !== 1)
        w.executeJavaScript(volumeScript(current)).catch(() => {});
    });
  }
  notify();
};

/** Re-renders on any per-device change and on the window-wide mute. */
export const useAudioChanges = () => {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    window.addEventListener(CHANGED, bump);
    const off = window.electron.ipcRenderer.on(IPC_MAIN_CHANNELS.AUDIO_MUTED_CHANGED, bump);
    return () => {
      window.removeEventListener(CHANGED, bump);
      off?.();
    };
  }, []);
  return version;
};
