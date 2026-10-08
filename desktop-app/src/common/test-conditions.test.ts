import {describe, expect, it} from 'vitest';
import {
  clampCpu,
  describeConditions,
  expandMatrix,
  isNoConditions,
  MAX_TEST_CELLS,
  NETWORK_PRESETS,
  networkToCdp,
  NO_CONDITIONS,
} from './test-conditions';
import {renderReportMarkdown, type TestReport} from './test-report';

describe('test conditions', () => {
  it('turns presets into the debugger parameters, in bytes per second', () => {
    expect(networkToCdp('none')).toEqual({
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });
    expect(networkToCdp('3g-fast')).toEqual({
      offline: false,
      latency: 150,
      downloadThroughput: 200_000,
      uploadThroughput: 93_750,
    });
    expect(networkToCdp('offline').offline).toBe(true);
    expect(Object.keys(NETWORK_PRESETS)).toContain('5g');
  });

  it('keeps the CPU slowdown in range and names conditions briefly', () => {
    expect(clampCpu(0)).toBe(1);
    expect(clampCpu(3.6)).toBe(4);
    expect(clampCpu(500)).toBe(20);
    expect(isNoConditions(NO_CONDITIONS)).toBe(true);
    expect(describeConditions(NO_CONDITIONS)).toBe('No conditions');
    expect(describeConditions({network: '4g', cpu: 4, scheme: 'dark'})).toBe('4G · CPU ×4 · dark');
  });

  it('expands every combination in a stable order and drops repeats', () => {
    const cells = expandMatrix({
      pages: ['http://a/', 'http://a/'],
      devices: ['Phone', 'Laptop'],
      networks: ['4g', 'offline'],
      cpus: [1, 4],
      schemes: [null],
    });
    expect(cells).toHaveLength(8);
    expect(cells.map((c) => c.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(cells[0]).toMatchObject({device: 'Phone', conditions: {network: '4g', cpu: 1}});
    expect(cells[1].conditions).toMatchObject({network: '4g', cpu: 4});
    expect(cells[4].device).toBe('Laptop');
  });

  it('refuses an empty or oversized run with a message that says what to do', () => {
    expect(() =>
      expandMatrix({pages: [], devices: ['x'], networks: ['4g'], cpus: [1], schemes: [null]})
    ).toThrow(/Nothing to test/);
    expect(() =>
      expandMatrix({
        pages: ['a', 'b', 'c', 'd'],
        devices: ['1', '2', '3', '4'],
        networks: ['4g', '5g', 'wifi', 'offline'],
        cpus: [1, 2],
        schemes: [null],
      })
    ).toThrow(new RegExp(`limit is ${MAX_TEST_CELLS}`));
  });
});

describe('test report', () => {
  const report: TestReport = {
    id: '20261008-120000-ab12',
    createdAt: '2026-10-08T12:00:00Z',
    finishedAt: '2026-10-08T12:01:00Z',
    status: 'complete',
    startedBy: 'agent',
    skipped: [{device: 'iPhone 13', reason: 'real iOS Safari: screenshot only'}],
    request: {
      pages: ['http://a/'],
      devices: ['Phone'],
      networks: ['4g'],
      cpus: [1],
      schemes: [null],
    },
    cells: [
      {
        index: 0,
        device: {name: 'Phone | one', width: 390, height: 844},
        page: 'http://a/',
        finalUrl: 'http://a/',
        conditions: {network: '4g', cpu: 1, scheme: null},
        loaded: true,
        timings: {ttfbMs: 12, domContentLoadedMs: 80, loadMs: 1234.4, lcpMs: 900, cls: 0.1234},
        transfer: {
          requests: 5,
          bytes: 1_642_000,
          failed: [{url: 'http://a/x.png', error: 'net::ERR_FAILED'}],
        },
        cpu: {scriptMs: 70, taskMs: 90},
        memory: {jsHeapMB: 4.8},
        console: {errors: 1, warnings: 0, messages: ['error: boom']},
        layout: {horizontalOverflow: true, scrollWidth: 500, viewportWidth: 390},
      },
    ],
  };

  it('renders a table and the problems, with cell text kept on one row', () => {
    const md = renderReportMarkdown(report);
    expect(md).toContain('# Test report 20261008-120000-ab12');
    expect(md).toContain('Phone \\| one');
    expect(md).toContain('1234 ms');
    expect(md).toContain('1.6 MB');
    expect(md).toContain('0.123');
    expect(md).toContain('| 2 | yes |');
    expect(md).toContain('failed request: http://a/x.png (net::ERR_FAILED)');
    expect(md).toContain('console: error: boom');
    expect(md).toContain('iPhone 13: real iOS Safari: screenshot only');
  });
});
