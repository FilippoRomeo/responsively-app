import {describe, expect, it} from 'vitest';
import {clampSize, LineReader, Scrollback} from './terminal';

describe('Scrollback', () => {
  it('keeps the latest characters, dropping whole old chunks', () => {
    const s = new Scrollback(10);
    s.push('aaaa');
    s.push('bbbb');
    s.push('cccc');
    expect(s.text()).toBe('aabbbbcccc'.slice(-10));
    expect(s.text().endsWith('cccc')).toBe(true);
    expect(s.text().length).toBeLessThanOrEqual(10);
  });
  it('holds everything while under the limit', () => {
    const s = new Scrollback(100);
    s.push('hello ');
    s.push('world');
    expect(s.text()).toBe('hello world');
  });
});

describe('LineReader', () => {
  it('joins split chunks into lines and skips blanks', () => {
    const lines: string[] = [];
    const r = new LineReader((l) => lines.push(l));
    r.push('{"a":1}\n{"b"');
    r.push(':2}\n\n');
    expect(lines).toEqual(['{"a":1}', '{"b":2}']);
  });
  it('refuses a line that never ends', () => {
    const r = new LineReader(() => {}, 10);
    expect(() => r.push('x'.repeat(11))).toThrow(/too large/);
  });
});

describe('clampSize', () => {
  it('keeps the size sane', () => {
    expect(clampSize(0, 0)).toEqual({cols: 80, rows: 24});
    expect(clampSize(9999, 9999)).toEqual({cols: 500, rows: 200});
    expect(clampSize(120.7, 30)).toEqual({cols: 120, rows: 30});
  });
});
