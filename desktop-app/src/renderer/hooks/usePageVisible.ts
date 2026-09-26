import {useEffect, useState} from 'react';

/**
 * Tracks the Page Visibility state. Electron reports a hidden or minimized
 * BrowserWindow as `hidden`, so a panel that is hidden instead of closed can
 * stop background work while nobody can see it.
 */
const usePageVisible = () => {
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible');
  useEffect(() => {
    const update = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return visible;
};

export default usePageVisible;
