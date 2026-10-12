import {ipcMain} from 'electron';
import {IPC_MAIN_CHANNELS} from '../../common/constants';
import {
  CAPABILITIES,
  DEFAULT_TUNNEL_GRANT,
  type AgentGrants,
  type AgentPrompt,
  type Answer,
  type AuditLine,
  type Capability,
  type TunnelGrant,
} from '../../common/agent-env';
import store from '../../store';
import log from '../logging';
import type {GetMainWindow} from '../mcp/bridge';
import {Prompter} from './prompter';

/**
 * What agents may do with this Session's tunnels: a grant per agent (ask each
 * time, or off), the question itself, and one audit line per call. Enforced
 * here, in the app, not in the stdio bridge.
 */
let prompter: Prompter | null = null;
let notify: (line: AuditLine) => void = () => {};
const lines: AuditLine[] = [];

type Stored = Record<string, Partial<Record<Capability, TunnelGrant>> | TunnelGrant>;

/** What is saved per agent. An older version saved just the tunnels setting, as a word. */
export const grantsOf = (): Record<string, Partial<Record<Capability, TunnelGrant>>> => {
  const raw = (store.get('envGrants') as Stored | undefined) ?? {};
  return Object.fromEntries(
    Object.entries(raw).map(([name, v]) => [name, typeof v === 'string' ? {tunnels: v} : v])
  );
};

export const grantFor = (agent: string, capability: Capability): TunnelGrant =>
  grantsOf()[agent]?.[capability] === 'off' ? 'off' : DEFAULT_TUNNEL_GRANT;
export const tunnelGrant = (agent: string): TunnelGrant => grantFor(agent, 'tunnels');

/** "Allow for this Session": remembered while this window's Session runs, never saved. */
const remembered = new Set<string>();
export const isRemembered = (agent: string, capability: Capability) =>
  remembered.has(`${agent}\0${capability}`);
export const remember = (agent: string, capability: Capability) =>
  remembered.add(`${agent}\0${capability}`);

export const audit = (agent: string, text: string, outcome: AuditLine['outcome']) => {
  const line: AuditLine = {at: new Date().toISOString(), text: `${text} by ${agent}`, outcome};
  lines.unshift(line);
  lines.length = Math.min(lines.length, 30);
  log.info(`[env] ${line.text}: ${outcome}`);
  notify(line);
};

export const askUser = (
  input: Pick<AgentPrompt, 'agent' | 'title' | 'rows' | 'note' | 'remember'>
): Promise<Answer> => (prompter ? prompter.ask(input) : Promise.resolve('deny'));

export const initAgentAccess = (getMainWindow: GetMainWindow, knownAgents: () => string[]) => {
  const win = () => {
    const w = getMainWindow();
    return w && !w.isDestroyed() ? w : null;
  };
  prompter = new Prompter(
    (prompt) => {
      const w = win();
      if (!w) return false;
      // The question must be seen: show the window without taking focus from what you are doing.
      if (!w.isVisible()) w.showInactive();
      w.webContents.send(IPC_MAIN_CHANNELS.AGENT_PROMPT, prompt);
      return true;
    },
    (id) => win()?.webContents.send(IPC_MAIN_CHANNELS.AGENT_PROMPT_HIDE, id)
  );
  notify = (line) => win()?.webContents.send(IPC_MAIN_CHANNELS.ENV_AUDIT_EVENT, line);

  ipcMain.removeHandler(IPC_MAIN_CHANNELS.AGENT_PROMPT_ANSWER);
  ipcMain.handle(IPC_MAIN_CHANNELS.AGENT_PROMPT_ANSWER, (_e, id: unknown, allow: unknown) =>
    prompter?.answer(id, allow)
  );
  ipcMain.removeHandler(IPC_MAIN_CHANNELS.ENV_GRANTS_LIST);
  ipcMain.handle(IPC_MAIN_CHANNELS.ENV_GRANTS_LIST, (): AgentGrants[] =>
    [...new Set([...knownAgents(), ...Object.keys(grantsOf())])].map((name) => ({
      name,
      tunnels: grantFor(name, 'tunnels'),
      commands: grantFor(name, 'commands'),
      files: grantFor(name, 'files'),
    }))
  );
  ipcMain.removeHandler(IPC_MAIN_CHANNELS.ENV_GRANT_SET);
  ipcMain.handle(
    IPC_MAIN_CHANNELS.ENV_GRANT_SET,
    (_e, name: unknown, capability: unknown, value: unknown) => {
      if (typeof name !== 'string' || name.length === 0 || name.length > 80)
        throw new Error('Unknown agent');
      if (!CAPABILITIES.includes(capability as Capability)) throw new Error('Unknown permission');
      if (value !== 'ask' && value !== 'off') throw new Error('Choose ask or off');
      const all = grantsOf();
      store.set('envGrants', {...all, [name]: {...all[name], [capability as Capability]: value}});
      // Changing a permission ends any "for this Session" you gave for it.
      remembered.delete(`${name}\0${capability}`);
      audit('you', `${capability} for ${name} set to ${value}`, 'allowed');
      return true;
    }
  );
  ipcMain.removeHandler(IPC_MAIN_CHANNELS.ENV_AUDIT_LIST);
  ipcMain.handle(IPC_MAIN_CHANNELS.ENV_AUDIT_LIST, (): AuditLine[] => lines.slice(0, 12));
  win()?.once('closed', () => prompter?.refuseAll());
};
