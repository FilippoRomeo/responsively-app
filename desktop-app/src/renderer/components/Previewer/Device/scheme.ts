import {IPC_MAIN_CHANNELS} from 'common/constants';
import type {SetDeviceSchemeArgs} from 'main/devtools';
import {useEffect, useRef, useState} from 'react';

/**
 * prefers-color-scheme for the previews. Chromium's emulation is per page, so
 * each device applies it to its own webview: Appearance sets the value for all
 * devices, a device header may override it for that device alone.
 */
export type Scheme = 'light' | 'dark';
const CHANGED = 'responsively:previews-scheme';
let all: Scheme | null = null;

/** null: whatever the site does by default. */
export const previewsScheme = () => all;
export const setPreviewsScheme = (scheme: Scheme | null) => {
  all = scheme;
  window.dispatchEvent(new Event(CHANGED));
};
export const onPreviewsSchemeChange = (callback: () => void) => {
  window.addEventListener(CHANGED, callback);
  return () => window.removeEventListener(CHANGED, callback);
};

export const applyScheme = async (webview: Electron.WebviewTag, scheme: Scheme | null) => {
  try {
    const result = await window.electron.ipcRenderer.invoke<SetDeviceSchemeArgs, {status: boolean}>(
      IPC_MAIN_CHANNELS.SET_DEVICE_COLOR_SCHEME,
      {webviewId: webview.getWebContentsId(), scheme}
    );
    return result.status;
  } catch {
    // Not attached yet (before dom-ready): the device applies it once it is.
    return false;
  }
};

/** This device's scheme: its own override, else the one Appearance set for all devices. */
export const useDeviceScheme = (
  getWebview: () => Electron.WebviewTag | null,
  webviewReady: boolean
) => {
  const [own, setOwn] = useState<Scheme | null>(null);
  const [forAll, setForAll] = useState(previewsScheme());
  const effective = own ?? forAll;
  const applied = useRef(false);
  // "All devices" is all of them: it replaces any per-device choice.
  useEffect(
    () =>
      onPreviewsSchemeChange(() => {
        setOwn(null);
        setForAll(previewsScheme());
      }),
    []
  );
  useEffect(() => {
    const webview = getWebview();
    // Nothing to undo until something was emulated: no debugger attach for nothing.
    if (!webview || !webviewReady || (effective === null && !applied.current)) return;
    applied.current = true;
    applyScheme(webview, effective).catch(() => {});
  }, [getWebview, webviewReady, effective]);
  const cycle = () => setOwn(own === null ? 'dark' : own === 'dark' ? 'light' : null);
  return {own, effective, cycle};
};
