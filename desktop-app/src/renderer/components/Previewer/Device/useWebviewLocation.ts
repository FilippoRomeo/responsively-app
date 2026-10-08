import {RefObject, useEffect, useState} from 'react';

export interface WebviewLocation {
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
}

const idle: WebviewLocation = {
  url: '',
  title: '',
  canGoBack: false,
  canGoForward: false,
  loading: false,
};

/** Throws until the webview has emitted dom-ready. */
const read = (webview: Electron.WebviewTag, loading: boolean): WebviewLocation => {
  try {
    return {
      url: webview.getURL(),
      title: webview.getTitle(),
      canGoBack: webview.canGoBack(),
      canGoForward: webview.canGoForward(),
      loading,
    };
  } catch {
    return {...idle, loading};
  }
};

/**
 * What a browser bar shows for one preview: its own page, title, history and
 * loading state, read from the webview's events. Only listens while `enabled`.
 */
const useWebviewLocation = (
  ref: RefObject<Electron.WebviewTag | null>,
  webviewReady: boolean,
  enabled: boolean
): WebviewLocation => {
  const [location, setLocation] = useState<WebviewLocation>(idle);
  useEffect(() => {
    const webview = ref.current;
    if (!enabled || !webview || !webviewReady) return undefined;
    let loading = false;
    const update = () => setLocation(read(webview, loading));
    const start = () => {
      loading = true;
      update();
    };
    const stop = () => {
      loading = false;
      update();
    };
    const events: [string, () => void][] = [
      ['did-navigate', update],
      ['did-navigate-in-page', update],
      ['page-title-updated', update],
      ['did-start-loading', start],
      ['did-stop-loading', stop],
    ];
    events.forEach(([name, handler]) => webview.addEventListener(name, handler));
    update();
    return () => events.forEach(([name, handler]) => webview.removeEventListener(name, handler));
  }, [ref, webviewReady, enabled]);
  return location;
};

export default useWebviewLocation;
