import {Dialog, DialogPanel, DialogTitle} from '@headlessui/react';
import {Icon} from '@iconify/react';
import {useCallback, useEffect, useState} from 'react';
import {IPC_MAIN_CHANNELS} from 'common/constants';
import {SessionInfo, SessionRequest} from 'common/sessions';
import {getDevicesMap} from 'common/deviceList';
import Input from '../Input';
import {ToolbarAction} from '../ToolBar/primitives';
import useOverlayRegistry from 'renderer/hooks/useOverlayRegistry';

const request = (value: SessionRequest) =>
  window.electron.ipcRenderer.invoke<SessionRequest, SessionInfo | SessionInfo[]>(
    IPC_MAIN_CHANNELS.SESSIONS_REQUEST,
    value
  );
const actionClass =
  'min-w-[64px] justify-center border border-line disabled:cursor-not-allowed disabled:opacity-40';

export const SessionsButton = () => (
  <ToolbarAction
    onClick={() => window.dispatchEvent(new Event('responsively:sessions'))}
    title="Manage Sessions"
  >
    <Icon icon="lucide:panels-top-left" />
    Sessions
  </ToolbarAction>
);
export default function Sessions() {
  const [visible, setVisible] = useState(false);
  const [items, setItems] = useState<SessionInfo[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [start, setStart] = useState(true);
  const [deleting, setDeleting] = useState<SessionInfo | null>(null);
  const [filter, setFilter] = useState('');
  useOverlayRegistry(visible);
  useEffect(() => {
    window.electron.ipcRenderer
      .invoke<unknown, boolean | null>(IPC_MAIN_CHANNELS.SESSIONS_READY)
      .then((create) => {
        if (create !== null) {
          setVisible(true);
          if (create) setEditing('new');
        }
        return undefined;
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    const open = () => setVisible(true);
    window.addEventListener('responsively:sessions', open);
    return () => window.removeEventListener('responsively:sessions', open);
  }, []);
  const refresh = useCallback(async () => {
    try {
      setItems((await request({operation: 'list'})) as SessionInfo[]);
    } catch (e) {
      setError(String(e));
    }
  }, []);
  useEffect(
    () =>
      window.electron.ipcRenderer.on<boolean>(IPC_MAIN_CHANNELS.SESSIONS_SHOW, (create) => {
        setVisible(true);
        if (create) {
          setEditing('new');
          setName('');
          setUrl('');
        }
      }),
    []
  );
  useEffect(() => {
    if (!visible) return undefined;
    void refresh();
    const timer = setInterval(refresh, 2000);
    return () => clearInterval(timer);
  }, [visible, refresh]);
  const run = async (value: SessionRequest) => {
    setBusy(value.id ?? 'new');
    setError('');
    try {
      await request(value);
      setEditing(null);
      setDeleting(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  const newSession = () => {
    setEditing('new');
    setName('');
    setUrl('');
    setStart(true);
    setError('');
  };
  return (
    <>
      <Dialog open={visible} onClose={() => setVisible(false)} className="relative z-50">
        <div className="fixed inset-0 bg-black/50" aria-hidden="true" />
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <DialogPanel
            className="flex max-h-[85vh] w-[660px] max-w-full flex-col rounded-[10px] border border-line bg-panel text-fg shadow-elevated"
            data-testid="sessions-manager"
          >
            <div className="flex items-center gap-3 border-b border-line p-4">
              <DialogTitle className="flex-1 text-lg font-semibold">Sessions</DialogTitle>
              <ToolbarAction onClick={newSession}>
                <Icon icon="lucide:plus" />
                New Session
              </ToolbarAction>
              <ToolbarAction onClick={() => setVisible(false)} aria-label="Close Sessions">
                <Icon icon="lucide:x" />
              </ToolbarAction>
            </div>
            {error && (
              <p role="alert" className="px-4 pt-3 text-sm text-red-500">
                {error}
              </p>
            )}
            {editing !== null ? (
              <form
                className="grid gap-4 p-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(
                    editing === 'new'
                      ? {operation: 'create', name, url: url || undefined, open: start}
                      : {operation: 'rename', id: editing, name}
                  );
                }}
              >
                <h2 className="font-semibold">
                  {editing === 'new' ? 'New Session' : 'Rename Session'}
                </h2>
                <Input
                  label="Name"
                  value={name}
                  maxLength={100}
                  required
                  onChange={(e) => setName(e.target.value)}
                />
                {editing === 'new' && (
                  <>
                    <Input
                      label="Starting URL (optional)"
                      placeholder="localhost:3000"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                    />
                    <Input
                      label="Open immediately"
                      type="checkbox"
                      checked={start}
                      onChange={(e) => setStart(e.target.checked)}
                    />
                  </>
                )}
                <div className="flex justify-end gap-2">
                  <ToolbarAction onClick={() => setEditing(null)}>Cancel</ToolbarAction>
                  <ToolbarAction
                    type="submit"
                    disabled={busy !== null || !name.trim()}
                    className={actionClass}
                  >
                    {busy ? 'Saving…' : 'Save'}
                  </ToolbarAction>
                </div>
              </form>
            ) : (
              <>
                {items.length > 5 && (
                  <div className="px-4 pt-3">
                    <Input
                      label="Find a session"
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                    />
                  </div>
                )}
                <div className="min-h-[160px] overflow-y-auto p-4">
                  {items.length === 0 ? (
                    <div className="py-8 text-center">
                      <Icon
                        icon="lucide:panels-top-left"
                        className="mx-auto mb-3 text-muted"
                        fontSize={28}
                      />
                      <p className="font-semibold">A separate space for each project</p>
                      <p className="mt-2 text-sm text-muted">
                        Create a Session to keep its pages, devices and browser data together.
                      </p>
                    </div>
                  ) : (
                    items
                      .filter((s) =>
                        (s.name + s.lastUrl).toLowerCase().includes(filter.toLowerCase())
                      )
                      .map((s) => (
                        <div
                          key={s.id}
                          className="mb-3 rounded-[9px] border border-line bg-card p-3"
                          data-testid={`session-${s.id}`}
                        >
                          <div className="flex items-center gap-3">
                            <span className="min-w-0 flex-1 truncate font-semibold" title={s.name}>
                              {s.name}
                            </span>
                            <span className="text-xs capitalize text-muted">
                              {busy === s.id ? 'Working…' : s.status}
                            </span>
                          </div>
                          <p className="mt-1 truncate text-sm text-muted" title={s.lastUrl}>
                            {s.lastUrl || 'No starting URL'}
                          </p>
                          <p className="mt-1 min-h-4 truncate text-xs text-muted">
                            {s.devices?.map((id) => getDevicesMap()[id]?.name ?? id).join(' · ') ||
                              'Devices saved with this Session'}
                          </p>
                          {s.error && <p className="mt-2 text-sm text-red-500">{s.error}</p>}
                          <div className="mt-3 flex flex-wrap justify-end gap-2">
                            <ToolbarAction
                              className={actionClass}
                              disabled={busy !== null}
                              onClick={() => {
                                setEditing(s.id);
                                setName(s.name);
                              }}
                            >
                              Rename
                            </ToolbarAction>
                            <ToolbarAction
                              className={actionClass}
                              disabled={busy !== null || s.status !== 'stopped'}
                              onClick={() => setDeleting(s)}
                            >
                              Delete
                            </ToolbarAction>
                            <ToolbarAction
                              className={actionClass}
                              disabled={busy !== null || !['running', 'error'].includes(s.status)}
                              onClick={() => void run({operation: 'stop', id: s.id})}
                            >
                              Stop
                            </ToolbarAction>
                            <ToolbarAction
                              className={actionClass}
                              disabled={
                                busy !== null || ['starting', 'stopping'].includes(s.status)
                              }
                              onClick={() =>
                                void run({
                                  operation: s.status === 'running' ? 'focus' : 'open',
                                  id: s.id,
                                })
                              }
                            >
                              {s.status === 'running' ? 'Focus' : 'Open'}
                            </ToolbarAction>
                          </div>
                        </div>
                      ))
                  )}
                </div>
              </>
            )}
            {deleting && (
              <div className="border-t border-line p-4" role="alert">
                <p className="break-words font-semibold">Delete “{deleting.name}”?</p>
                <p className="mt-1 text-sm text-muted">
                  Its browser data will move to Trash and it will be removed from Sessions.
                </p>
                <div className="mt-3 flex justify-end gap-2">
                  <ToolbarAction onClick={() => setDeleting(null)}>Cancel</ToolbarAction>
                  <ToolbarAction
                    disabled={busy !== null}
                    className={actionClass}
                    onClick={() =>
                      void run({operation: 'delete', id: deleting.id, confirmed: true})
                    }
                  >
                    Delete Session
                  </ToolbarAction>
                </div>
              </div>
            )}
          </DialogPanel>
        </div>
      </Dialog>
    </>
  );
}
