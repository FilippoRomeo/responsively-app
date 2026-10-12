import cx from 'classnames';
import {SANDBOX_SIZES, type SandboxPhase, type SandboxSettings} from 'common/sandbox';
import {useState} from 'react';
import {useSandbox} from './useSandbox';

const PHASE: Record<SandboxPhase, {label: string; dot: string}> = {
  none: {label: 'Not created', dot: 'bg-muted'},
  creating: {label: 'Creating…', dot: 'bg-yellow-400 animate-pulse'},
  stopped: {label: 'Stopped', dot: 'bg-muted'},
  starting: {label: 'Starting…', dot: 'bg-yellow-400 animate-pulse'},
  running: {label: 'Running', dot: 'bg-accent'},
  stopping: {label: 'Stopping…', dot: 'bg-yellow-400 animate-pulse'},
  destroying: {label: 'Deleting…', dot: 'bg-yellow-400 animate-pulse'},
  'missing-runtime': {label: 'colima is not installed', dot: 'bg-red-400'},
};

const PROOF: Partial<Record<SandboxPhase, string>> = {
  none: 'Nothing exists yet. Creating downloads a base system once, then starts it.',
  stopped: 'Its disk and files are kept. Start brings it back in about 10 seconds.',
  running:
    'Proved running: a command inside answers. Terminals here are tmux sessions, so they survive quitting Responsively.',
  creating: 'Not running yet. It is shown as running only after a command inside answers.',
  starting: 'Not running yet. It is shown as running only after a command inside answers.',
  stopping: 'Terminals end, files stay.',
};

const gb = (bytes?: number) => (bytes ? `${(bytes / 1e9).toFixed(1)} GB` : 'unknown');
const btn =
  'h-[30px] rounded-lg border border-line px-[14px] text-[12.5px] hover:bg-hover focus:outline-none focus-visible:ring-1 focus-visible:ring-accent disabled:opacity-40 disabled:hover:bg-transparent';
const go =
  'h-[30px] rounded-lg bg-accent px-[14px] text-[12.5px] font-bold text-black focus:outline-none focus-visible:ring-2 focus-visible:ring-fg disabled:opacity-50';

const Switch = ({
  label,
  hint,
  on,
  onChange,
  disabled,
}: {
  label: string;
  hint: string;
  on: boolean;
  onChange: () => void;
  disabled?: boolean;
}) => (
  <label className="flex items-center gap-2">
    <input
      type="checkbox"
      aria-label={label}
      checked={on}
      disabled={disabled}
      onChange={onChange}
      className="m-0 accent-accent"
    />
    <span>
      {label} <span className="text-[11px] text-muted">{hint}</span>
    </span>
  </label>
);

