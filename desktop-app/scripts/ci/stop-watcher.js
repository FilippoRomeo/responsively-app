/* eslint-disable */
// CI instrumentation (throwaway branch, never merged): a read-only observer of
// Session runtime stops during e2e. Never signals any process.
// Usage: node scripts/ci/stop-watcher.js <outDir>   (stop with SIGTERM; writes a summary)
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const {execFile, spawn} = require('child_process');

const OUT = path.resolve(process.argv[2]);
fs.mkdirSync(path.join(OUT, 'samples'), {recursive: true});
fs.mkdirSync(path.join(OUT, 'logs'), {recursive: true});
const TMP = os.tmpdir();
const preexisting = new Set(fs.readdirSync(TMP).filter((n) => n.startsWith('responsively-e2e-')));
const events = fs.createWriteStream(path.join(OUT, 'events.jsonl'));
const psOut = fs.createWriteStream(path.join(OUT, 'ps.jsonl'));
const loadOut = fs.createWriteStream(path.join(OUT, 'load.jsonl'));
const ev = (o) => events.write(JSON.stringify({t: Date.now(), ...o}) + '\n');
ev({type: 'start', tmp: TMP, preexisting: [...preexisting]});

const runtimes = new Map(); // key root|id|pid
const controllers = new Map(); // key root|pid
let lastPs = new Map();

const alive = (pid) => {
  try {
    process.kill(pid, 0); // signal 0: existence check only
    return true;
  } catch (e) {
    return e.code !== 'ESRCH';
  }
};
const probe = (port) =>
  new Promise((resolve) => {
    const s = net.connect({host: '127.0.0.1', port});
    const done = (r) => {
      s.destroy();
      resolve(r);
    };
    s.setTimeout(500, () => done('timeout'));
    s.once('connect', () => done('open'));
    s.once('error', (e) => done(e.code === 'ECONNREFUSED' ? 'refused' : e.code));
  });
const roots = () =>
  fs
    .readdirSync(TMP)
    .filter((n) => n.startsWith('responsively-e2e-') && !preexisting.has(n))
    .map((n) => path.join(TMP, n));

const mark = (r, field, extra = {}) => {
  if (r[field]) return;
  r[field] = Date.now();
  ev({type: field, id: r.id, pid: r.pid, root: path.basename(r.root), ...extra});
};

const tick = async () => {
  for (const root of roots()) {
    const sroot = path.join(root, 'session-test-root');
    const dir = path.join(sroot, 'runtimes');
    let files = [];
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    } catch {}
    for (const f of files) {
      let lease;
      try {
        lease = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      } catch {
        continue;
      }
      const key = `${root}|${lease.id}|${lease.pid}`;
      let r = runtimes.get(key);
      if (!r) {
        r = {id: lease.id, pid: lease.pid, root, file: path.join(dir, f), port: 0};
        runtimes.set(key, r);
        mark(r, 'lease_seen');
      }
      if (lease.port > 0) r.port = lease.port;
    }
    try {
      const c = JSON.parse(fs.readFileSync(path.join(sroot, 'controller.json'), 'utf8'));
      const key = `${root}|${c.pid}`;
      if (!controllers.has(key)) {
        controllers.set(key, {pid: c.pid, root});
        ev({type: 'controller_seen', pid: c.pid, root: path.basename(root)});
      }
    } catch {}
  }
  await Promise.all(
    [...runtimes.values()]
      .filter((r) => !r.done)
      .map(async (r) => {
        const isAlive = alive(r.pid);
        let leasePid;
        try {
          leasePid = JSON.parse(fs.readFileSync(r.file, 'utf8')).pid;
        } catch {}
        if (leasePid !== r.pid)
          mark(r, 'lease_removed', {rootGone: !fs.existsSync(r.root)});
        if (r.port > 0 && !r.port_closed && !r.probing) {
          r.probing = true;
          const res = await probe(r.port);
          r.probing = false;
          if (res === 'open') mark(r, 'port_open', {port: r.port});
          else if (r.port_open) mark(r, 'port_closed', {port: r.port, result: res});
        }
        if (!isAlive) mark(r, 'exited');
        if (r.port_closed && isAlive && !r.sampled && Date.now() - r.port_closed > 3000) {
          r.sampled = true;
          const file = path.join(OUT, 'samples', `${r.id}-${r.pid}.txt`);
          ev({type: 'sample_start', id: r.id, pid: r.pid, file});
          snapshotTree(r.pid, `${r.id}-${r.pid}`);
          spawn('sample', [String(r.pid), '2', '-file', file], {stdio: 'ignore'}).on('exit', (code) =>
            ev({type: 'sample_done', id: r.id, pid: r.pid, code})
          );
        }
        if (r.exited && r.lease_removed) r.done = true;
      })
  );
  for (const c of controllers.values())
    if (!c.exited && !alive(c.pid)) {
      c.exited = Date.now();
      ev({type: 'controller_exited', pid: c.pid, root: path.basename(c.root)});
    }
};

