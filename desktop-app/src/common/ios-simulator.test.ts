import {describe, expect, it} from 'vitest';
import {simulatorModel} from './ios-simulator';

describe('simulatorModel', () => {
  it('maps the built-in iPads to Simulator models and leaves iPhones alone', () => {
    expect(simulatorModel('iPad Pro M4')).toBe('iPad Pro 11-inch (M4)');
    expect(simulatorModel('iPad')).toBe('iPad (A16)');
    expect(simulatorModel('iPhone 12 Pro')).toBe('iPhone 12 Pro');
  });
});
