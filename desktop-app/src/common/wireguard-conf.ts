/**
 * A WireGuard config as providers hand it out (Proton, Mullvad, ...), checked
 * before it is run. Only [Interface] and [Peer] are allowed: anything else
 * could open listeners or tunnels, and the shell hooks (PostUp...) are dropped.
 */
export type WgParse = {ok: true; conf: string; endpoint: string} | {ok: false; error: string};

const HOOKS = /^(preup|postup|predown|postdown|saveconfig|table|fwmark)\s*=/i;

export const parseWireguardConf = (text: string): WgParse => {
  const kept: string[] = [];
  let section: 'interface' | 'peer' | null = null;
  const seen = {interface: false, peer: false, privateKey: false, publicKey: false};
  let endpoint = '';
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, '').trim();
    if (line === '' || line.startsWith('#')) continue;
    const header = /^\[(.+)\]$/.exec(line);
    if (header) {
      const name = header[1].toLowerCase();
      if (name === 'interface') {
        section = 'interface';
        seen.interface = true;
      } else if (name === 'peer') {
        section = 'peer';
        seen.peer = true;
      } else
        return {
          ok: false,
          error: `The section [${header[1]}] is not allowed: only [Interface] and [Peer].`,
        };
      kept.push(`[${header[1]}]`);
      continue;
    }
    if (section === null)
      return {ok: false, error: 'This is not a WireGuard config: it must start with [Interface].'};
    if (HOOKS.test(line)) continue;
    if (section === 'interface' && /^privatekey\s*=\s*\S+/i.test(line)) seen.privateKey = true;
    if (section === 'peer' && /^publickey\s*=\s*\S+/i.test(line)) seen.publicKey = true;
    const ep = /^endpoint\s*=\s*(\S+)$/i.exec(line);
    if (section === 'peer' && ep) endpoint = ep[1];
    kept.push(line);
  }
  if (!seen.interface || !seen.peer)
    return {ok: false, error: 'A WireGuard config needs an [Interface] and a [Peer].'};
  if (!seen.privateKey) return {ok: false, error: 'The [Interface] has no PrivateKey.'};
  if (!seen.publicKey || endpoint === '')
    return {ok: false, error: 'The [Peer] needs a PublicKey and an Endpoint.'};
  return {ok: true, conf: `${kept.join('\n')}\n`, endpoint};
};