const Row = ({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) => (
  <div className="grid grid-cols-[190px_1fr] items-center gap-[10px] border-t border-line py-[7px] text-[12.5px]">
    <span>
      {title}
      {hint ? <span className="block text-[11px] text-muted">{hint}</span> : null}
    </span>
    <span>{children}</span>
  </div>
);

/** Environment: Local (your Mac) or this Session's Sandbox, with its lifecycle and settings. */
const EnvironmentView = () => {
  const {state, error, act, set, pickFolder} = useSandbox();
  const [typed, setTyped] = useState('');
  const [confirming, setConfirming] = useState(false);
  if (!state)
    return (
      <div className="p-4 text-[12.5px] text-muted">Looking for this Session&apos;s sandbox…</div>
    );

  const s: SandboxSettings = state.settings;
  const sandbox = s.mode === 'sandbox';
  const phase = state.phase;
  const busy = ['creating', 'starting', 'stopping', 'destroying'].includes(phase);
  // What a machine was built with is fixed once it exists.
  const locked = phase !== 'none' && phase !== 'missing-runtime';
  const running = phase === 'running';
  const memory = (1.2 + s.size * 0.3 + (s.docker ? 1 : 0)).toFixed(1);

  return (
    <div
      data-testid="environment-view"
      className="flex h-full gap-5 overflow-auto px-5 py-4 text-[12.5px]"
    >
      <div className="flex w-[300px] flex-shrink-0 flex-col gap-[10px]">
        <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted">
          Where commands run
        </div>
        {(['local', 'sandbox'] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            aria-pressed={s.mode === mode}
            disabled={busy}
            onClick={() => set({mode})}
            className={cx(
              'rounded-xl border p-3 text-left focus:outline-none focus-visible:ring-1 focus-visible:ring-accent',
              s.mode === mode ? 'border-accent' : 'border-line'
            )}
          >
            <b className="text-[13.5px]">{mode === 'local' ? 'Local' : 'Sandbox'}</b>{' '}
            <span className="text-[11px] text-muted">
              {mode === 'local' ? 'your Mac' : 'a small Linux machine for this Session'}
            </span>
            <span className="mt-1 block text-[11px] leading-[1.45] text-muted">
              {mode === 'local'
                ? 'Runs as you, in your login shell, with everything you can reach. Convenient, not isolated: an agent running here would have your whole Mac.'
                : 'Its own Ubuntu, its own files, its own network. It cannot see your home folder or keys unless you add one folder.'}
            </span>
          </button>
        ))}
        <p className="text-[11px] text-muted">
          Switching never deletes anything. A Session with no environment behaves as before.
        </p>
      </div>

      <div className="min-w-0 max-w-[760px] flex-1">
        {error ? (
          <p role="alert" className="mb-2 text-red-400">
            {error}
          </p>
        ) : null}

        {!sandbox ? (
          <div className="rounded-xl border border-line p-4">
            <b className="text-[14px]">Local terminal</b>
            <p className="my-2 text-[11.5px] text-muted">
              Tabs open on your Mac. They keep running when you close the panel or the window, and
              end when you Stop the Session or quit.
            </p>
            <Row title="Agents running commands">
              <span className="text-red-400">Off</span>{' '}
              <span className="text-[11px] text-muted">
                Equal to access to your whole Mac, so agents cannot run commands here.
              </span>
            </Row>
          </div>
        ) : (
          <div className="rounded-xl border border-line p-4">
            <div className="flex items-center gap-[10px]">
              <i className={cx('h-[9px] w-[9px] rounded-full', PHASE[phase].dot)} />
              <b className="text-[14px]">Sandbox · Ubuntu</b>
              <span className={cx('text-[12px]', running ? 'text-accent' : 'text-muted')}>
                {PHASE[phase].label}
              </span>
              <span className="flex-1" />
              {phase === 'none' ? (
                <button type="button" className={go} onClick={() => act('create')}>
                  Create sandbox
                </button>
              ) : null}
              {phase === 'stopped' ? (
                <button type="button" className={go} onClick={() => act('start')}>
                  Start
                </button>
              ) : null}
              {running ? (
                <>
                  <button type="button" className={btn} onClick={() => act('restart')}>
                    Restart
                  </button>
                  <button type="button" className={btn} onClick={() => act('stop')}>
                    Stop
                  </button>
                </>
              ) : null}
            </div>
            <p role="status" className="mb-2 mt-1 text-[11px] text-muted">
              {phase === 'missing-runtime' ? state.detail : PROOF[phase]}
            </p>
            {state.detail && phase !== 'missing-runtime' ? (
              <p className="mb-2 text-[11.5px] text-red-400">{state.detail}</p>
            ) : null}
            {busy ? (
              <div className="mb-2">
                <div className="h-[3px] overflow-hidden rounded bg-line">
                  <div
                    className="h-full bg-accent transition-[width] duration-500"
                    style={{width: `${state.progress ?? 10}%`}}
                  />
                </div>
                <div className="mt-1 text-[11px] text-muted">{state.step}</div>
              </div>
            ) : null}

            <Row title="Size">
              <span
                role="group"
                aria-label="Size"
                className="inline-flex gap-[2px] rounded-lg border border-line p-[2px]"
              >
                {SANDBOX_SIZES.map((n) => (
                  <button
                    key={n}
                    type="button"
                    disabled={locked}
                    aria-pressed={s.size === n}
                    onClick={() => set({size: n})}
                    className={cx(
                      'h-6 rounded-md px-[10px] text-[11.5px] disabled:opacity-60',
                      s.size === n ? 'bg-accent-soft text-accent' : 'text-fg hover:bg-hover'
                    )}
                  >
                    {n} CPU · {n} GiB
                  </button>
                ))}
              </span>
              {locked ? (
                <span className="ml-2 text-[11px] text-muted">fixed once created</span>
              ) : null}
            </Row>
            <Row title="A Mac folder to work in" hint="optional, just one">
              <span className="font-mono text-[11.5px]">
                {s.folder ? `${s.folder} → shown inside` : 'None: the sandbox has no Mac files'}
              </span>{' '}
              {locked ? null : s.folder ? (
                <button type="button" className={btn} onClick={() => set({folder: undefined})}>
                  Remove
                </button>
              ) : (
                <button type="button" className={btn} onClick={pickFolder}>
                  Choose folder…
                </button>
              )}
            </Row>
            {s.folder ? (
              <p className="pb-1 pl-[200px] text-[11px] text-yellow-400">
                Files in a Mac folder are about 20× slower for many small files (npm install, git
                status). The sandbox&apos;s own disk is fast: keep the project there.
              </p>
            ) : null}
            <Row title="Docker and Compose inside" hint="its own Docker, never your Mac's">
              <Switch
                label="On"
                hint="(about 1 GB more memory while running)"
                on={s.docker}
                disabled={locked}
                onChange={() => set({docker: !s.docker})}
              />
            </Row>
            <Row title="Use my ssh keys inside" hint="for git push and ssh">
              <Switch
                label="Forward my ssh-agent"
                hint="(it can use your keys while on; it cannot read or copy them)"
                on={s.sshAgent}
                disabled={locked}
                onChange={() => set({sshAgent: !s.sshAgent})}
              />
            </Row>
            <Row title="Stop when idle">
              <Switch
                label="After 30 min with no typing"
                hint="(your data stays; the Mac gets its memory back)"
                on={s.idleStop}
                onChange={() => set({idleStop: !s.idleStop})}
              />
            </Row>
            <Row title="New ports">
              <span
                role="group"
                aria-label="New ports"
                className="inline-flex gap-[2px] rounded-lg border border-line p-[2px]"
              >
                {(['ask', 'auto'] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    aria-pressed={s.publish === p}
                    onClick={() => set({publish: p})}
                    className={cx(
                      'h-6 rounded-md px-[10px] text-[11.5px]',
                      s.publish === p ? 'bg-accent-soft text-accent' : 'text-fg hover:bg-hover'
                    )}
                  >
                    {p === 'ask' ? 'Ask me' : 'Publish at once'}
                  </button>
                ))}
              </span>
              <span className="ml-2 text-[11px] text-muted">
                Published ports answer on this Mac&apos;s localhost.
              </span>
            </Row>
            <Row title="On this Mac">
              {running
                ? `About ${memory} GB of memory while running · ${gb(state.diskBytes)} of disk`
                : phase === 'none'
                  ? 'Nothing yet'
                  : `0 GB of memory while stopped · ${gb(state.diskBytes)} of disk kept`}
            </Row>

            {phase === 'stopped' ? (
              <div className="mt-3 border-t border-line pt-3">
                {!confirming ? (
                  <>
                    <button
                      type="button"
                      className={cx(btn, 'border-danger text-danger')}
                      onClick={() => setConfirming(true)}
                    >
                      Destroy sandbox…
                    </button>{' '}
                    <span className="text-[11px] text-muted">
                      Deletes its disk ({gb(state.diskBytes)}) for good. It can be recreated from
                      these settings.
                    </span>
                  </>
                ) : (
                  <div className="flex items-center gap-2">
                    <span>
                      Type <b className="font-mono">{state.sessionName}</b> to delete its disk:
                    </span>
                    <input
                      aria-label="Type the Session name to confirm"
                      value={typed}
                      onChange={(e) => setTyped(e.target.value)}
                      className="h-7 w-[160px] rounded-md border border-line bg-transparent px-2"
                    />
                    <button
                      type="button"
                      disabled={typed !== state.sessionName}
                      className={cx(btn, 'border-danger text-danger')}
                      onClick={() => {
                        act('destroy', typed);
                        setConfirming(false);
                        setTyped('');
                      }}
                    >
                      Delete for good
                    </button>
                    <button type="button" className={btn} onClick={() => setConfirming(false)}>
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
};

export default EnvironmentView;
