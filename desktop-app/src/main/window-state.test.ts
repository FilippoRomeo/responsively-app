// @vitest-environment node
import {beforeEach, describe, expect, it, vi} from 'vitest';

const laptop = {x: 0, y: 25, width: 1728, height: 1084};
const monitor = {x: 958, y: -1415, width: 2560, height: 1415};
const saved: {value: unknown} = {value: undefined};
const cursor = {x: 1500, y: -800};

vi.mock('electron', () => ({
  screen: {
    getCursorScreenPoint: () => cursor,
    getDisplayNearestPoint: (p: {x: number; y: number}) => ({
      workArea: p.y < 0 ? monitor : laptop,
    }),
    getAllDisplays: () => [{workArea: laptop}, {workArea: monitor}],
  },
}));
vi.mock('../store', () => ({default: {get: () => saved.value}}));

const {getSavedWindowState} = await import('./window-state');

describe('first window placement follows the user across monitors', () => {
  beforeEach(() => {
    saved.value = undefined;
  });
  it('opens a window with no saved bounds on the monitor under the pointer', () => {
    expect(getSavedWindowState()).toEqual({...monitor, isMaximized: false});
  });
  it('keeps saved bounds that are still on a connected display', () => {
    saved.value = {x: 10, y: 40, width: 800, height: 600, isMaximized: true};
    expect(getSavedWindowState()).toEqual({
      x: 10,
      y: 40,
      width: 800,
      height: 600,
      isMaximized: true,
    });
  });
  it('falls back to the pointer monitor when the saved display is gone', () => {
    saved.value = {x: -5000, y: -5000, width: 800, height: 600};
    expect(getSavedWindowState()).toEqual({...monitor, isMaximized: false});
  });
});
