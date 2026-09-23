import {act, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {expect, it, vi} from 'vitest';
import SessionsManager from './index';
import {SessionInfo} from '../../../common/sessions';
import Popover from '../Popover';

it('renders a running Session in the restricted panel renderer', async () => {
  const electron = window.electron;
  // The contextual panel preload intentionally exposes sessionsPanel only.
  Object.defineProperty(window, 'electron', {value: undefined, configurable: true});
  const item: SessionInfo = {
    id: 'f7a24040-4107-42b3-86c5-6c09ca126dbf',
    name: 'Project B',
    createdAt: '2026-09-22T20:57:15.144Z',
    updatedAt: '2026-09-22T20:57:15.977Z',
    status: 'running',
    devices: ['desktop'],
  };
  try {
    render(
      <SessionsManager request={vi.fn().mockResolvedValue([item])} onClose={vi.fn()} native />
    );
    expect(await screen.findByTestId(`session-${item.id}`)).toHaveTextContent('Project B');
  } finally {
    Object.defineProperty(window, 'electron', {value: electron, configurable: true});
  }
});

it('shows per-Session stopping state and verified feedback', async () => {
  const item: SessionInfo = {
    id: 'f7a24040-4107-42b3-86c5-6c09ca126dbf',
    name: 'Project B',
    createdAt: '2026-09-22T20:57:15.144Z',
    updatedAt: '2026-09-22T20:57:15.977Z',
    status: 'running',
  };
  let finishStop!: (value: SessionInfo) => void;
  const send = vi.fn(async (request: {operation: string}) => {
    if (request.operation === 'list') return [item];
    return new Promise<SessionInfo>((resolve) => {
      finishStop = resolve;
    });
  });
  render(<SessionsManager request={send} onClose={vi.fn()} native />);
  const stopButton = await screen.findByRole('button', {name: 'Stop'});
  stopButton.focus();
  expect(document.activeElement).toBe(stopButton);
  fireEvent.click(stopButton);
  expect(screen.getByText('Stopping…')).toBeInTheDocument();
  item.status = 'stopped';
  finishStop(item);
  expect(await screen.findByRole('status', {name: ''})).toHaveTextContent('Session stopped.');
  expect(screen.getByText('Stopped')).toBeInTheDocument();
  expect(document.activeElement).toBe(screen.getByTestId('sessions-manager'));
});

it('restores focus after deleting a stopped Session so Escape closes the popover', async () => {
  let items: SessionInfo[] = [];
  const send = vi.fn(async (request: {operation: string}) => {
    if (request.operation === 'create') {
      const item: SessionInfo = {
        id: 'f7a24040-4107-42b3-86c5-6c09ca126dbf',
        name: 'Human project',
        createdAt: '2026-09-23T00:00:00.000Z',
        updatedAt: '2026-09-23T00:00:00.000Z',
        status: 'stopped',
      };
      items = [item];
      return item;
    }
    if (request.operation === 'delete') {
      const [item] = items;
      items = [];
      return item;
    }
    return items;
  });
  render(
    <Popover trigger="Manage Sessions" keepMounted>
      {({close, open}) => <SessionsManager request={send} onClose={close} active={open} />}
    </Popover>
  );
  fireEvent.click(screen.getByRole('button', {name: 'Manage Sessions'}));
  fireEvent.click(await screen.findByRole('button', {name: 'New Session'}));
  fireEvent.change(screen.getByRole('textbox', {name: 'Name'}), {
    target: {value: 'Human project'},
  });
  fireEvent.click(screen.getByRole('checkbox', {name: 'Open immediately'}));
  fireEvent.click(screen.getByRole('button', {name: 'Save'}));
  const row = await screen.findByTestId(`session-f7a24040-4107-42b3-86c5-6c09ca126dbf`);
  const deleteButton = within(row).getByRole('button', {name: 'Delete'});
  await waitFor(() => expect(deleteButton).toBeEnabled());
  fireEvent.click(deleteButton);
  const confirm = screen.getByRole('button', {name: 'Delete Session'});
  confirm.focus();
  expect(document.activeElement).toBe(confirm);
  fireEvent.click(confirm);
  await waitFor(() => expect(screen.queryByRole('button', {name: 'Delete Session'})).toBeNull());
  const manager = screen.getByTestId('sessions-manager');
  expect(document.activeElement).toBe(manager);
  fireEvent.keyDown(document.activeElement!, {key: 'Escape'});
  await waitFor(() => expect(manager).not.toBeVisible());
});

const staleCases: {
  operation: string;
  before: SessionInfo[];
  after: SessionInfo[];
  act: () => void;
  expectFresh: () => void;
}[] = (() => {
  const base = {
    id: 'f7a24040-4107-42b3-86c5-6c09ca126dbf',
    createdAt: '2026-09-23T00:00:00.000Z',
    updatedAt: '2026-09-23T00:00:00.000Z',
  };
  const old: SessionInfo = {...base, name: 'Old project', status: 'stopped'};
  const row = () => screen.queryByTestId(`session-${base.id}`);
  return [
    {
      operation: 'delete',
      before: [old],
      after: [],
      act: () => {
        fireEvent.click(screen.getByRole('button', {name: 'Delete'}));
        fireEvent.click(screen.getByRole('button', {name: 'Delete Session'}));
      },
      expectFresh: () => expect(row()).toBeNull(),
    },
    {
      operation: 'rename',
      before: [old],
      after: [{...old, name: 'New project'}],
      act: () => {
        fireEvent.click(screen.getByRole('button', {name: 'Rename'}));
        fireEvent.change(screen.getByRole('textbox', {name: 'Name'}), {
          target: {value: 'New project'},
        });
        fireEvent.click(screen.getByRole('button', {name: 'Save'}));
      },
      expectFresh: () => expect(row()).toHaveTextContent('New project'),
    },
    {
      operation: 'stop',
      before: [{...old, status: 'running'}],
      after: [old],
      act: () => fireEvent.click(screen.getByRole('button', {name: 'Stop'})),
      expectFresh: () => expect(row()).toHaveTextContent('Stopped'),
    },
    {
      operation: 'create',
      before: [],
      after: [old],
      act: () => {
        fireEvent.click(screen.getByRole('button', {name: 'New Session'}));
        fireEvent.change(screen.getByRole('textbox', {name: 'Name'}), {
          target: {value: 'Old project'},
        });
        fireEvent.click(screen.getByRole('checkbox', {name: 'Open immediately'}));
        fireEvent.click(screen.getByRole('button', {name: 'Save'}));
      },
      expectFresh: () => expect(row()).toHaveTextContent('Old project'),
    },
  ];
})();

it.each(staleCases)(
  'never lets a refresh started before $operation overwrite its result',
  async ({before, after, act: mutate, expectFresh}) => {
    vi.useFakeTimers({shouldAdvanceTime: true});
    try {
      const lists: ((value: SessionInfo[]) => void)[] = [];
      let finish!: (value: SessionInfo) => void;
      const send = vi.fn(
        (request: {operation: string}) =>
          new Promise<SessionInfo | SessionInfo[]>((resolve) => {
            if (request.operation === 'list') lists.push(resolve);
            else finish = resolve;
          })
      );
      render(<SessionsManager request={send} onClose={vi.fn()} native />);
      await act(async () => lists[0](before));
      await screen.findByRole('heading', {name: 'Sessions'});
      mutate();
      // The periodic refresh starts while the change is in flight and captures old state.
      await act(async () => vi.advanceTimersByTime(2000));
      expect(lists).toHaveLength(2);
      await act(async () => finish(after[0] ?? before[0]));
      await act(async () => lists[2]?.(after));
      await act(async () => lists[1](before));
      expectFresh();
    } finally {
      vi.useRealTimers();
    }
  }
);

it('resets a stopped Session only after confirmation and keeps it listed', async () => {
  const item: SessionInfo = {
    id: 'f7a24040-4107-42b3-86c5-6c09ca126dbf',
    name: 'Keep me',
    createdAt: '2026-09-23T00:00:00.000Z',
    updatedAt: '2026-09-23T00:00:00.000Z',
    status: 'stopped',
  };
  const send = vi.fn(async (request: {operation: string}) =>
    request.operation === 'list' ? [item] : item
  );
  render(<SessionsManager request={send} onClose={vi.fn()} native />);
  fireEvent.click(await screen.findByRole('button', {name: 'Reset'}));
  expect(screen.getByRole('heading', {name: 'Reset “Keep me”?'})).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', {name: 'Cancel'}));
  expect(send).not.toHaveBeenCalledWith(expect.objectContaining({operation: 'reset'}));
  fireEvent.click(await screen.findByRole('button', {name: 'Reset'}));
  fireEvent.click(screen.getByRole('button', {name: 'Reset Data'}));
  expect(await screen.findByRole('status', {name: ''})).toHaveTextContent(
    'Session data moved to Trash.'
  );
  expect(send).toHaveBeenCalledWith({operation: 'reset', id: item.id, confirmed: true});
  expect(screen.getByTestId(`session-${item.id}`)).toHaveTextContent('Keep me');
  expect(document.activeElement).toBe(screen.getByTestId('sessions-manager'));
});
