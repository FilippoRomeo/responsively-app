import {describe, expect, it} from 'vitest';
import {runtimeLabel, simulatorModel} from './ios-simulator';

describe('simulatorModel', () => {
  it('maps the built-in iPads to Simulator models and leaves iPhones alone', () => {
    expect(simulatorModel('iPad Pro M4')).toBe('iPad Pro 11-inch (M4)');
    expect(simulatorModel('iPad')).toBe('iPad (A16)');
    expect(simulatorModel('iPhone 12 Pro')).toBe('iPhone 12 Pro');
  });
});

describe('runtimeLabel', () => {
  it('names the runtime iPadOS for iPads', () => {
    const id = 'com.apple.CoreSimulator.SimRuntime.iOS-26-1';
    expect(runtimeLabel(id)).toBe('iOS 26.1');
    expect(runtimeLabel(id, 'iPhone 12 Pro')).toBe('iOS 26.1');
    expect(runtimeLabel(id, 'iPad Pro M4')).toBe('iPadOS 26.1');
  });
});
