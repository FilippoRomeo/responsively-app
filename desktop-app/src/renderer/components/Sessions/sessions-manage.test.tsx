import {fireEvent, render, screen} from '@testing-library/react';
import {expect, it, vi} from 'vitest';
import SessionsManager, {SessionsShowRequest} from './index';
import {SessionInfo, SessionRequest} from '../../../common/sessions';

const item: SessionInfo = {
  id: 'f7a24040-4107-42b3-86c5-6c09ca126dbf',
  name: 'Shop',
  createdAt: '2026-09-26T10:00:00.000Z',
  updatedAt: '2026-09-26T10:00:00.000Z',
  status: 'stopped',
};

// The menu-bar panel is hidden, not closed, so it keeps whatever it last showed.
it('Manage Sessions returns a panel left in the New Session form to the list, keeping the draft', async () => {
  const send = vi.fn(async (_request: SessionRequest) => [item]);
  const show = (request: SessionsShowRequest) => (
    <SessionsManager request={send} onClose={() => {}} native showRequest={request} />
  );
  const {rerender} = render(show({create: true, error: ''}));
  fireEvent.change(await screen.findByLabelText('Name'), {target: {value: 'Half typed'}});

  rerender(show({create: false, error: ''}));
  expect(await screen.findByText('Shop')).toBeInTheDocument();
  expect(screen.queryByRole('heading', {name: 'New Session'})).not.toBeInTheDocument();

  rerender(show({create: true, error: ''}));
  expect(await screen.findByLabelText('Name')).toHaveValue('Half typed');
});
