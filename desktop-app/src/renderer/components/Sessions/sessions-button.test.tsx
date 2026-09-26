import {act, render, screen, waitFor} from '@testing-library/react';
import {useState} from 'react';
import {afterEach, expect, it, vi} from 'vitest';
import {IPC_MAIN_CHANNELS} from 'common/constants';
import {SessionsButton, useSessionsShowRequest} from './index';

type Handler = (...args: unknown[]) => void;

const mockIpc = (sessionName: string | undefined) => {
  const handlers = new Map<string, Handler>();
  const ipc = window.electron.ipcRenderer;
  vi.mocked(ipc.on).mockImplementation(((channel: string, handler: Handler) => {
    handlers.set(channel, handler);
    return () => handlers.delete(channel);
  }) as never);
  vi.mocked(ipc.invoke).mockImplementation((async (channel: string) => {
    if (channel === IPC_MAIN_CHANNELS.SESSION_CONTEXT) return {name: sessionName};
    if (channel === IPC_MAIN_CHANNELS.SESSIONS_REQUEST) return [];
    return undefined;
  }) as never);
  return handlers;
};

/** The same wiring as AppContent's Browser: the hook above a toolbar that may be unmounted. */
const Browser = ({
  toolbar = true,
  presenting = false,
}: {
  toolbar?: boolean;
  presenting?: boolean;
}) => {
  const [isPresenting, setPresenting] = useState(presenting);
  const [request, shown] = useSessionsShowRequest(() => setPresenting(false));
  if (!toolbar || isPresenting) return <p>no toolbar</p>;
  return <SessionsButton showRequest={request} onShown={shown} />;
};

const show = (handlers: Map<string, Handler>, create: boolean) =>
  act(() => handlers.get(IPC_MAIN_CHANNELS.SESSIONS_SHOW)?.({create, error: ''}));

afterEach(() => {
  vi.mocked(window.electron.ipcRenderer.on).mockReset();
  vi.mocked(window.electron.ipcRenderer.invoke).mockReset();
});

it('names the Session this window belongs to', async () => {
  mockIpc('Shop');
  render(<Browser />);
  expect(await screen.findByTestId('sessions-button-label')).toHaveTextContent('Shop');
});

it('keeps the generic label outside a Session', async () => {
  mockIpc(undefined);
  render(<Browser />);
  await waitFor(() =>
    expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
      IPC_MAIN_CHANNELS.SESSION_CONTEXT
    )
  );
  expect(screen.getByTestId('sessions-button-label')).toHaveTextContent('Sessions');
});

it('opens the in-window manager in create mode when the main process asks', async () => {
  const handlers = mockIpc('Shop');
  render(<Browser />);
  await screen.findByText('Shop');
  expect(screen.queryByRole('heading', {name: 'New Session'})).not.toBeInTheDocument();
  show(handlers, true);
  expect(await screen.findByRole('heading', {name: 'New Session'})).toBeInTheDocument();
});

it('leaves presentation mode so the request reaches the toolbar manager', async () => {
  const handlers = mockIpc('Shop');
  render(<Browser presenting />);
  expect(screen.getByText('no toolbar')).toBeInTheDocument();
  show(handlers, true);
  expect(await screen.findByRole('heading', {name: 'New Session'})).toBeInTheDocument();
});

it('does not replay a shown request when the toolbar mounts again', async () => {
  const handlers = mockIpc('Shop');
  const view = render(<Browser />);
  await screen.findByText('Shop');
  show(handlers, true);
  expect(await screen.findByRole('heading', {name: 'New Session'})).toBeInTheDocument();
  view.rerender(<Browser toolbar={false} />);
  view.rerender(<Browser />);
  await screen.findByText('Shop');
  expect(screen.queryByRole('heading', {name: 'New Session'})).not.toBeInTheDocument();
});

it('updates the label when the Session is renamed', async () => {
  const handlers = mockIpc('Shop');
  render(<Browser />);
  await screen.findByText('Shop');
  vi.mocked(window.electron.ipcRenderer.invoke).mockImplementation((async (channel: string) =>
    channel === IPC_MAIN_CHANNELS.SESSION_CONTEXT ? {name: 'Shop v2'} : []) as never);
  act(() => handlers.get(IPC_MAIN_CHANNELS.SESSION_RENAMED)?.('Shop v2'));
  expect(await screen.findByText('Shop v2')).toBeInTheDocument();
});
