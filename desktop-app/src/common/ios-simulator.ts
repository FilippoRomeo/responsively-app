/** iOS Safari previews: real Safari in an iOS Simulator, streamed by serve-sim. */

/** com.apple.CoreSimulator.SimRuntime.iOS-26-1 → iOS 26.1 */
export const runtimeLabel = (id: string) =>
  (id.split('.').pop() ?? id).replace(/^(\w+)-(\d+)-(\d+)$/, '$1 $2.$3');
export type IosSimRequest =
  | {operation: 'list'}
  | {operation: 'start'; deviceName: string; runtime: string}
  | {operation: 'open-url'; udid: string; url: string}
  | {operation: 'stop'; udid: string}
  | {operation: 'delete-device'; udid: string}
  | {operation: 'delete-runtime'; runtime: string};

export interface IosSimRuntime {
  /** e.g. com.apple.CoreSimulator.SimRuntime.iOS-26-1 */
  id: string;
  /** e.g. iOS 26.1 */
  name: string;
  sizeBytes: number;
  deletable: boolean;
  /** When a Simulator last used it (ISO), if macOS recorded it. */
  lastUsedAt?: string;
  /** Simulator models this iOS version runs, by name (iPhone 13, …). */
  deviceNames: string[];
}

export interface IosSimDevice {
  udid: string;
  name: string;
  runtime: string;
  booted: boolean;
  sizeBytes: number;
  /** Its last boot or shutdown (ISO). */
  lastUsedAt?: string;
}

export interface IosSimState {
  available: boolean;
  reason?: string;
  runtimes: IosSimRuntime[];
  devices: IosSimDevice[];
}

export interface IosSimStream {
  udid: string;
  streamUrl: string;
  wsUrl: string;
}

/**
 * The Simulator model behind a device preview. The built-in iPads carry their
 * marketing names, the Simulator its own; an iPhone's name already matches.
 */
const SIMULATOR_MODELS: Record<string, string> = {
  iPad: 'iPad (A16)',
  'iPad Mini': 'iPad mini (A17 Pro)',
  'iPad Air': 'iPad Air 11-inch (M3)',
  'iPad Air M2': 'iPad Air 11-inch (M2)',
  'iPad Pro': 'iPad Pro 13-inch (M5)',
  'iPad Pro M4': 'iPad Pro 11-inch (M4)',
};
export const simulatorModel = (deviceName: string) => SIMULATOR_MODELS[deviceName] ?? deviceName;
