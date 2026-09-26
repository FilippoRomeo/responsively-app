import {Icon} from '@iconify/react';
import {useCallback, useEffect, useRef, useState} from 'react';
import {IPC_MAIN_CHANNELS} from 'common/constants';
import {SessionInfo, SessionRequest} from 'common/sessions';
import {getDevicesMap} from 'common/deviceList';
import Popover from '../Popover';
import Input from '../Input';
import {ToolbarAction} from '../ToolBar/primitives';

export type SessionRequester = (value: SessionRequest) => Promise<SessionInfo | SessionInfo[]>;
const request: SessionRequester = (value) =>
  window.electron.ipcRenderer.invoke(IPC_MAIN_CHANNELS.SESSIONS_REQUEST, value);
const actionClass =
  'justify-center border border-line bg-card disabled:cursor-not-allowed disabled:opacity-40';

export type SessionsShowRequest = {create: boolean; error: string; attention?: string};

/**
 * Receives the main process's SESSIONS_SHOW (⌘⇧M / ⌘⇧N in a Session window).
 * Mounted above the toolbar, which presentation mode unmounts, so a request is
 * never lost: it leaves presentation mode and is kept until the toolbar shows it.
 */
export const useSessionsShowRequest = (onShow: () => void) => {
  const [showRequest, setShowRequest] = useState<SessionsShowRequest | null>(null);
  const onShowRef = useRef(onShow);
  onShowRef.current = onShow;
  useEffect(
    () =>
      window.electron.ipcRenderer.on<{create?: boolean; error?: string}>(
        IPC_MAIN_CHANNELS.SESSIONS_SHOW,
        (value) => {
          onShowRef.current();
          setShowRequest({create: Boolean(value?.create), error: value?.error ?? ''});
        }
      ),
    []
  );
  const consumed = useCallback(() => setShowRequest(null), []);
  return [showRequest, consumed] as const;
};

/**
 * The toolbar's Sessions manager. In a Session window it names the Session, and
 * a show request opens it here instead of a separate floating panel.
 */
export const SessionsButton = ({
  showRequest = null,
  onShown,
}: {
  showRequest?: SessionsShowRequest | null;
  /** Called once the request is shown, so a later remount does not reopen the manager. */
  onShown?: () => void;
}) => {
  const trigger = useRef<HTMLSpanElement>(null);
  const isOpen = useRef(false);
  const [sessionName, setSessionName] = useState<string>();
  const refreshName = useCallback(() => {
    Promise.resolve(
      window.electron.ipcRenderer.invoke<never, {name?: string}>(IPC_MAIN_CHANNELS.SESSION_CONTEXT)
    )
      .then((value) => setSessionName(value?.name))
      .catch(() => {});
  }, []);
  useEffect(() => {
    refreshName();
    return window.electron.ipcRenderer.on(IPC_MAIN_CHANNELS.SESSION_RENAMED, refreshName);
  }, [refreshName]);
  // Kept locally for the manager, then consumed upstream so a remount does not replay it.
  const [shown, setShown] = useState<SessionsShowRequest | null>(null);
  useEffect(() => {
    if (!showRequest) return;
    if (!isOpen.current) trigger.current?.closest('button')?.click();
    setShown(showRequest);
    onShown?.();
  }, [showRequest, onShown]);
  return (
    <Popover
      trigger={
        <span ref={trigger} className="flex min-w-0 items-center gap-[7px]">
          <Icon icon="lucide:panels-top-left" />
          <span className="max-w-[180px] truncate" data-testid="sessions-button-label">
            {sessionName || 'Sessions'}
          </span>
        </span>
      }
      triggerClassName="flex h-[30px] items-center rounded-[7px] px-[11px] text-[12.5px] text-fg hover:bg-hover"
      triggerTitle="Manage Sessions"
      className="w-[420px] max-w-[calc(100vw-24px)] overflow-hidden"
      keepMounted
      onOpenChange={(open) => {
        isOpen.current = open;
        if (!open) refreshName();
      }}
    >
      {({close, open}) => (
        <SessionsManager request={request} onClose={close} active={open} showRequest={shown} />
      )}
    </Popover>
  );
};

