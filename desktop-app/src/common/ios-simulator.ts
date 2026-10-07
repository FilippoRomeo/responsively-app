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
  /** Simulator models this iOS version runs, by name (iPhone 13, …). */
  deviceNames: string[];
}

export interface IosSimDevice {
  udid: string;
  name: string;
  runtime: string;
  booted: boolean;
  sizeBytes: number;
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
