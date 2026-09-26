// @vitest-environment node
import {expect, it} from 'vitest';
import {agentLifecycleRequest} from './server';

it('marks bridge lifecycle calls as the agent, even if the arguments claim otherwise', () => {
  expect(agentLifecycleRequest({id: 'x', source: 'user'}, 'stop')).toEqual({
    id: 'x',
    operation: 'stop',
    source: 'agent',
  });
  expect(agentLifecycleRequest({operation: 'delete', id: 'x'}, 'get')).toMatchObject({
    operation: 'get',
  });
  expect(agentLifecycleRequest(undefined, 'list')).toEqual({operation: 'list', source: 'agent'});
});
