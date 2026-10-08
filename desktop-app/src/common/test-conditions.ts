/**
 * Conditions a preview can be tested under, and the lists of them a test run
 * walks through. Pure: no Electron, so MCP's tool definitions, the engine and
 * the tests all share it.
 */
export const NETWORK_PRESETS = {
  none: {label: 'No throttling', downKbps: -1, upKbps: -1, latencyMs: 0, offline: false},
  wifi: {label: 'Wi-Fi', downKbps: 30_000, upKbps: 15_000, latencyMs: 10, offline: false},
  '5g': {label: '5G', downKbps: 50_000, upKbps: 25_000, latencyMs: 20, offline: false},
  '4g': {label: '4G', downKbps: 12_000, upKbps: 6_000, latencyMs: 70, offline: false},
  '3g-fast': {label: 'Fast 3G', downKbps: 1_600, upKbps: 750, latencyMs: 150, offline: false},
  '3g-slow': {label: 'Slow 3G', downKbps: 500, upKbps: 500, latencyMs: 400, offline: false},
  offline: {label: 'Offline', downKbps: 0, upKbps: 0, latencyMs: 0, offline: true},
} as const;
export type NetworkPreset = keyof typeof NETWORK_PRESETS;
export const NETWORK_PRESET_IDS = Object.keys(NETWORK_PRESETS) as [
  NetworkPreset,
  ...NetworkPreset[],
];

export const MIN_CPU_SLOWDOWN = 1;
export const MAX_CPU_SLOWDOWN = 20;
export type ColorScheme = 'light' | 'dark';

export interface TestConditions {
  network: NetworkPreset;
  /** 1 = this Mac's own speed, 4 = four times slower. */
  cpu: number;
  /** null: whatever the page and the window decide. */
  scheme: ColorScheme | null;
}
export const NO_CONDITIONS: TestConditions = {network: 'none', cpu: 1, scheme: null};

export const isNoConditions = (c: TestConditions) =>
  c.network === 'none' && c.cpu === 1 && c.scheme === null;

/** CDP's Network.emulateNetworkConditions parameters (bytes per second; -1 = unlimited). */
export const networkToCdp = (preset: NetworkPreset) => {
  const p = NETWORK_PRESETS[preset];
  return {
    offline: p.offline,
    latency: p.latencyMs,
    downloadThroughput: p.downKbps < 0 ? -1 : Math.round((p.downKbps * 1000) / 8),
    uploadThroughput: p.upKbps < 0 ? -1 : Math.round((p.upKbps * 1000) / 8),
  };
};

export const clampCpu = (value: number): number =>
  Math.min(MAX_CPU_SLOWDOWN, Math.max(MIN_CPU_SLOWDOWN, Math.round(value)));

/** "4G · CPU ×4 · dark": short, for a device's chip and a report's table. */
export const describeConditions = (c: TestConditions): string => {
  const parts: string[] = [];
  if (c.network !== 'none') parts.push(NETWORK_PRESETS[c.network].label);
  if (c.cpu !== 1) parts.push(`CPU ×${c.cpu}`);
  if (c.scheme) parts.push(c.scheme);
  return parts.length > 0 ? parts.join(' · ') : 'No conditions';
};

export interface TestMatrix {
  pages: string[];
  devices: string[];
  networks: NetworkPreset[];
  cpus: number[];
  schemes: (ColorScheme | null)[];
}

export interface TestCell {
  index: number;
  page: string;
  device: string;
  conditions: TestConditions;
}

/** One run may not grow without bound: an agent asking for 5 × 5 × 5 × 5 gets an answer, not a stall. */
export const MAX_TEST_CELLS = 60;

const unique = <T>(list: T[]): T[] => [...new Set(list)];

/**
 * Every combination, page by page then device by device, so each device's
 * conditions change as little as possible between cells.
 */
export const expandMatrix = (matrix: TestMatrix): TestCell[] => {
  const pages = unique(matrix.pages);
  const devices = unique(matrix.devices);
  const networks = unique(matrix.networks);
  const cpus = unique(matrix.cpus.map(clampCpu));
  const schemes = unique(matrix.schemes);
  const total = pages.length * devices.length * networks.length * cpus.length * schemes.length;
  if (total === 0) throw new Error('Nothing to test: every list needs at least one entry.');
  if (total > MAX_TEST_CELLS)
    throw new Error(
      `That is ${total} combinations (${pages.length} pages × ${devices.length} devices × ` +
        `${networks.length} networks × ${cpus.length} CPU speeds × ${schemes.length} colour schemes); ` +
        `the limit is ${MAX_TEST_CELLS}. Split it into several runs.`
    );
  const cells: TestCell[] = [];
  for (const page of pages)
    for (const device of devices)
      for (const network of networks)
        for (const cpu of cpus)
          for (const scheme of schemes)
            cells.push({index: cells.length, page, device, conditions: {network, cpu, scheme}});
  return cells;
};
