import {describe, expect, it} from 'vitest';
import {
  DEFAULT_TOOLBAR_LAYOUT,
  isHidden,
  moveTool,
  sanitizeToolbarLayout,
  toggleToolHidden,
} from './toolbar-layout';

describe('toolbar layout', () => {
  it('turns nothing, or nonsense, into the default layout', () => {
    expect(sanitizeToolbarLayout(undefined)).toEqual(DEFAULT_TOOLBAR_LAYOUT);
    expect(sanitizeToolbarLayout('x')).toEqual(DEFAULT_TOOLBAR_LAYOUT);
    expect(sanitizeToolbarLayout({group: 5, right: null, hidden: 'rotate'})).toEqual(
      DEFAULT_TOOLBAR_LAYOUT
    );
  });

  it('keeps a saved order, drops unknown and repeated tools and appends new ones', () => {
    const layout = sanitizeToolbarLayout({
      group: ['sound', 'bogus', 'rotate', 'sound', 'mcp'],
      right: ['appearance'],
      hidden: ['capture', 'capture', 'nope'],
    });
    expect(layout.group).toEqual(['sound', 'rotate', 'inspect', 'capture', 'simulate']);
    expect(layout.right).toEqual(['appearance', 'addons', 'mcp', 'probe']);
    expect(layout.hidden).toEqual(['capture']);
  });

  it('hides and shows a tool', () => {
    const hidden = toggleToolHidden(DEFAULT_TOOLBAR_LAYOUT, 'mcp');
    expect(isHidden(hidden, 'mcp')).toBe(true);
    expect(isHidden(toggleToolHidden(hidden, 'mcp'), 'mcp')).toBe(false);
  });

  it('moves a tool inside its own section only, and ignores impossible moves', () => {
    const moved = moveTool(DEFAULT_TOOLBAR_LAYOUT, 'group', 0, 2);
    expect(moved.group).toEqual(['inspect', 'capture', 'rotate', 'simulate', 'sound']);
    expect(moved.right).toEqual(DEFAULT_TOOLBAR_LAYOUT.right);
    expect(moveTool(DEFAULT_TOOLBAR_LAYOUT, 'right', 0, 4)).toBe(DEFAULT_TOOLBAR_LAYOUT);
    expect(moveTool(DEFAULT_TOOLBAR_LAYOUT, 'right', -1, 1)).toBe(DEFAULT_TOOLBAR_LAYOUT);
    // The default is never changed in place.
    expect(DEFAULT_TOOLBAR_LAYOUT.group[0]).toBe('rotate');
  });
});
