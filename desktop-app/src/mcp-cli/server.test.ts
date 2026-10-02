// @vitest-environment node
import {expect, it} from 'vitest';
import {agentLifecycleRequest, hiddenTools} from './server';

it('hides create_session from agents unless the bridge opts in', () => {
  expect(hiddenTools({}).has('create_session')).toBe(true);
  expect(hiddenTools({RESPONSIVELY_MCP_ALLOW_CREATE_SESSION: 'true'}).has('create_session')).toBe(
    true
  );
  expect(hiddenTools({RESPONSIVELY_MCP_ALLOW_CREATE_SESSION: '1'}).size).toBe(0);
});

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
