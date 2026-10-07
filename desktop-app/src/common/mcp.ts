import type {PreviewLayout} from './constants';

export const DEFAULT_MCP_PORT = 12720;

export const MCP_PORT_ENV_VAR = 'RESPONSIVELY_MCP_PORT';

export const MCP_SERVER_NAME = 'responsively';

export const MCP_BEACON_FILENAME = 'app-location.json';

/**
 * Written to <userData>/app-location.json at every app startup so the
 * @responsively/mcp npm bootstrap can locate this install (and its bundled
 * MCP bridge) without any user configuration.
 */
export interface McpBeacon {
  binaryPath: string;
  resourcesPath?: string;
  bridgeEntry?: string;
  version: string;
  mcpPort: number;
  writtenAt: string;
}

/** Sent to agents when they connect (app server and bridge alike). */
export const MCP_AGENT_INSTRUCTIONS =
  'Responsively App: device previews of a web page, one Session per project. Before working ' +
  'in a Session, call get_rules for it: follow the "always" rules, and read the others by name ' +
  'when relevant. get_prompts lists routines the user saved; list_addon_tools lists tools of ' +
  'add-ons the user switched on.';

export type McpBridgeCommand =
  | 'get-app-state'
  | 'navigate'
  | 'list-devices'
  | 'set-active-devices'
  | 'get-capture-targets'
  | 'set-device-browser';

export interface McpSetDeviceBrowserPayload {
  device: string;
  browser: 'chromium' | 'ios-safari';
  iosVersion?: string;
}

export interface McpBridgeRequest {
  requestId: string;
  command: McpBridgeCommand;
  payload?: unknown;
}

export interface McpBridgeResponse {
  requestId: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

export interface McpActiveDevice {
  id: string;
  name: string;
  width: number;
  height: number;
  type: string;
  /** "Chromium", or e.g. "iOS Safari 26.1" for real Safari in the Simulator. */
  browser: string;
}

export interface McpAppState {
  url: string;
  pageTitle: string;
  layout: PreviewLayout;
  zoomFactor: number;
  activeSuite: string;
  activeDevices: McpActiveDevice[];
}

export interface McpDeviceInfo extends McpActiveDevice {
  isCustom: boolean;
  isActive: boolean;
}

export interface McpNavigatePayload {
  url: string;
}

export interface McpNavigateResult {
  url: string;
  pageTitle: string;
  loaded: boolean;
}

export interface McpSetActiveDevicesPayload {
  devices: string[];
}

export interface McpSetActiveDevicesResult {
  activeDevices: McpActiveDevice[];
}

export interface McpCaptureTargetsPayload {
  device?: string;
}

export interface McpCaptureTarget {
  deviceName: string;
  width: number;
  height: number;
  webContentsId: number;
  url: string;
  /** Set when the device shows real iOS Safari: captured from its Simulator. */
  iosRuntime?: string;
}

export interface McpSkippedCapture {
  deviceName: string;
  reason: string;
}

export interface McpCaptureTargetsResult {
  targets: McpCaptureTarget[];
  skipped: McpSkippedCapture[];
}
