/** The proxy a Session's previews go through: one address, no login (Chromium cannot do SOCKS logins). */
export type ProxyParse = {ok: true; rules: string; label: string} | {ok: false; error: string};

const ADDRESS = /^(socks5|socks4|http|https):\/\/([^\s/@:]+|\[[0-9a-f:]+\]):(\d{1,5})$/i;

export const parseProxyAddress = (text: string): ProxyParse => {
  const value = text.trim();
  if (/@/.test(value))
    return {
      ok: false,
      error: 'A proxy that needs a login is not supported yet: leave out user:password@.',
    };
  const m = ADDRESS.exec(value);
  if (!m || Number(m[3]) < 1 || Number(m[3]) > 65535)
    return {ok: false, error: 'Use socks5://host:port, http://host:port or https://host:port.'};
  return {ok: true, rules: value, label: `${m[2]}:${m[3]}`};
};
