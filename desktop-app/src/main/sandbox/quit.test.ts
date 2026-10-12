// @vitest-environment node
import fs from 'fs';
import os from 'os';
import path from 'path';
import {describe, expect, it} from 'vitest';
import {noteFile, readQuitNote, writeQuitNote} from './quit';

describe('the stop-on-quit note', () => {
  const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sbx-note-'));

  it('says to stop only when asked to, for a profile this app made', () => {
    const d = dir();
    expect(readQuitNote(d)).toBeNull();
    writeQuitNote(d, {profile: 'resp-ab12cd34', stop: true});
    expect(readQuitNote(d)).toEqual({profile: 'resp-ab12cd34', stop: true});
    writeQuitNote(d, {profile: 'resp-ab12cd34', stop: false});
    expect(readQuitNote(d)).toBeNull();
  });

  it('ignores a note that names anything else', () => {
    const d = dir();
    fs.writeFileSync(noteFile(d), JSON.stringify({profile: 'default', stop: true}));
    expect(readQuitNote(d)).toBeNull();
    fs.writeFileSync(noteFile(d), '{broken');
    expect(readQuitNote(d)).toBeNull();
  });
});
