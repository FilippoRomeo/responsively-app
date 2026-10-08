/* eslint-disable @typescript-eslint/no-explicit-any -- CDP payloads are untyped by Electron */
import type {WebContents} from 'electron';

/**
 * One debugger attach per preview, shared by everything that talks to Chromium
 * about it: the point-to-inspect overlay, a device's own colour scheme, and the
 * test engine's network and CPU conditions. Each user is an "owner": the
 * debugger detaches only when the last owner lets go, so one feature switching
 * off never drops another's emulation.
 */
export type CdpListener = (method: string, params: any) => void;

interface Held {
  listeners: Map<string, {handler: (...args: any[]) => void}>;
}
const held = new Map<number, Held>();

export const acquireDebugger = (
  contents: WebContents,
  owner: string,
  onEvent?: CdpListener
): Electron.Debugger => {
  const dbg = contents.debugger;
  let entry = held.get(contents.id);
  if (!entry) {
    entry = {listeners: new Map()};
    held.set(contents.id, entry);
    contents.once('destroyed', () => held.delete(contents.id));
  }
  if (!dbg.isAttached()) dbg.attach('1.3');
  if (!entry.listeners.has(owner)) {
    const handler = (_event: unknown, method: string, params: any) => onEvent?.(method, params);
    entry.listeners.set(owner, {handler});
    dbg.on('message', handler);
  }
  return dbg;
};

export const releaseDebugger = (contents: WebContents, owner: string) => {
  const entry = held.get(contents.id);
  if (!entry || contents.isDestroyed()) {
    held.delete(contents.id);
    return;
  }
  const mine = entry.listeners.get(owner);
  if (mine) contents.debugger.removeListener('message', mine.handler as never);
  entry.listeners.delete(owner);
  if (entry.listeners.size === 0) {
    held.delete(contents.id);
    if (contents.debugger.isAttached()) contents.debugger.detach();
  }
};

export const holdsDebugger = (contents: WebContents, owner: string) =>
  held.get(contents.id)?.listeners.has(owner) ?? false;
