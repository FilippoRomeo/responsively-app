import {fireEvent, render, screen, waitFor, within} from '@testing-library/react';
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
