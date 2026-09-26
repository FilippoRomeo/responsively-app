import {act, renderHook} from '@testing-library/react';
import {afterEach, expect, it} from 'vitest';
import usePageVisible from './usePageVisible';

const setVisibility = (state: DocumentVisibilityState) => {
  Object.defineProperty(document, 'visibilityState', {value: state, configurable: true});
  document.dispatchEvent(new Event('visibilitychange'));
};

afterEach(() => {
  Object.defineProperty(document, 'visibilityState', {value: 'visible', configurable: true});
});

it('follows the page visibility of a hidden and re-shown window', () => {
  const {result} = renderHook(() => usePageVisible());
  expect(result.current).toBe(true);
  act(() => setVisibility('hidden'));
  expect(result.current).toBe(false);
  act(() => setVisibility('visible'));
  expect(result.current).toBe(true);
});
