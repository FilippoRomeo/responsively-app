/** What an agent may do to a Session's terminals and tunnels, and the question it asks you. */
export type TunnelGrant = 'ask' | 'off';
export const DEFAULT_TUNNEL_GRANT: TunnelGrant = 'ask';
export const PROMPT_TIMEOUT_MS = 60_000;

export interface AgentPrompt {
  id: string;
  agent: string;
  title: string;
  /** Label / value pairs: the exact thing being asked for. */
  rows: [string, string][];
  note?: string;
  timeoutMs: number;
}

export interface AuditLine {
  at: string;
  text: string;
  outcome: 'allowed' | 'refused';
}

export interface AgentGrants {
  name: string;
  tunnels: TunnelGrant;
}
