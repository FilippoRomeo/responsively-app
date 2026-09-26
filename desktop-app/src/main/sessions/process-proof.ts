import {execFileSync} from 'child_process';

export interface ProcessFacts {
  startedAt: Date;
  executable: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Parses macOS `ps -o lstart= -o comm= -p PID`: a fixed-width local start time
 * ("Sat Sep 26 15:22:08 2026", 24 characters), then the executable path.
 */
export const parsePs = (output: string): ProcessFacts | null => {
  const line = output.trim();
  const match = /^\w{3} (\w{3}) +(\d{1,2}) (\d{2}):(\d{2}):(\d{2}) (\d{4}) +(.+)$/.exec(line);
  if (!match) return null;
  const [, month, day, hours, minutes, seconds, year, executable] = match;
  const monthIndex = MONTHS.indexOf(month);
  if (monthIndex < 0) return null;
  const startedAt = new Date(
    Number(year),
    monthIndex,
    Number(day),
    Number(hours),
    Number(minutes),
    Number(seconds)
  );
  return Number.isNaN(startedAt.getTime()) ? null : {startedAt, executable: executable.trim()};
};

/** Reads a live process's start time and executable; null when it cannot be proven. */
export const readProcess = (
  pid: number,
  platform: NodeJS.Platform = process.platform,
  run: (file: string, args: string[]) => string = (file, args) =>
    execFileSync(file, args, {encoding: 'utf8', timeout: 3000})
): ProcessFacts | null => {
  // Only macOS ps output is known and parsed; elsewhere nothing is proven.
  if (platform !== 'darwin' || !Number.isInteger(pid) || pid < 1) return null;
  try {
    return parsePs(run('/bin/ps', ['-o', 'lstart=', '-o', 'comm=', '-p', String(pid)]));
  } catch {
    return null;
  }
};

/** ps reports whole seconds; the lease is written just after spawn returns. */
const START_TOLERANCE_MS = 10_000;

/**
 * A persisted PID never authorizes a kill by itself: it may have been reused.
 * The process must also have started when the lease says, from the app binary.
 */
export const provesRuntime = (
  lease: {startedAt: string},
  facts: ProcessFacts | null,
  expectedExecutable: string
): {ok: true} | {ok: false; reason: string} => {
  if (!facts)
    return {ok: false, reason: "the process's start time and executable could not be read"};
  const leased = Date.parse(lease.startedAt);
  if (Number.isNaN(leased)) return {ok: false, reason: 'the runtime lease has no valid start time'};
  if (Math.abs(facts.startedAt.getTime() - leased) > START_TOLERANCE_MS)
    return {ok: false, reason: 'the process started at a different time than this Session'};
  if (facts.executable !== expectedExecutable)
    return {ok: false, reason: 'the process runs a different program than Responsively'};
  return {ok: true};
};
