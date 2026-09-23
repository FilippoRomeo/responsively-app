import {app, BrowserWindow} from 'electron';
import {requestShellQuit, sessionRequest} from './service';

/** ⌘Q in a Session window: the first press arms and shows a hint, a second press quits. */
export const QUIT_CONFIRM_MS = 2500;
export const createQuitGate = (windowMs = QUIT_CONFIRM_MS, now = () => Date.now()) => {
  let armedUntil = 0;
  return {
    press: (): 'arm' | 'quit' => {
      if (now() <= armedUntil) {
        armedUntil = 0;
        return 'quit';
      }
      armedUntil = now() + windowMs;
      return 'arm';
    },
  };
};

const HINT_HTML = `<!doctype html><meta charset="utf-8"><body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:transparent;font:13px -apple-system,system-ui,sans-serif"><div style="background:rgba(28,28,30,.9);color:#fff;padding:10px 18px;border-radius:12px;text-align:center;line-height:1.4">Press ⌘Q again to quit Responsively<br><span style="opacity:.7;font-size:11px">Open Sessions reopen next time</span></div></body>`;
let hint: BrowserWindow | null = null;
const hideHint = () => {
  if (hint && !hint.isDestroyed()) hint.destroy();
  hint = null;
};
// A non-focusable overlay, so the second ⌘Q still reaches the same Session window.
const showQuitHint = (parent: BrowserWindow | null) => {
  hideHint();
  const owner = parent && !parent.isDestroyed() ? parent : undefined;
  const bounds = owner?.getBounds();
  const width = 320;
  const height = 72;
  const current = new BrowserWindow({
    width,
    height,
    ...(bounds
      ? {
          x: Math.round(bounds.x + (bounds.width - width) / 2),
          y: Math.round(bounds.y + (bounds.height - height) / 2),
        }
      : {}),
    ...(owner ? {parent: owner} : {}),
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      javascript: false,
    },
  });
  hint = current;
  current.setIgnoreMouseEvents(true);
  current.once('ready-to-show', () => {
    if (!current.isDestroyed()) current.showInactive();
  });
  void current.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(HINT_HTML)}`);
  setTimeout(() => {
    if (hint === current) hideHint();
  }, QUIT_CONFIRM_MS);
};

// The controller performs the stop, so the Session ends as "stopped", not as a crash.
const stopThisSession = () =>
  sessionRequest({operation: 'stop', id: process.env.RESPONSIVELY_SESSION_ID}).catch(() =>
    app.quit()
  );

const gate = createQuitGate();
export const quitFromSessionWindow = async (parent: BrowserWindow | null) => {
  if (gate.press() === 'arm') {
    showQuitHint(parent);
    return;
  }
  hideHint();
  // One app: ⌘Q quits everything through the shell (stop all, remember, no relaunch).
  if (await requestShellQuit()) return;
  // No shell is running (a Session opened by an agent): close just this Session.
  await stopThisSession();
};

/** Closing a Session's last window (⌘W, red button) stops that Session; its data is kept. */
export const stopSessionWhenWindowsClose = () => {
  let quitting = false;
  app.on('before-quit', () => {
    quitting = true;
  });
  app.on('window-all-closed', () => {
    if (!quitting) void stopThisSession();
  });
};
