import {matchesSite, partOn, Stack} from './addons';

describe('matchesSite', () => {
  it('matches hosts, ports and wildcards; never non-web pages', () => {
    expect(matchesSite(['localhost:*'], 'http://localhost:5173/app')).toBe(true);
    expect(matchesSite(['localhost:*'], 'http://127.0.0.1:5173/')).toBe(false);
    expect(matchesSite(['*.example.com'], 'https://shop.example.com/')).toBe(true);
    expect(matchesSite(['*.example.com'], 'https://example.com.evil.io/')).toBe(false);
    expect(matchesSite(['example.com:443'], 'https://example.com/')).toBe(true);
    expect(matchesSite(['*'], 'https://anything.dev/')).toBe(true);
    expect(matchesSite(['*'], 'file:///Users/me/page.html')).toBe(false);
    expect(matchesSite(['localhost'], 'not a url')).toBe(false);
  });
});

describe('partOn', () => {
  const stack: Stack = {
    id: 's',
    name: 'S',
    addons: {a: {enabled: true, off: {panel: true}}, b: {enabled: false, off: {}}},
  };
  it('needs the add-on on and the part not switched off', () => {
    expect(partOn(stack, 'a', 'script')).toBe(true);
    expect(partOn(stack, 'a', 'panel')).toBe(false);
    expect(partOn(stack, 'b', 'script')).toBe(false);
    expect(partOn(stack, 'missing', 'script')).toBe(false);
  });
});