export default function SessionsManager({
  request: send,
  onClose,
  initialCreate = false,
  initialError = '',
  initialAttention = '',
  active = true,
  showRequest,
  native = false,
  onHeight,
}: {
  request: SessionRequester;
  onClose: () => void;
  initialCreate?: boolean;
  initialError?: string;
  /** A Session an agent could not use: opens the attention view for it. */
  initialAttention?: string;
  active?: boolean;
  showRequest?: SessionsShowRequest | null;
  native?: boolean;
  onHeight?: (height: number) => void;
}) {
  const [items, setItems] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [actionError, setActionError] = useState(initialError);
  const [pending, setPending] = useState<Record<string, SessionRequest['operation'] | undefined>>(
    {}
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState('');
  const [editing, setEditing] = useState<string | null>(initialCreate ? 'new' : null);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [start, setStart] = useState(true);
  const [confirming, setConfirming] = useState<SessionInfo | null>(null);
  // The confirmation view serves Delete and Reset data; both act on a stopped Session.
  const [resetting, setResetting] = useState(false);
  const [attention, setAttention] = useState<string | null>(initialAttention || null);
  const [forcing, setForcing] = useState(false);
  const [filter, setFilter] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);
  const refreshId = useRef(0);
  const refreshing = useRef(false);
  const mounted = useRef(true);
  const draft = useRef<{id: string; name: string; url: string; start: boolean} | null>(null);
  const closeSubviewRef = useRef<(preserve?: boolean) => void>(() => {});

  const refresh = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    const id = ++refreshId.current;
    try {
      const result = (await send({operation: 'list'})) as SessionInfo[];
      if (!mounted.current || id !== refreshId.current) return;
      setItems(result);
      setListError('');
    } catch (error) {
      if (mounted.current && id === refreshId.current)
        setListError(error instanceof Error ? error.message : String(error));
    } finally {
      if (id === refreshId.current) {
        refreshing.current = false;
        if (mounted.current) setLoading(false);
      }
    }
  }, [send]);

  useEffect(() => {
    mounted.current = true;
    if (!active) return undefined;
    panelRef.current?.focus();
    void refresh();
    const timer = setInterval(() => void refresh(), 2000);
    return () => {
      mounted.current = false;
      refreshId.current += 1;
      refreshing.current = false;
      clearInterval(timer);
    };
  }, [active, refresh]);

  useEffect(() => {
    if (initialError) setActionError(initialError);
  }, [initialError]);

  useEffect(() => {
    if (!showRequest) return;
    if (showRequest.create) newSession();
    // Manage Sessions: back to the list, even in a panel that was hidden mid-form; the draft is kept.
    else if (!showRequest.attention) closeSubviewRef.current(true);
    if (showRequest.attention) {
      setEditing(null);
      setConfirming(null);
      setForcing(false);
      setAttention(showRequest.attention);
    }
    setActionError(showRequest.error);
    panelRef.current?.focus();
  }, [showRequest]);

  useEffect(() => {
    if (editing) panelRef.current?.querySelector<HTMLInputElement>('input[required]')?.focus();
  }, [editing]);

  useEffect(() => {
    if (!onHeight || !panelRef.current) return undefined;
    const observer = new ResizeObserver(() => onHeight(panelRef.current!.offsetHeight));
    observer.observe(panelRef.current);
    return () => observer.disconnect();
  }, [onHeight]);

  const run = async (value: SessionRequest) => {
    const key = value.id ?? 'new';
    setPending((previous) => ({...previous, [key]: value.operation}));
    setErrors((previous) => ({...previous, [key]: ''}));
    setSuccess('');
    try {
      const result = await send(value);
      if (value.operation === 'stop' && (Array.isArray(result) || result.status !== 'stopped'))
        throw new Error('Session stop could not be verified.');
      if (!mounted.current) return;
      if (
        value.operation === 'delete' ||
        value.operation === 'reset' ||
        value.operation === 'rename' ||
        value.operation === 'stop' ||
        (value.operation === 'create' && value.open === false)
      )
        panelRef.current?.focus();
      setEditing(null);
      setConfirming(null);
      setAttention(null);
      setForcing(false);
      draft.current = null;
      // Discard any refresh that started before this change landed.
      refreshId.current += 1;
      refreshing.current = false;
      await refresh();
      setSuccess(
        `${value.operation === 'create' ? 'Session created' : value.operation === 'rename' ? 'Session renamed' : value.operation === 'delete' ? 'Session moved to Trash' : value.operation === 'reset' ? 'Session data moved to Trash' : value.operation === 'stop' ? 'Session stopped' : value.operation === 'focus' ? 'Session focused' : value.operation === 'force-stop' ? 'Session force quit' : 'Session opened'}.`
      );
    } catch (error) {
      if (mounted.current)
        setErrors((previous) => ({
          ...previous,
          [key]: error instanceof Error ? error.message : String(error),
        }));
    } finally {
      if (mounted.current) setPending((previous) => ({...previous, [key]: undefined}));
    }
  };

  const newSession = () => {
    setEditing('new');
    setConfirming(null);
    setName(draft.current?.id === 'new' ? draft.current.name : '');
    setUrl(draft.current?.id === 'new' ? draft.current.url : '');
    setStart(draft.current?.id === 'new' ? draft.current.start : true);
    setErrors((previous) => ({...previous, new: ''}));
  };
  const matches = items.filter((item) =>
    `${item.name} ${item.lastUrl ?? ''}`.toLowerCase().includes(filter.toLowerCase())
  );
  const closeSubview = (preserve = false) => {
    draft.current = preserve && editing ? {id: editing, name, url, start} : null;
    setEditing(null);
    setConfirming(null);
    setAttention(null);
    setForcing(false);
    panelRef.current?.focus();
  };
  // The show-request effect runs only for new requests, but must see the current form.
  closeSubviewRef.current = closeSubview;

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      role="region"
      aria-label="Sessions manager"
      className={`flex ${native ? 'max-h-[520px]' : 'max-h-[min(620px,calc(100vh-48px))]'} flex-col overflow-hidden rounded-lg bg-panel text-fg outline-none`}
      data-testid="sessions-manager"
      onKeyDownCapture={(event) => {
        if (event.key !== 'Escape') return;
        if (editing || confirming || attention) {
          event.preventDefault();
          event.stopPropagation();
          closeSubview(true);
        } else {
          onClose();
        }
      }}
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">
        <h2 className="min-w-0 flex-1 text-sm font-semibold">Sessions</h2>
        <ToolbarAction onClick={newSession} disabled={Boolean(pending.new)}>
          <Icon icon="lucide:plus" /> New Session
        </ToolbarAction>
        <ToolbarAction onClick={onClose} aria-label="Close Sessions" title="Close Sessions">
          <Icon icon="lucide:x" />
        </ToolbarAction>
      </div>
      {success && (
        <p role="status" className="px-3 pt-2 text-xs text-accent">
          {success}
        </p>
      )}
      {listError && (
        <div role="alert" className="px-3 pt-2 text-xs text-red-700 dark:text-red-300">
          Sessions could not be refreshed: {listError}{' '}
          <button type="button" className="underline" onClick={() => void refresh()}>
            Retry
          </button>
        </div>
      )}
      {actionError && (
        <p role="alert" className="break-words px-3 pt-2 text-xs text-red-700 dark:text-red-300">
          {actionError}
        </p>
      )}
      {editing !== null ? (
        <form
          className="grid min-h-0 gap-3 overflow-y-auto p-3 text-sm"
          onSubmit={(event) => {
            event.preventDefault();
            void run(
              editing === 'new'
                ? {operation: 'create', name, url: url || undefined, open: start}
                : {operation: 'rename', id: editing, name}
            );
          }}
        >
          <h3 className="font-semibold">{editing === 'new' ? 'New Session' : 'Rename Session'}</h3>
          <Input
            label="Name"
            value={name}
            maxLength={100}
            required
            onChange={(event) => setName(event.target.value)}
          />
          {editing === 'new' && (
            <>
              <Input
                label="Starting URL (optional)"
                placeholder="localhost:3000"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
              />
              <Input
                label="Open immediately"
                type="checkbox"
                checked={start}
                onChange={(event) => setStart(event.target.checked)}
              />
            </>
          )}
          {errors[editing] && (
            <p role="alert" className="break-words text-red-700 dark:text-red-300">
              {errors[editing]}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <ToolbarAction onClick={() => closeSubview()}>Cancel</ToolbarAction>
            <ToolbarAction
              type="submit"
              disabled={Boolean(pending[editing]) || !name.trim()}
              className={actionClass}
            >
              {pending[editing]
                ? editing === 'new' && start
                  ? 'Starting…'
                  : editing === 'new'
                    ? 'Creating…'
                    : 'Renaming…'
                : 'Save'}
            </ToolbarAction>
          </div>
        </form>
      ) : confirming ? (
        <div className="grid gap-3 overflow-y-auto p-3 text-sm">
          <h3 className="break-words font-semibold">
            {resetting ? 'Reset' : 'Delete'} “{confirming.name}”?
          </h3>
          <p>
            {resetting
              ? 'Its browser data (cookies, storage, history and device choices) will move to Trash. The Session keeps its name and starting URL.'
              : 'Its browser data will move to Trash and it will be removed from Sessions.'}
          </p>
          {errors[confirming.id] && (
            <p role="alert" className="break-words text-red-700 dark:text-red-300">
              {errors[confirming.id]}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <ToolbarAction onClick={() => closeSubview()}>Cancel</ToolbarAction>
            <ToolbarAction
              disabled={Boolean(pending[confirming.id])}
              className={actionClass}
              onClick={() =>
                void run({
                  operation: resetting ? 'reset' : 'delete',
                  id: confirming.id,
                  confirmed: true,
                })
              }
            >
              {pending[confirming.id]
                ? resetting
                  ? 'Resetting…'
                  : 'Deleting…'
                : resetting
                  ? 'Reset Data'
                  : 'Delete Session'}
            </ToolbarAction>
          </div>
        </div>
      ) : attention ? (
        <AttentionView
          item={items.find((s) => s.id === attention)}
          loading={loading}
          forcing={forcing}
          pending={Boolean(pending[attention])}
          error={errors[attention]}
          onOpen={(id) => void run({operation: 'open', id})}
          onReset={(item) => {
            setResetting(true);
            setConfirming(item);
          }}
          onDelete={(item) => {
            setResetting(false);
            setConfirming(item);
          }}
          onForce={() => setForcing(true)}
          onForceConfirm={(id) => void run({operation: 'force-stop', id, confirmed: true})}
          onForceCancel={() => setForcing(false)}
          onDismiss={() => {
            closeSubview();
            onClose();
          }}
        />
      ) : (
        <>
          <div className="shrink-0 px-3 pt-3">
            <Input
              label="Find a session"
              placeholder="Search by name or URL…"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
          </div>
          <div className="min-h-0 overflow-y-auto p-3" data-testid="sessions-list">
            {loading ? (
              <p role="status" className="py-6 text-center text-sm">
                Loading Sessions…
              </p>
            ) : listError && items.length === 0 ? (
              <p className="py-6 text-center text-sm">Sessions are unavailable. Retry above.</p>
            ) : items.length === 0 ? (
              <div className="py-6 text-center text-sm">
                <Icon icon="lucide:panels-top-left" className="mx-auto mb-2" fontSize={26} />
                <p className="font-semibold">A separate space for each project</p>
                <p className="mt-2">
                  Create a Session to keep its pages, devices and browser data together.
                </p>
              </div>
            ) : matches.length === 0 ? (
              <p className="py-6 text-center text-sm">No Sessions match “{filter}”.</p>
            ) : (
              matches.map((item) => (
                <div
                  key={item.id}
                  className="mb-2 rounded-lg border border-line bg-card p-2.5 text-sm"
                  data-testid={`session-${item.id}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate font-semibold" title={item.name}>
                      {item.name}
                    </span>
                    <span className="shrink-0 text-xs">
                      {pending[item.id] === 'open'
                        ? 'Starting…'
                        : pending[item.id] === 'stop'
                          ? 'Stopping…'
                          : pending[item.id] === 'rename'
                            ? 'Renaming…'
                            : item.status[0].toUpperCase() + item.status.slice(1)}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-xs" title={item.lastUrl}>
                    {item.lastUrl || 'No starting URL'}
                  </p>
                  <p
                    className="mt-1 truncate text-xs"
                    title={item.devices?.map((id) => getDevicesMap()[id]?.name ?? id).join(' · ')}
                  >
                    {item.devices?.map((id) => getDevicesMap()[id]?.name ?? id).join(' · ') ||
                      'Devices saved with this Session'}
                  </p>
                  {(errors[item.id] || item.error) && (
                    <p
                      role="alert"
                      className="mt-2 break-words text-xs text-red-700 dark:text-red-300"
                    >
                      {errors[item.id] || item.error}
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap justify-end gap-1">
                    <ToolbarAction
                      className={actionClass}
                      disabled={Boolean(pending[item.id])}
                      onClick={() => {
                        setEditing(item.id);
                        setName(draft.current?.id === item.id ? draft.current.name : item.name);
                      }}
                    >
                      Rename
                    </ToolbarAction>
                    <ToolbarAction
                      className={actionClass}
                      disabled={Boolean(pending[item.id]) || item.status !== 'stopped'}
                      title="Move this Session's browser data to Trash and keep the Session"
                      onClick={() => {
                        setResetting(true);
                        setConfirming(item);
                      }}
                    >
                      Reset
                    </ToolbarAction>
                    <ToolbarAction
                      className={actionClass}
                      disabled={Boolean(pending[item.id]) || item.status !== 'stopped'}
                      onClick={() => {
                        setResetting(false);
                        setConfirming(item);
                      }}
                    >
                      Delete
                    </ToolbarAction>
                    <ToolbarAction
                      className={actionClass}
                      disabled={
                        Boolean(pending[item.id]) || !['running', 'error'].includes(item.status)
                      }
                      onClick={() => void run({operation: 'stop', id: item.id})}
                    >
                      Stop
                    </ToolbarAction>
                    <ToolbarAction
                      className={actionClass}
                      disabled={
                        Boolean(pending[item.id]) || ['starting', 'stopping'].includes(item.status)
                      }
                      onClick={() =>
                        void run({
                          operation: item.status === 'running' ? 'focus' : 'open',
                          id: item.id,
                        })
                      }
                    >
                      {item.status === 'running' ? 'Focus' : 'Open'}
                    </ToolbarAction>
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}

const STOP_CAUSE: Record<NonNullable<SessionInfo['lastStop']>['by'], string> = {
  user: 'Stopped by you',
  window: 'Stopped when its window was closed',
  quit: 'Stopped when Responsively quit',
  agent: 'Stopped by an agent',
  crash: 'Its process exited unexpectedly',
};

/** Why an agent could not use a Session, and what you can do about it. */
function AttentionView({
  item,
  loading,
  forcing,
  pending,
  error,
  onOpen,
  onReset,
  onDelete,
  onForce,
  onForceConfirm,
  onForceCancel,
  onDismiss,
}: {
  item: SessionInfo | undefined;
  loading: boolean;
  forcing: boolean;
  pending: boolean;
  error?: string;
  onOpen: (id: string) => void;
  onReset: (item: SessionInfo) => void;
  onDelete: (item: SessionInfo) => void;
  onForce: () => void;
  onForceConfirm: (id: string) => void;
  onForceCancel: () => void;
  onDismiss: () => void;
}) {
  if (!item)
    return (
      <div className="grid gap-3 p-3 text-sm" data-testid="session-attention">
        <p role="status">{loading ? 'Loading Session…' : 'This Session no longer exists.'}</p>
        <div className="flex justify-end">
          <ToolbarAction onClick={onDismiss}>Dismiss</ToolbarAction>
        </div>
      </div>
    );
  if (forcing)
    return (
      <div className="grid gap-3 overflow-y-auto p-3 text-sm" data-testid="session-attention">
        <h3 className="break-words font-semibold">Force quit “{item.name}”?</h3>
        <p>
          Responsively will end this Session&apos;s process, after checking it is really this
          Session&apos;s. Unsaved page state in its window can be lost; its browser data stays.
        </p>
        {error && (
          <p role="alert" className="break-words text-red-700 dark:text-red-300">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <ToolbarAction onClick={onForceCancel}>Cancel</ToolbarAction>
          <ToolbarAction
            disabled={pending}
            className={actionClass}
            onClick={() => onForceConfirm(item.id)}
          >
            {pending ? 'Force quitting…' : 'Force Quit'}
          </ToolbarAction>
        </div>
      </div>
    );
  const stopped = item.status === 'stopped';
  const crashed = item.status === 'error' && !item.hung;
  const cause = item.lastStop
    ? `${STOP_CAUSE[item.lastStop.by]} · ${new Date(item.lastStop.at).toLocaleString()}`
    : '';
  return (
    <div className="grid gap-3 overflow-y-auto p-3 text-sm" data-testid="session-attention">
      <h3 className="break-words font-semibold">“{item.name}” needs attention</h3>
      <p>An agent tried to use this Session, but it is not available.</p>
      <p role="alert" className="break-words text-red-700 dark:text-red-300">
        {item.status === 'running'
          ? 'It is running again.'
          : item.hung
            ? item.error
            : [stopped ? 'It is stopped.' : item.error, cause].filter(Boolean).join(' ')}
      </p>
      {error && (
        <p role="alert" className="break-words text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <ToolbarAction onClick={onDismiss}>Dismiss</ToolbarAction>
        {stopped && (
          <>
            <ToolbarAction className={actionClass} onClick={() => onDelete(item)}>
              Delete…
            </ToolbarAction>
            <ToolbarAction className={actionClass} onClick={() => onReset(item)}>
              Reset…
            </ToolbarAction>
          </>
        )}
        {item.hung && (
          <ToolbarAction className={actionClass} onClick={onForce}>
            Force Quit…
          </ToolbarAction>
        )}
        {(stopped || crashed) && (
          <ToolbarAction disabled={pending} className={actionClass} onClick={() => onOpen(item.id)}>
            {pending ? 'Opening…' : crashed ? 'Restart' : 'Open'}
          </ToolbarAction>
        )}
      </div>
    </div>
  );
}
