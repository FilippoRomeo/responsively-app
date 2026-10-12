/** What an agent sends the sandbox, made safe to run: quoting, the workspace boundary, output limits. */
export const MAX_COMMAND_CHARS = 8000;
export const DEFAULT_TIMEOUT_S = 60;
export const MAX_TIMEOUT_S = 600;
export const MAX_OUTPUT_BYTES = 32_000;
export const MAX_READ_BYTES = 200_000;
export const MAX_WRITE_BYTES = 1_000_000;

/** One shell word, whatever it contains. */
export const shellQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

export const clampTimeout = (seconds: unknown): number => {
  const n = Math.floor(Number(seconds));
  return Number.isFinite(n) && n > 0 ? Math.min(n, MAX_TIMEOUT_S) : DEFAULT_TIMEOUT_S;
};

/** The last `limit` bytes of output (what a failed build says is at the end). */
export const tailOutput = (text: string, limit = MAX_OUTPUT_BYTES) =>
  text.length > limit
    ? {text: text.slice(text.length - limit), truncated: true}
    : {text, truncated: false};

/**
 * A path as the agent wrote it, relative to the sandbox workspace. Refuses what
 * cannot be a plain workspace path; the machine then resolves it again (symlinks
 * included) and refuses anything that lands outside the workspace.
 */
export const workspacePath = (input: unknown): string => {
  if (typeof input !== 'string' || input.trim() === '') throw new Error('Give a file path.');
  if (input.length > 500 || input.includes('\0') || input.includes('\n'))
    throw new Error('That is not a usable file path.');
  if (input.startsWith('/') || input.startsWith('~'))
    throw new Error('Use a path relative to the workspace, for example src/app.ts.');
  const parts: string[] = [];
  for (const part of input.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (parts.length === 0) throw new Error('Paths stay inside the sandbox workspace.');
      parts.pop();
    } else parts.push(part);
  }
  if (parts.length === 0) throw new Error('Give a file path inside the workspace.');
  return parts.join('/');
};

/** The remote script that reads a workspace file, refusing anything resolved outside it. */
export const readScript = (rel: string) =>
  `w="$HOME/workspace"; p=$(realpath -m -- "$w"/${shellQuote(rel)}); ` +
  `case "$p" in "$w"/*) [ -f "$p" ] || { echo "No such file: ${rel.replace(/["$`\\]/g, '')}" >&2; exit 4; }; ` +
  `[ "$(stat -c %s -- "$p")" -le ${MAX_READ_BYTES} ] || { echo "File is larger than ${MAX_READ_BYTES} bytes" >&2; exit 5; }; cat -- "$p";; ` +
  `*) echo "Outside the workspace" >&2; exit 3;; esac`;

/** The remote script that writes stdin to a workspace file. */
export const writeScript = (rel: string) =>
  `w="$HOME/workspace"; mkdir -p "$w"; p=$(realpath -m -- "$w"/${shellQuote(rel)}); ` +
  `case "$p" in "$w"/*) mkdir -p -- "$(dirname -- "$p")" && cat > "$p";; ` +
  `*) echo "Outside the workspace" >&2; exit 3;; esac`;

/**
 * The script a command runs as: in the workspace (or a folder in it), in its own process
 * group, and when the time is up the whole group is killed (a build's children included),
 * so the call returns on time with exit status 137.
 */
export const commandScript = (command: string, cwd: string | undefined, timeoutS: number) => {
  const dir = cwd ? workspacePath(cwd) : '';
  const cd = dir
    ? `cd -- "$(realpath -m -- "$w"/${shellQuote(dir)})" 2>/dev/null || { echo "No such folder: ${dir.replace(/["$`\\]/g, '')}" >&2; exit 4; }; `
    : 'cd "$w"; ';
  return (
    `w="$HOME/workspace"; mkdir -p "$w"; ${cd}` +
    `setsid bash -l -c ${shellQuote(command)} & pid=$!; ` +
    // The timer holds no output of the call, so the call returns the moment the command does.
    `( sleep ${timeoutS}; kill -KILL -- -"$pid" ) >/dev/null 2>&1 </dev/null & killer=$!; ` +
    `wait "$pid"; code=$?; kill "$killer" 2>/dev/null; exit "$code"`
  );
};
