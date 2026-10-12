import {execFile} from 'child_process';
import fs from 'fs';
import path from 'path';
import log from '../logging';
import {findColima, toolEnv} from './manager';

/**
 * "Stop when I quit": the Session's own window cannot do this (closing it must leave
 * the sandbox alone), so the sandbox leaves a note in the Session's folder and whoever
 * stops the Session (the controller; or the window itself outside Sessions) reads it.
 */
export interface QuitNote {
  profile: string;
  stop: boolean;
}

export const noteFile = (sandboxRoot: string) => path.join(sandboxRoot, 'stop-on-quit.json');

export const writeQuitNote = (sandboxRoot: string, note: QuitNote) => {
  try {
    fs.mkdirSync(sandboxRoot, {recursive: true});
    fs.writeFileSync(noteFile(sandboxRoot), JSON.stringify(note), {mode: 0o600});
  } catch (e) {
    log.warn('[sandbox] could not save the stop-on-quit note', e);
  }
};

export const readQuitNote = (sandboxRoot: string): QuitNote | null => {
  try {
    const v = JSON.parse(fs.readFileSync(noteFile(sandboxRoot), 'utf8'));
    return v && v.stop === true && /^resp-[a-z0-9]{1,16}$/.test(String(v.profile))
      ? {profile: v.profile, stop: true}
      : null;
  } catch {
    return null;
  }
};

/** Stops the sandbox if its note says so. Detached: stopping a Session must not wait for a VM. */
export const stopSandboxIfNoted = (sandboxRoot: string): boolean => {
  const note = readQuitNote(sandboxRoot);
  const colima = findColima();
  if (!note || !colima) return false;
  log.info('[sandbox] stopping', note.profile, 'as its Session ended');
  execFile(colima, ['stop', note.profile], {env: toolEnv(), timeout: 5 * 60_000}, () => {}).unref();
  return true;
};
