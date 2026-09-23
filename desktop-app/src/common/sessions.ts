export interface SessionDefinition {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt?: string;
  lastUrl?: string;
}
export type SessionStatus = 'stopped' | 'starting' | 'running' | 'stopping' | 'error';
export interface SessionRuntime {
  pid: number;
  mcpPort: number | null;
  browserSyncPort: number;
  userDataDir: string;
  startedAt: string;
}
export interface SessionInfo extends SessionDefinition {
  status: SessionStatus;
  runtime?: SessionRuntime;
  devices?: string[];
  error?: string;
}
export type SessionOperation =
  'list' | 'get' | 'create' | 'rename' | 'open' | 'focus' | 'stop' | 'delete' | 'reset';
export interface SessionRequest {
  operation: SessionOperation;
  id?: string;
  name?: string;
  url?: string;
  open?: boolean;
  confirmed?: boolean;
}
