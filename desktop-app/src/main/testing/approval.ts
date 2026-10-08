import {dialog, type BrowserWindow} from 'electron';
import store from '../../store';

/**
 * "Ask me first": when the user switched it on in the test probe, an agent's
 * test (or conditions on a device) waits for a click. Off by default.
 */
export const askBeforeAgent = async (
  getWindow: () => BrowserWindow | null | undefined,
  what: string
) => {
  if (store.get('testProbe.askFirst') !== true) return;
  const win = getWindow();
  const options = {
    type: 'question' as const,
    buttons: ['Allow', 'Deny'],
    defaultId: 1,
    cancelId: 1,
    message: 'An agent wants to change how your previews run',
    detail: `${what}\n\nThe previews reload while it runs and are put back afterwards. You can turn this question off in the test probe.`,
  };
  const {response} = win
    ? await dialog.showMessageBox(win, options)
    : await dialog.showMessageBox(options);
  if (response !== 0) throw new Error('The user declined this test.');
};
