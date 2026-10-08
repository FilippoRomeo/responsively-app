import {z} from 'zod';
import {MAX_CPU_SLOWDOWN, MAX_TEST_CELLS, NETWORK_PRESET_IDS} from '../../common/test-conditions';

/**
 * Pure tool metadata (descriptions + zod input shapes) shared by the live
 * server (tools.ts) and the manifest build script that runs OUTSIDE Electron
 * (.erb/scripts/generate-mcp-manifest.ts). This module must only ever import
 * zod — never electron or anything that does.
 */
export const toolDefs = {
  list_sessions: {
    description: 'List persistent Responsively Sessions and verified runtime status.',
  },
  create_session: {
    description:
      'Create a persistent isolated Session. Opens it by default; ports and browser data are allocated by Responsively.',
    inputSchema: {
      name: z.string().min(1).max(100),
      url: z.string().optional(),
      open: z.boolean().optional(),
    },
  },
  get_session: {
    description: 'Get a Session by stable UUID, including verified runtime diagnostics.',
    inputSchema: {id: z.string().uuid()},
  },
  open_session: {
    description: 'Open a stopped Session or focus its running window.',
    inputSchema: {id: z.string().uuid()},
  },
  focus_session: {
    description: 'Focus the window of a running Session.',
    inputSchema: {id: z.string().uuid()},
  },
  stop_session: {
    description: 'Stop a Session runtime, preserving its browser data and definition.',
    inputSchema: {id: z.string().uuid()},
  },
  get_app_state: {
    description:
      'Get the current state of Responsively App: the URL loaded in the device previews, ' +
      'the page title, preview layout, zoom factor, and the active devices with their dimensions.',
  },
  navigate: {
    description:
      'Navigate all Responsively App device previews to a URL. Accepts http(s) and file:// ' +
      'URLs; bare domains get https:// prepended (localhost gets http://). Waits for the page ' +
      'to finish loading (up to 30s) before returning the final URL and page title.',
    inputSchema: {url: z.string().min(1).describe('The URL to load in every device preview')},
  },
  list_devices: {
    description:
      'List every device available in Responsively App (phones, tablets, laptops, desktops ' +
      'and user-defined custom devices). Returns id, name, dimensions, type, and whether each ' +
      'device is currently active in the preview.',
  },
  set_active_devices: {
    description:
      'Replace the set of device previews shown in Responsively App. Accepts device ids or ' +
      'exact device names (use list_devices to discover them). Every preview loads the ' +
      'current URL.',
    inputSchema: {
      devices: z
        .array(z.string())
        .min(1)
        .describe('Device ids or exact device names to show, e.g. ["10008", "iPad Pro"]'),
    },
  },
  set_device_browser: {
    description:
      'Choose the browser one active device preview runs. "chromium" is the built-in ' +
      'preview. "ios-safari" shows real Safari in the iOS Simulator for that device (iPhone ' +
      'models with an installed iOS version; the first start boots the Simulator, about 25 s). ' +
      'navigate and screenshot work on Safari devices; read_page, click and type_text work ' +
      'on Chromium devices only. Omit ios_version to use the newest installed iOS that ' +
      'supports the device.',
    inputSchema: {
      device: z.string().min(1).describe('Device id or exact name of an active device'),
      browser: z.enum(['chromium', 'ios-safari']).describe('The browser to show'),
      ios_version: z
        .string()
        .optional()
        .describe('Installed iOS version for ios-safari, e.g. "26.1"'),
    },
  },
  set_conditions: {
    description:
      'Throttle one device preview (or all of them) to test how a page behaves: a network ' +
      'preset (offline, 3g-slow, 3g-fast, 4g, 5g, wifi, none), a CPU slowdown (1 = normal, 4 = ' +
      'four times slower) and/or a light or dark colour scheme. It stays on, and is shown on ' +
      'the device, until clear_conditions. Only Chromium previews; real iOS Safari is not affected.',
    inputSchema: {
      device: z.string().optional().describe('Device id or exact name; omit for every device'),
      network: z.enum(NETWORK_PRESET_IDS).optional(),
      cpu: z.number().min(1).max(MAX_CPU_SLOWDOWN).optional(),
      color_scheme: z.enum(['light', 'dark', 'default']).optional(),
    },
  },
  clear_conditions: {
    description: 'Remove set_conditions from one device preview, or from all of them.',
    inputSchema: {
      device: z.string().optional().describe('Device id or exact name; omit for every device'),
    },
  },
  run_test: {
    description:
      'Measure a page under real-world conditions and get a report. It loads each page on each ' +
      'device under each network preset, CPU slowdown and colour scheme (every combination, ' +
      `at most ${MAX_TEST_CELLS}), one at a time with the cache off, and records load time, LCP, ` +
      'layout shift, requests, bytes, failed requests, console errors, script time, memory, ' +
      'horizontal overflow and a screenshot. The previews reload while it runs and are put back ' +
      'afterwards; the user sees a "Test running" bar and can stop it. Returns a Markdown ' +
      'summary and the report id; screenshots are files in the report folder. Real iOS Safari ' +
      'previews are listed as not measured. Defaults: the current page, every Chromium device, ' +
      'no throttling, normal CPU.',
    inputSchema: {
      pages: z
        .array(z.string())
        .max(10)
        .optional()
        .describe('URLs to test; default: the page now loaded'),
      devices: z
        .array(z.string())
        .max(8)
        .optional()
        .describe('Device ids or exact names; default: all active'),
      networks: z.array(z.enum(NETWORK_PRESET_IDS)).max(6).optional(),
      cpu: z.array(z.number().min(1).max(MAX_CPU_SLOWDOWN)).max(4).optional(),
      color_schemes: z
        .array(z.enum(['light', 'dark']))
        .max(2)
        .optional(),
      settle_ms: z
        .number()
        .min(0)
        .max(5000)
        .optional()
        .describe('Wait after load before measuring; default 500'),
      screenshots: z
        .boolean()
        .optional()
        .describe('Take a screenshot per measurement; default true'),
    },
  },
  list_reports: {
    description: "List this Session's saved test reports, newest first (the latest 20 are kept).",
  },
  get_report: {
    description:
      'Read a saved test report by id: the Markdown summary (default) or the full JSON. The ' +
      'folder holding its screenshots is included.',
    inputSchema: {
      id: z.string().min(1),
      format: z.enum(['markdown', 'json']).optional(),
    },
  },
  evaluate: {
    description:
      'Run a JavaScript expression in a Chromium device preview and return its result as JSON ' +
      "(promises are awaited). The page's own globals are reachable, e.g. an add-on's " +
      'window.__COMPOSE3D__. Defaults to the primary device.',
    inputSchema: {
      expression: z.string().min(1).describe('JavaScript expression, e.g. "document.title"'),
      device: z.string().optional().describe('Optional device id or exact name'),
    },
  },
  list_addon_tools: {
    description:
      "List the tools of the MCP-server add-ons switched on in this Session's stack (the user " +
      'installs and switches them in Responsively). Call them with call_addon_tool.',
  },
  call_addon_tool: {
    description: 'Call a tool of an MCP-server add-on from list_addon_tools.',
    inputSchema: {
      addon: z.string().min(1).describe('The add-on id from list_addon_tools'),
      tool: z.string().min(1).describe('The tool name from list_addon_tools'),
      arguments: z.record(z.string(), z.unknown()).optional().describe("The tool's arguments"),
    },
  },
  get_rules: {
    description:
      'Rules the user set for this Session (written like Claude skills). Without a name: ' +
      '"always" rules in full — follow them — and the others by name and description; pass a ' +
      'name to read one when it is relevant to the task.',
    inputSchema: {name: z.string().optional().describe('A rule name to read in full')},
  },
  get_prompts: {
    description:
      'Premade prompts the user saved for this Session (e.g. a testing routine). Without a ' +
      'name: their names and descriptions; pass a name for the full text, then follow it.',
    inputSchema: {name: z.string().optional().describe('A prompt name to read in full')},
  },
  read_page: {
    description:
      'Read the page rendered in a Responsively App device preview: the page text plus its ' +
      'interactive elements (links, buttons, form fields) with CSS selectors usable with the ' +
      'click and type_text tools. Defaults to the primary (first) device preview.',
    inputSchema: {
      device: z
        .string()
        .optional()
        .describe('Optional device id or exact name; omit to read the primary device'),
    },
  },
  click: {
    description:
      'Click an element in a Responsively App device preview using a real (trusted) mouse ' +
      'event at the element center; the element is scrolled into view first. With event ' +
      'mirroring enabled (the app default), the click replicates across all device previews. ' +
      'Use read_page to discover selectors. Returns the URL and title after the click.',
    inputSchema: {
      selector: z.string().min(1).describe('CSS selector of the element to click'),
      device: z
        .string()
        .optional()
        .describe('Optional device id or exact name; omit to click in the primary device'),
    },
  },
  type_text: {
    description:
      'Type text into a form field in a Responsively App device preview using real ' +
      'keystrokes. Focuses the element first (or uses the currently focused element when no ' +
      'selector is given). Returns the field value plus URL and title after typing.',
    inputSchema: {
      text: z.string().describe('The text to type'),
      selector: z
        .string()
        .optional()
        .describe('CSS selector of the field; omit to type into the focused element'),
      clear: z
        .boolean()
        .optional()
        .describe('Select the existing field content first so typing replaces it'),
      pressEnter: z.boolean().optional().describe('Press Enter after typing (submits forms)'),
      device: z
        .string()
        .optional()
        .describe('Optional device id or exact name; omit to type in the primary device'),
    },
  },
  screenshot: {
    description:
      'Capture screenshots of Responsively App device previews rendering the current page. ' +
      'Returns one labeled JPEG per active device, or a single device if specified by id or ' +
      'name. Screenshots show the visible viewport and are downscaled to at most 1000px wide.',
    inputSchema: {
      device: z
        .string()
        .optional()
        .describe('Optional device id or exact name; omit to capture all active devices'),
    },
  },
};

export type ToolName = keyof typeof toolDefs;
