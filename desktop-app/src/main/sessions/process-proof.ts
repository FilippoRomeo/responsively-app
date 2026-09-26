import {execFileSync} from 'child_process';

export interface ProcessFacts {
  startedAt: Date;
  executable: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Parses macOS `ps -o lstart= -o comm= -p PID`: a local start time, then the
 * executable path. The C locale prints "Sat Sep 26 15:22:08 2026"; locales such
 * as en_GB print the day first ("Sat 26 Sep 15:22:08 2026"), so both are read.
 */
export const parsePs = (output: string): ProcessFacts | null => {
  const line = output.trim();
  const match =
    /^\w{3} (?:(\w{3}) +(\d{1,2})|(\d{1,2}) (\w{3})) (\d{2}):(\d{2}):(\d{2}) (\d{4}) +(.+)$/.exec(
      line
    );
  if (!match) return null;
  const [, monthFirst, dayAfter, dayFirst, monthAfter, hours, minutes, seconds, year, executable] =
    match;
  const month = monthFirst ?? monthAfter;
  const day = dayAfter ?? dayFirst;
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
    // ps formats lstart with the user's locale; C gives the same text everywhere.
    execFileSync(file, args, {encoding: 'utf8', timeout: 3000, env: {...process.env, LC_ALL: 'C'}})
): ProcessFacts | null => {
  // Only macOS ps output is known and parsed; elsewhere nothing is proven.
  if (platform !== 'darwin' || !Number.isInteger(pid) || pid < 1) return null;
  try {
    // -ww: never cut the executable path at a terminal width.
    return parsePs(run('/bin/ps', ['-ww', '-o', 'lstart=', '-o', 'comm=', '-p', String(pid)]));
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
