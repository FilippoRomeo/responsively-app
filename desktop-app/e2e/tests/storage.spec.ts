import fs from 'fs';
import os from 'os';
import path from 'path';
import {test, expect} from '../fixtures/electron-app';

/**
 * A Python tool as people have it (a folder with requirements.txt): it gets
 * its own environment in Responsively's folder, its commands run inside it,
 * and Settings › Storage shows and removes it.
 */
test('a Python add-on runs in its own environment; Storage lists and removes it', async ({app}) => {
  test.setTimeout(180_000);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'py-tool-'));
  fs.writeFileSync(path.join(dir, 'requirements.txt'), '');
  const name = path.basename(dir);
  const started = path.join(dir, 'started.txt');

  await app.dismissModals();
  await app.page.getByTestId('addons-button').click();
  await app.page.getByTestId('addon-source').fill(dir);
  await app.page.getByRole('button', {name: 'Look inside'}).click();

  // Found as a Python project; plain venv works on every Mac with python3.
  await app.page.getByRole('radio', {name: /^venv/}).check();
  await expect(app.page.getByLabel('Build command')).toHaveValue('pip install -r requirements.txt');
  await app.page.getByRole('button', {name: '+ Start command'}).click();
  await app.page
    .getByLabel('Start command')
    .fill(
      `python -c "import sys, time; open('started.txt', 'w').write(sys.prefix); time.sleep(60)"`
    );
  await app.page.getByRole('button', {name: 'Run', exact: true}).click();
  await expect(app.page.getByRole('status').filter({hasText: /Built|Stopped/})).toBeVisible({
    timeout: 120_000,
  });
  await expect(app.page.getByRole('status')).toHaveText('Built.');
  await app.page.getByRole('button', {name: 'Continue'}).click();
  await expect(
    app.page.getByText('Make a venv Python environment for it, kept in Responsively')
  ).toBeVisible();
  await app.page.getByRole('button', {name: 'Allow and install'}).click();
  await app.page.getByRole('button', {name: 'Close'}).click();

  // Its start command ran inside the environment, which is not in its folder.
  await expect.poll(() => fs.existsSync(started), {timeout: 30_000}).toBe(true);
  const env = fs.readFileSync(started, 'utf8');
  expect(env).toMatch(/[/\\]addons[/\\]envs[/\\]py-tool-/);
  expect(env.startsWith(dir)).toBe(false);
  expect(fs.readdirSync(dir).sort()).toEqual(['requirements.txt', 'started.txt']);

  await app.openSettings();
  const storage = app.page.getByTestId('settings-storage');
  await expect(storage.getByRole('region', {name: 'Add-ons'})).toContainText(name);
  await expect(storage.getByRole('region', {name: 'Session profiles'})).toBeVisible();
  const envs = storage.getByRole('region', {name: 'Python environments'});
  await envs.getByRole('button', {name: `Delete ${name} · venv`}).click();
  await envs.getByRole('button', {name: /^Delete .*B\?$/}).click();
  await expect(envs).toContainText('None: Python add-ons get one when they are built.');
  expect(fs.existsSync(env)).toBe(false);

  const addons = storage.getByRole('region', {name: 'Add-ons'});
  await addons.getByRole('button', {name: `Uninstall ${name}`}).click();
  await addons.getByRole('button', {name: /^Uninstall .*B\?$/}).click();
  await expect(addons).toContainText('None installed.');
  // The user's folder stays.
  expect(fs.existsSync(path.join(dir, 'requirements.txt'))).toBe(true);
});
