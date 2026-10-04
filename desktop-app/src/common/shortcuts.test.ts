import {describe, expect, it} from 'vitest';
import {matchShortcut, parseCombo, SHORTCUT_CHANNEL, ShortcutInput} from './shortcuts';

const press = (overrides: Partial<ShortcutInput> & {code: string}): ShortcutInput => ({
  control: false,
  meta: false,
  alt: false,
  shift: false,
  ...overrides,
});

describe('parseCombo', () => {
  it('splits modifiers from the key', () => {
    expect(parseCombo('mod+alt+z')).toEqual({
      mod: true,
      ctrl: false,
      alt: true,
      shift: false,
      code: 'KeyZ',
    });
  });

  it('treats a trailing ++ as the plus key', () => {
    expect(parseCombo('mod++')).toEqual({
      mod: true,
      ctrl: false,
      alt: false,
      shift: false,
      code: 'Equal',
    });
  });

  it('maps named keys to physical codes', () => {
    expect(parseCombo('alt+left').code).toBe('ArrowLeft');
    expect(parseCombo('mod+alt+del').code).toBe('Delete');
    expect(parseCombo('mod+-').code).toBe('Minus');
  });
});

describe('matchShortcut', () => {
  it('matches mod as Cmd on macOS and Ctrl elsewhere', () => {
    expect(matchShortcut(press({code: 'KeyR', meta: true}), 'darwin')).toBe(
      SHORTCUT_CHANNEL.RELOAD
    );
    expect(matchShortcut(press({code: 'KeyR', control: true}), 'win32')).toBe(
      SHORTCUT_CHANNEL.RELOAD
    );
    // The wrong modifier for the platform must not fire.
    expect(matchShortcut(press({code: 'KeyR', control: true}), 'darwin')).toBeNull();
  });

  it('matches Ctrl+Tab as Control on macOS, not Cmd, and not plain Tab', () => {
    expect(matchShortcut(press({code: 'Tab', control: true}), 'darwin')).toBe(
      SHORTCUT_CHANNEL.NEXT_SESSION
    );
    expect(matchShortcut(press({code: 'Tab', control: true, shift: true}), 'darwin')).toBe(
      SHORTCUT_CHANNEL.PREVIOUS_SESSION
    );
    expect(matchShortcut(press({code: 'Tab', meta: true}), 'darwin')).toBeNull();
    expect(matchShortcut(press({code: 'Tab'}), 'darwin')).toBeNull();
    expect(matchShortcut(press({code: 'Tab', control: true}), 'win32')).toBe(
      SHORTCUT_CHANNEL.NEXT_SESSION
    );
  });

  it('gives Cmd+T and Cmd+N to new Sessions and Cmd+Shift+T to the theme', () => {
    expect(matchShortcut(press({code: 'KeyT', meta: true}), 'darwin')).toBe(
      SHORTCUT_CHANNEL.NEW_SESSION_TAB
    );
    expect(matchShortcut(press({code: 'KeyN', meta: true}), 'darwin')).toBe(
      SHORTCUT_CHANNEL.NEW_SESSION_WINDOW
    );
    expect(matchShortcut(press({code: 'KeyT', meta: true, shift: true}), 'darwin')).toBe(
      SHORTCUT_CHANNEL.THEME
    );
    // Cmd+Ctrl+R is not Cmd+R.
    expect(matchShortcut(press({code: 'KeyR', meta: true, control: true}), 'darwin')).toBeNull();
  });

  it('tells reload from reload-and-clear-cache by shift', () => {
    expect(matchShortcut(press({code: 'KeyR', meta: true}), 'darwin')).toBe(
      SHORTCUT_CHANNEL.RELOAD
    );
    expect(matchShortcut(press({code: 'KeyR', meta: true, shift: true}), 'darwin')).toBe(
      SHORTCUT_CHANNEL.RELOAD_CLEAR_CACHE
    );
  });

  it('matches zoom in with and without shift', () => {
    expect(matchShortcut(press({code: 'Equal', meta: true}), 'darwin')).toBe(
      SHORTCUT_CHANNEL.ZOOM_IN
    );
    expect(matchShortcut(press({code: 'Equal', meta: true, shift: true}), 'darwin')).toBe(
      SHORTCUT_CHANNEL.ZOOM_IN
    );
  });

  it('matches zoom out', () => {
    expect(matchShortcut(press({code: 'Minus', meta: true}), 'darwin')).toBe(
      SHORTCUT_CHANNEL.ZOOM_OUT
    );
  });

  it('distinguishes shifted combos from unshifted ones', () => {
    expect(matchShortcut(press({code: 'KeyL', meta: true}), 'darwin')).toBe(
      SHORTCUT_CHANNEL.EDIT_URL
    );
    expect(matchShortcut(press({code: 'KeyL', meta: true, shift: true}), 'darwin')).toBe(
      SHORTCUT_CHANNEL.PREVIEW_LAYOUT
    );
  });

  it('matches alt-only combos', () => {
    expect(matchShortcut(press({code: 'ArrowLeft', alt: true}), 'darwin')).toBe(
      SHORTCUT_CHANNEL.BACK
    );
    expect(matchShortcut(press({code: 'KeyR', alt: true}), 'darwin')).toBe(
      SHORTCUT_CHANNEL.TOGGLE_RULERS
    );
  });

  it('ignores plain typing', () => {
    expect(matchShortcut(press({code: 'KeyR'}), 'darwin')).toBeNull();
    expect(matchShortcut(press({code: 'KeyA', shift: true}), 'darwin')).toBeNull();
  });

  it('does not hijack text editing shortcuts', () => {
    for (const code of ['KeyC', 'KeyV', 'KeyX', 'KeyZ', 'KeyA']) {
      expect(matchShortcut(press({code, meta: true}), 'darwin')).toBeNull();
    }
  });
});