const ps = () =>
  new Promise((resolve) =>
    execFile('ps', ['-A', '-o', 'pid=,ppid=,stat=,%cpu=,rss=,comm='], {maxBuffer: 1 << 24}, (e, out) => {
      const m = new Map();
      for (const line of (out || '').split('\n')) {
        const p = line.trim().split(/\s+/);
        if (p.length < 6) continue;
        m.set(Number(p[0]), {pid: Number(p[0]), ppid: Number(p[1]), stat: p[2], cpu: Number(p[3]), rss: Number(p[4]), comm: p.slice(5).join(' ')});
      }
      resolve(m);
    })
  );
const children = (m, pid) => [...m.values()].filter((p) => p.ppid === pid);
const snapshotTree = (pid, name) =>
  execFile('ps', ['-A', '-o', 'pid,ppid,stat,%cpu,rss,etime,wchan,command'], {maxBuffer: 1 << 24}, (e, out) =>
    fs.writeFileSync(path.join(OUT, 'samples', `${name}.ps.txt`), out || String(e))
  );

const psTick = async () => {
  const m = await ps();
  lastPs = m;
  const t = Date.now();
  for (const r of runtimes.values()) {
    if (r.done) continue;
    const p = m.get(r.pid);
    const kids = children(m, r.pid);
    if (!r.maxKids || kids.length > r.maxKids) r.maxKids = kids.length;
    if (r.maxKids && kids.length < r.maxKids && !r.port_closed) mark(r, 'children_drop', {from: r.maxKids, to: kids.length});
    psOut.write(
      JSON.stringify({t, id: r.id, pid: r.pid, stat: p?.stat ?? null, cpu: p?.cpu ?? null, rss: p?.rss ?? null,
        kids: kids.map((k) => [k.pid, k.stat, k.cpu, k.comm.split('/').pop()])}) + '\n'
    );
  }
};

const loadTick = async () => {
  const m = lastPs;
  let cpu = 0;
  let electron = 0;
  for (const p of m.values()) {
    cpu += p.cpu;
    if (/Electron/.test(p.comm)) electron += 1;
  }
  // Memory is the variable the local run could not reproduce (7 GB runner): pressure level and swap.
  execFile('sysctl', ['-n', 'kern.memorystatus_vm_pressure_level', 'vm.swapusage'], (e, out) => {
    const [lvl, swap = ''] = String(out || '').split('\n');
    const used = /used = ([\d.]+)M/.exec(swap);
    loadOut.write(JSON.stringify({t: Date.now(), load: os.loadavg(), cpuSumPct: Math.round(cpu), ncpu: os.cpus().length,
      electronProcs: electron, freeMemMB: Math.round(os.freemem() / 1048576), pressure: Number(lvl) || null,
      swapUsedMB: used ? Number(used[1]) : null}) + '\n');
  });
};

const sizes = new Map();
const copyLogs = () => {
  for (const root of roots()) {
    const walk = (d, depth) => {
      let ents = [];
      try {
        ents = fs.readdirSync(d, {withFileTypes: true});
      } catch {
        return;
      }
      for (const e of ents) {
        const p = path.join(d, e.name);
        if (e.isDirectory() && depth < 5 && !/^(Cache|Code Cache|GPUCache|blob_storage|Partitions|Session Storage|Local Storage|IndexedDB|Service Worker|addons)$/.test(e.name)) walk(p, depth + 1);
        else if (e.isFile() && e.name === 'main.log') {
          const size = fs.statSync(p).size;
          if (sizes.get(p) === size) continue;
          sizes.set(p, size);
          const dest = path.join(OUT, 'logs', path.relative(TMP, p));
          fs.mkdirSync(path.dirname(dest), {recursive: true});
          try {
            fs.copyFileSync(p, dest);
          } catch {}
        }
      }
    };
    walk(root, 0);
  }
};

let busy = false;
const t1 = setInterval(async () => {
  if (busy) return;
  busy = true;
  try {
    await tick();
  } finally {
    busy = false;
  }
}, 100);
const t2 = setInterval(psTick, 250);
const t3 = setInterval(() => {
  loadTick();
  copyLogs();
}, 1000);

process.on('SIGTERM', () => {
  clearInterval(t1);
  clearInterval(t2);
  clearInterval(t3);
  const strip = ({probing, file, ...r}) => ({...r, root: path.basename(r.root)});
  fs.writeFileSync(
    path.join(OUT, 'runtimes.json'),
    JSON.stringify({runtimes: [...runtimes.values()].map(strip), controllers: [...controllers.values()].map((c) => ({...c, root: path.basename(c.root)}))}, null, 1)
  );
  ev({type: 'end'});
  events.end(() => process.exit(0));
});
