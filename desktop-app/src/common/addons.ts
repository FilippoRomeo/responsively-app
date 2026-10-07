/**
 * Add-ons: tools that live in Responsively instead of in a project's
 * packages. Each is used as it already is (a web app, a script bundle, a
 * repo, a folder) and adds one or more parts, each switchable per stack.
 */

export type AddonSourceKind = 'url' | 'github' | 'npm' | 'folder';

export type AddonPart =
  /** A web app shown in its own tab beside the previews. */
  | {id: string; kind: 'panel'; label: string; url: string}
  /** A script run in preview pages before their own scripts, on matching sites. */
  | {
      id: string;
      kind: 'script';
      label: string;
      file: string;
      matches: string[];
      /** Optional line run after it loads, e.g. `eruda.init()`. */
      init?: string;
      /**
       * `ready` (default): once the page's DOM exists, as most tools expect.
       * `start`: before the page's own scripts, for hooks (e.g. three.js').
       */
      when?: 'ready' | 'start';
    }
  /** A command run when a Session using the add-on opens (e.g. the app a panel shows). */
  | {id: string; kind: 'start'; label: string; command: string; url?: string};

export interface Addon {
  id: string;
  name: string;
  about: string;
  source: string;
  sourceKind: AddonSourceKind;
  /** Where its files live (a folder add-on stays where it is). */
  dir?: string;
  /** Command that turns its source into what the parts use, run from `dir`. */
  buildCommand?: string;
  parts: AddonPart[];
  /** What the user allowed at install, in plain words. */
  permissions: string[];
  installedAt: string;
  lastUsedAt: string;
}

export interface StackAddon {
  enabled: boolean;
  /** Part id → off; parts are on unless switched off. */
  off: Record<string, boolean>;
}

export interface Stack {
  id: string;
  name: string;
  addons: Record<string, StackAddon>;
}

export interface AddonsState {
  addons: Addon[];
  stacks: Stack[];
  /** The stack this window uses. */
  stackId: string;
  /** Offer to delete add-ons nobody used for six months. */
  autoCleanup: boolean;
}

export type AddonsRequest =
  | {operation: 'state'}
  | {operation: 'inspect'; source: string}
  | {operation: 'install'; addon: Addon}
  | {operation: 'cancel-install'; id: string}
  /** Runs in the add-on's folder: installed (by id) or still being inspected (dir). */
  | {operation: 'run'; id: string; command: string; dir?: string}
  | {operation: 'uninstall'; id: string}
  | {operation: 'use-stack'; stackId: string}
  | {operation: 'save-stack'; name: string}
  | {operation: 'set-enabled'; addonId: string; enabled: boolean}
  | {operation: 'set-part'; addonId: string; partId: string; on: boolean}
  | {operation: 'sizes'}
  | {operation: 'set-auto-cleanup'; on: boolean}
  | {operation: 'stale'}
  /** Answer to the six-month alert: keep it, the clock restarts. */
  | {operation: 'keep'; id: string};

/** A line of a build/start command's output, streamed to the window that ran it. */
export interface AddonLog {
  runId: string;
  text: string;
  done?: boolean;
  code?: number | null;
}

export const SIX_MONTHS_MS = 182 * 24 * 60 * 60 * 1000;

/** Is a part switched on for this stack? */
export const partOn = (stack: Stack | undefined, addonId: string, partId: string) => {
  const entry = stack?.addons[addonId];
  return Boolean(entry?.enabled) && !entry?.off[partId];
};

/**
 * Site patterns a page script runs on: `*` (everywhere), `host` or `host:port`
 * with `*` as a wildcard in either (`localhost:*`, `*.example.com`).
 */
export const matchesSite = (patterns: string[], url: string) => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (!/^https?:$/.test(parsed.protocol)) return false;
  const host = parsed.hostname;
  const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
  const glob = (pattern: string, value: string) =>
    new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`).test(
      value
    );
  return patterns.some((raw) => {
    const pattern = raw.trim();
    if (pattern === '*') return true;
    const [h, p] = pattern.split(':');
    return glob(h, host) && (p === undefined || glob(p, port));
  });
};
