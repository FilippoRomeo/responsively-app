import type {PortInfo, TunnelDef, TunnelInfo} from '../../common/tunnel';

/** What the MCP tools may ask of this window's environment: reads, and the saved tunnels. */
export interface EnvApi {
  terminalCount: () => Promise<number>;
  ports: () => Promise<PortInfo[]>;
  tunnels: () => Promise<TunnelInfo[]>;
  savedTunnel: (nameOrId: string) => TunnelDef | undefined;
  savedNames: () => string[];
  /** Starts it and waits until it is connected or has said why not. */
  startTunnel: (def: TunnelDef) => Promise<TunnelInfo>;
  stopTunnel: (id: string) => Promise<void>;
}

let api: EnvApi | null = null;
export const setEnvApi = (value: EnvApi) => {
  api = value;
};
export const getEnvApi = (): EnvApi => {
  if (!api) throw new Error('Terminals and tunnels are not available in this window.');
  return api;
};
