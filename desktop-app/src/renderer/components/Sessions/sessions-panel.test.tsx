import {fireEvent, render, screen} from '@testing-library/react';
import {expect, it, vi} from 'vitest';
import SessionsManager from './index';
import {SessionInfo} from '../../../common/sessions';

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
  fireEvent.click(await screen.findByRole('button', {name: 'Stop'}));
  expect(screen.getByText('Stopping…')).toBeInTheDocument();
  item.status = 'stopped';
  finishStop(item);
  expect(await screen.findByRole('status', {name: ''})).toHaveTextContent('Session stopped.');
  expect(screen.getByText('Stopped')).toBeInTheDocument();
});
