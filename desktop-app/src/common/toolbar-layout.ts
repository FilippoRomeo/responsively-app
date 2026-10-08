/**
 * Which buttons the toolbar shows, and in what order. Two lists: the buttons
 * inside the "All devices" group, and the ones on the right of the bar. A hidden
 * button stays reachable under ⋮ › More tools. Navigation, the address bar,
 * Devices and ⋮ are not in here: they always stay.
 */
export const GROUP_TOOLS = ['rotate', 'inspect', 'capture', 'simulate', 'sound'] as const;
export const RIGHT_TOOLS = ['addons', 'mcp', 'probe', 'appearance'] as const;
export type GroupTool = (typeof GROUP_TOOLS)[number];
export type RightTool = (typeof RIGHT_TOOLS)[number];
export type ToolId = GroupTool | RightTool;
export type ToolSection = 'group' | 'right';

export interface ToolbarLayout {
  group: GroupTool[];
  right: RightTool[];
  hidden: ToolId[];
}

export const DEFAULT_TOOLBAR_LAYOUT: ToolbarLayout = {
  group: [...GROUP_TOOLS],
  right: [...RIGHT_TOOLS],
  hidden: [],
};

/** Name, and the "title" of the button that opens it (what a hidden tool's row clicks). */
export const TOOL_INFO: Record<ToolId, {name: string; icon: string; button: string}> = {
  rotate: {
    name: 'Rotate all devices',
    icon: 'mdi:phone-rotate-landscape',
    button: 'Rotate Devices',
  },
  inspect: {name: 'Inspect', icon: 'lucide:inspect', button: 'Inspect Elements'},
  capture: {name: 'Capture all devices', icon: 'lucide:camera', button: 'Screenshot All WebViews'},
  simulate: {name: 'Simulate vision', icon: 'lucide:eye', button: 'Simulate vision'},
  sound: {name: 'Sound', icon: 'lucide:volume-2', button: 'Sound for each device'},
  addons: {name: 'Add-ons', icon: 'lucide:puzzle', button: 'Add-ons'},
  mcp: {name: 'MCP', icon: 'lucide:plug-zap', button: 'MCP server — connect AI tools'},
  probe: {name: 'Test probe', icon: 'lucide:gauge', button: 'Test probe'},
  appearance: {name: 'Appearance', icon: 'lucide:contrast', button: 'Appearance'},
};

const isTool = (value: unknown): value is ToolId => typeof value === 'string' && value in TOOL_INFO;

/** Keeps the saved order, drops what is unknown or repeated, appends what is missing. */
const order = <T extends ToolId>(saved: unknown, all: readonly T[]): T[] => {
  const seen = new Set<T>();
  if (Array.isArray(saved)) for (const id of saved) if (all.includes(id as T)) seen.add(id as T);
  for (const id of all) seen.add(id);
  return [...seen];
};

/** Whatever was saved (or nothing) becomes a complete, valid layout. */
export const sanitizeToolbarLayout = (raw: unknown): ToolbarLayout => {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Partial<
    Record<keyof ToolbarLayout, unknown>
  >;
  const hidden = Array.isArray(value.hidden) ? [...new Set(value.hidden.filter(isTool))] : [];
  return {group: order(value.group, GROUP_TOOLS), right: order(value.right, RIGHT_TOOLS), hidden};
};

export const toggleToolHidden = (layout: ToolbarLayout, id: ToolId): ToolbarLayout => ({
  ...layout,
  hidden: layout.hidden.includes(id)
    ? layout.hidden.filter((h) => h !== id)
    : [...layout.hidden, id],
});

/** Moves a tool to a position within its own section; other positions shift. */
export const moveTool = (
  layout: ToolbarLayout,
  section: ToolSection,
  from: number,
  to: number
): ToolbarLayout => {
  const list = [...layout[section]] as ToolId[];
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return layout;
  const [item] = list.splice(from, 1);
  list.splice(to, 0, item);
  return {...layout, [section]: list} as ToolbarLayout;
};

export const isHidden = (layout: ToolbarLayout, id: ToolId) => layout.hidden.includes(id);
