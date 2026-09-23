import fs from 'fs';
import path from 'path';
import {randomUUID} from 'crypto';
import {z} from 'zod';
import {SessionDefinition} from '../../common/sessions';

export const sessionId = z.string().uuid();
export const sessionName = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine(
    (s) => !Array.from(s).some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127),
    'Name must not contain control characters'
  );
const definition = z.object({
  id: sessionId,
  name: sessionName,
  createdAt: z.string(),
  updatedAt: z.string(),
  lastOpenedAt: z.string().optional(),
  lastUrl: z.string().optional(),
});
export const requestSchema = z
  .object({
    operation: z.enum(['list', 'get', 'create', 'rename', 'open', 'focus', 'stop', 'delete']),
    id: sessionId.optional(),
    name: sessionName.optional(),
    url: z.string().max(8192).optional(),
    open: z.boolean().optional(),
    confirmed: z.boolean().optional(),
  })
  .strict();

export const atomicWrite = (file: string, value: unknown) => {
  fs.mkdirSync(path.dirname(file), {recursive: true, mode: 0o700});
  const tmp = `${file}.${randomUUID()}.tmp`;
  const fd = fs.openSync(tmp, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify(value, null, 2));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
};

/** Sole writer is the controller process, protected by its Electron instance lock. */
export class SessionRegistry {
  private definitions: SessionDefinition[];
  private file: string;
  constructor(readonly root: string) {
    fs.mkdirSync(root, {recursive: true, mode: 0o700});
    this.file = path.join(root, 'sessions-registry.json');
    // Corrupt data is never silently replaced by an empty registry.
    const saved = fs.existsSync(this.file)
      ? JSON.parse(fs.readFileSync(this.file, 'utf8'))
      : {version: 1, sessions: []};
    this.definitions = z
      .object({version: z.literal(1), sessions: z.array(definition)})
      .parse(saved).sessions;
    if (new Set(this.definitions.map((s) => s.id)).size !== this.definitions.length)
      throw new Error('Duplicate session IDs in registry');
  }
  list() {
    return this.definitions.map((s) => ({...s}));
  }
  get(id: string) {
    sessionId.parse(id);
    const found = this.definitions.find((s) => s.id === id);
    if (!found) throw new Error('Session not found');
    return {...found};
  }
  private save(next: SessionDefinition[]) {
    atomicWrite(this.file, {version: 1, sessions: next});
    this.definitions = next;
  }
  private uniqueName(name: string, exceptId?: string) {
    const parsed = sessionName.parse(name);
    if (this.definitions.some((s) => s.id !== exceptId && s.name === parsed))
      throw new Error(`A Session named “${parsed}” already exists.`);
    return parsed;
  }
  create(name: string, lastUrl?: string) {
    const now = new Date().toISOString();
    const item = {
      id: randomUUID(),
      name: this.uniqueName(name),
      createdAt: now,
      updatedAt: now,
      lastUrl,
    };
    this.save([...this.definitions, item]);
    return item;
  }
  update(
    id: string,
    values: Partial<Pick<SessionDefinition, 'name' | 'lastOpenedAt' | 'lastUrl'>>
  ) {
    const item = definition.parse({
      ...this.get(id),
      ...values,
      ...(values.name === undefined ? {} : {name: this.uniqueName(values.name, id)}),
      updatedAt: new Date().toISOString(),
    });
    this.save(this.definitions.map((s) => (s.id === id ? item : s)));
    return item;
  }
  remove(id: string) {
    this.get(id);
    this.save(this.definitions.filter((s) => s.id !== id));
  }
  dataDir(id: string) {
    sessionId.parse(id);
    const profiles = path.join(this.root, 'profiles');
    const dir = path.join(profiles, id);
    for (const p of [this.root, profiles, dir]) {
      if (fs.existsSync(p) && fs.lstatSync(p).isSymbolicLink())
        throw new Error('Session directories must not be symbolic links');
    }
    return dir;
  }
}
