import {describe, expect, it} from 'vitest';
import {parseProxyAddress} from './session-proxy';

describe('parseProxyAddress', () => {
  it('accepts socks and http proxies with a port', () => {
    expect(parseProxyAddress(' socks5://127.0.0.1:9050 ')).toEqual({
      ok: true,
      rules: 'socks5://127.0.0.1:9050',
      label: '127.0.0.1:9050',
    });
    expect(parseProxyAddress('http://proxy.example:8080').ok).toBe(true);
  });
  it('says what is wrong instead of guessing', () => {
    expect(parseProxyAddress('127.0.0.1:9050').ok).toBe(false);
    expect(parseProxyAddress('socks5://host').ok).toBe(false);
    expect(parseProxyAddress('socks5://host:99999').ok).toBe(false);
    const login = parseProxyAddress('socks5://me:pw@host:1080');
    expect(!login.ok && login.error).toMatch(/login/);
  });
});
