// @vitest-environment node
import {describe, expect, it} from 'vitest';
import {processRole} from './process-role';

describe('processRole', () => {
  it('is shell for a plain launch', () => {
    expect(processRole({})).toBe('shell');
  });
  it('is session when a Session ID is present', () => {
    expect(processRole({RESPONSIVELY_SESSION_ID: 'f7a24040-4107-42b3-86c5-6c09ca126dbf'})).toBe(
      'session'
    );
  });
  it('is controller only for the exact value "true", and wins over a Session ID', () => {
    expect(processRole({RESPONSIVELY_SESSION_CONTROLLER: 'true'})).toBe('controller');
    expect(
      processRole({RESPONSIVELY_SESSION_CONTROLLER: 'true', RESPONSIVELY_SESSION_ID: 'x'})
    ).toBe('controller');
    expect(processRole({RESPONSIVELY_SESSION_CONTROLLER: 'false'})).toBe('shell');
    expect(processRole({RESPONSIVELY_SESSION_CONTROLLER: ''})).toBe('shell');
  });
});
