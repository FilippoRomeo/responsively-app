// @vitest-environment node
import fs from 'fs';
import os from 'os';
import path from 'path';
import {describe, expect, it} from 'vitest';
import {Sandbox} from './manager';
import type {SandboxSettings, SandboxState} from '../../common/sandbox';
import {DEFAULT_SANDBOX, tmuxNameFor} from '../../common/sandbox';

// Boots a real colima VM (minutes, ~2 GB of memory), so it runs only when asked:
// E2E_SANDBOX=1 on a Mac with colima installed.
describe.skipIf(!process.env.E2E_SANDBOX)('a real sandbox', () => {
  it(
    'is created, proved running, runs commands without an ssh-agent or your home folder, keeps tmux sessions, stops and is destroyed',
    {timeout: 25 * 60_000},
    async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sbx-it-'));
      let saved: SandboxSettings = {...DEFAULT_SANDBOX, mode: 'sandbox', size: 1};
      const states: SandboxState[] = [];
      const sandbox = new Sandbox({
        sessionId: `it${Date.now().toString(36)}`,
        sessionName: () => 'integration',
        root,
        load: () => saved,
        save: (s) => {
          saved = s;
        },
        emit: (s) => states.push(s),
      });
      try {
        expect((await sandbox.refresh()).phase).toBe('none');
        const created = await sandbox.create();
        expect(created.detail).toBeUndefined();
        expect(created.phase).toBe('running');
        expect(states.some((s) => s.phase === 'creating' && (s.progress ?? 0) > 0)).toBe(true);

        // Commands run inside, as a user, in a workspace.
        const who = await sandbox.exec(
          'whoami; uname -m; test -d "$HOME/workspace" && echo workspace'
        );
        expect(who.stdout).toContain('workspace');
        // The Mac's home folder and ssh keys are not there, and no agent was forwarded.
        const mac = await sandbox.exec(
          `ls ${os.homedir()}/.ssh 2>&1; echo "agent=\${SSH_AUTH_SOCK:-none}"`
        );
        expect(mac.stdout).toMatch(/No such file|cannot access/);
        expect(mac.stdout).toContain('agent=none');

        // An agent's commands and files: exit codes, a hard time limit, and a workspace it cannot leave.
        const ran = await sandbox.runCommand('echo hi; echo oops >&2; exit 3', undefined, 30);
        expect(ran).toMatchObject({exitCode: 3, stdout: 'hi\n', timedOut: false});
        expect(ran.stderr).toContain('oops');
        const slow = await sandbox.runCommand('sleep 30', undefined, 1);
        expect(slow.timedOut).toBe(true);
        expect(await sandbox.writeFile('deep/dir/a.txt', 'héllo\n')).toBeGreaterThan(5);
        expect(await sandbox.readFile('deep/dir/a.txt')).toBe('héllo\n');
        expect((await sandbox.runCommand('pwd', 'deep', 10)).stdout.trim()).toMatch(
          /workspace\/deep$/
        );
        await expect(sandbox.readFile('../etc/passwd')).rejects.toThrow(/inside/);
        await expect(sandbox.readFile('/etc/passwd')).rejects.toThrow(/relative/);
        await sandbox.exec('ln -s /etc "$HOME/workspace/escape"');
        await expect(sandbox.readFile('escape/hostname')).rejects.toThrow(/Outside the workspace/);
        await expect(sandbox.writeFile('escape/x', 'no')).rejects.toThrow(/Outside the workspace/);
        await expect(sandbox.readFile('missing.txt')).rejects.toThrow(/No such file/);

        // A terminal-style tmux session survives, is found again, and is ended on request.
        const name = tmuxNameFor('0123456789abcdef');
        await sandbox.exec(`tmux new-session -d -s ${name} "sleep 600"`);
        expect(await sandbox.tmuxSessions()).toContain(name);
        await sandbox.exec('python3 -m http.server 18765 --bind 127.0.0.1 >/dev/null 2>&1 &');
        await new Promise((resolve) => {
          setTimeout(resolve, 1500);
        });
        expect(await sandbox.listeningPorts()).toContain(18765);
        await sandbox.killTmux(name);
        expect(await sandbox.tmuxSessions()).not.toContain(name);

        // Stop keeps the disk; start proves it again; destroy needs the typed name and a stopped machine.
        expect((await sandbox.stop()).phase).toBe('stopped');
        expect(() => sandbox.destroy('wrong')).toThrow(/exactly/);
        expect((await sandbox.start()).phase).toBe('running');
        expect(() => sandbox.destroy('integration')).toThrow(/Stop the sandbox first/);
        await sandbox.stop();
        expect((await sandbox.destroy('integration')).phase).toBe('none');
      } finally {
        sandbox.dispose();
        const phase = (await sandbox.refresh()).phase;
        if (phase === 'running') await sandbox.stop();
        if (phase !== 'none') await sandbox.destroy('integration').catch(() => {});
        fs.rmSync(root, {recursive: true, force: true});
      }
    }
  );
});
