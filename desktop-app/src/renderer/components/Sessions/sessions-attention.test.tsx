import {fireEvent, render, screen, within} from '@testing-library/react';
import {expect, it, vi} from 'vitest';
import SessionsManager from './index';
import {SessionInfo, SessionRequest} from '../../../common/sessions';

const ID = 'f7a24040-4107-42b3-86c5-6c09ca126dbf';
const base: SessionInfo = {
  id: ID,
  name: 'Shop',
  createdAt: '2026-09-26T10:00:00.000Z',
  updatedAt: '2026-09-26T10:00:00.000Z',
  status: 'stopped',
};

const renderAttention = (item: SessionInfo) => {
  const send = vi.fn(async (request: SessionRequest) =>
    request.operation === 'list' ? [item] : {...item, status: 'running' as const}
  );
  const onClose = vi.fn();
  render(<SessionsManager request={send} onClose={onClose} native initialAttention={ID} />);
  return {send, onClose};
};

const view = async () => within(await screen.findByTestId('session-attention'));

it('explains a stopped Session with who stopped it, and offers Open, Reset and Delete', async () => {
  renderAttention({...base, lastStop: {by: 'agent', at: '2026-09-26T10:05:00.000Z'}});
  const v = await view();
  expect(await v.findByRole('heading', {name: '“Shop” needs attention'})).toBeInTheDocument();
  expect(v.getByRole('alert')).toHaveTextContent('It is stopped. Stopped by an agent');
  expect(v.getByRole('button', {name: 'Open'})).toBeInTheDocument();
  expect(v.getByRole('button', {name: 'Reset…'})).toBeInTheDocument();
  expect(v.getByRole('button', {name: 'Delete…'})).toBeInTheDocument();
  expect(v.queryByRole('button', {name: 'Force Quit…'})).not.toBeInTheDocument();
});

it('offers Restart, not Reset or Delete, after a crash', async () => {
  renderAttention({
    ...base,
    status: 'error',
    error: 'Session process exited unexpectedly. Open to restart it.',
    lastStop: {by: 'crash', at: '2026-09-26T10:05:00.000Z'},
  });
  const v = await view();
  expect(await v.findByText(/Its process exited unexpectedly/)).toBeInTheDocument();
  expect(v.getByRole('button', {name: 'Restart'})).toBeInTheDocument();
  expect(v.queryByRole('button', {name: 'Reset…'})).not.toBeInTheDocument();
  expect(v.queryByRole('button', {name: 'Force Quit…'})).not.toBeInTheDocument();
});

it('force quits a hung Session only after a second, explicit step', async () => {
  const {send} = renderAttention({
    ...base,
    status: 'error',
    hung: true,
    error: 'Runtime is not responding.',
  });
  const v = await view();
  expect(v.queryByRole('button', {name: 'Restart'})).not.toBeInTheDocument();
  fireEvent.click(await v.findByRole('button', {name: 'Force Quit…'}));
  const warning = await view();
  expect(warning.getByRole('heading', {name: 'Force quit “Shop”?'})).toBeInTheDocument();
  expect(send).not.toHaveBeenCalledWith(expect.objectContaining({operation: 'force-stop'}));
  fireEvent.click(warning.getByRole('button', {name: 'Force Quit'}));
  expect(send).toHaveBeenCalledWith({operation: 'force-stop', id: ID, confirmed: true});
});

it('opens a stopped Session from the dialog', async () => {
  const {send} = renderAttention(base);
  fireEvent.click(await (await view()).findByRole('button', {name: 'Open'}));
  expect(send).toHaveBeenCalledWith({operation: 'open', id: ID});
});

it('dismiss closes the dialog without changing the Session', async () => {
  const {send, onClose} = renderAttention(base);
  fireEvent.click(await (await view()).findByRole('button', {name: 'Dismiss'}));
  expect(onClose).toHaveBeenCalled();
  expect(send.mock.calls.every(([request]) => request.operation === 'list')).toBe(true);
});
