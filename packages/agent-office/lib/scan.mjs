// Finds the session files each agent writes, in each agent's own folder,
// and reads the ones that changed: whole when new, then only what was
// appended. readers.mjs turns the text into a session's facts.
//
// Cheap on purpose: it runs every second or two while magpie is open. A
// folder is listed only for files changed in the last `days`; a file is
// read again only when its size or time moved; a big file is read from its
// tail (a turn's state is in its last lines, and the start of the file —
// the session header, its first prompt — is read once and kept).
import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { basename, dirname, join } from "node:path"
import { readClaude, readCodex, readDsh, readGemini, readPi } from "./readers.mjs"

const HEAD = 64 * 1024 // what is kept of a file's start: its header, its first prompt
const TAIL = 512 * 1024 // what is read of a big file's end
// A dsh session is one compressed file that is rewritten on every step, so
// decoding all of it each 1.5 s tick is wasteful while it is being written.
// The cap keeps a pathological file from stalling a tick, and an active one
// is decoded at most once every ZSTD_EVERY: its last facts stand meanwhile.
const ZSTD_MAX = 8 * 1024 * 1024
const ZSTD_EVERY = 4000
// Claude Code keeps one file per running process, <config>/sessions/<pid>.json
// ({pid, sessionId, …}). It takes the file away when it ends on SIGINT or
// SIGTERM and leaves it when SIGKILLed, so a session with no living process
// in that folder has stopped, whatever its last line says. That is the case
// of an agent another agent ran and interrupted (`claude -p` killed from the
// shell): its file ends mid-turn, and without this it read as at work and
// then stuck for good. A turn quiet less than GONE_AFTER is not judged: the
// process may be starting.
const GONE_AFTER = 10e3
const MIDTURN = new Set(["thinking", "tool", "approval", "ask"])

function env(k) { return (process.env[k] || "").trim() }
function home(...p) { return join(env("HOME") || homedir(), ...p) }
function expand(p) { return p.startsWith("~/") ? home(p.slice(2)) : p }

// where each agent keeps its sessions: { agent, kind, root, depth, match }
// depth: how many folders down from root the files sit
export function sources() {
  const claude = env("CLAUDE_CONFIG_DIR") ? expand(env("CLAUDE_CONFIG_DIR")) : home(".claude")
  const codex = env("CODEX_HOME") ? expand(env("CODEX_HOME")) : home(".codex")
  const dsh = env("DSH_HOME") ? expand(env("DSH_HOME")) : home(".dsh")
  const pi = env("PI_CODING_AGENT_DIR") ? expand(env("PI_CODING_AGENT_DIR")) : home(".pi", "agent")
  const qoder = env("QODER_CONFIG_DIR") ? expand(env("QODER_CONFIG_DIR")) : home(".qoder")
  const qodercn = env("QODERCN_CONFIG_DIR") ? expand(env("QODERCN_CONFIG_DIR")) : home(".qoder-cn")
  const workbuddy = env("WORKBUDDY_CONFIG_DIR") ? expand(env("WORKBUDDY_CONFIG_DIR")) : home(".workbuddy")
  const codebuddy = env("CODEBUDDY_CONFIG_DIR") ? expand(env("CODEBUDDY_CONFIG_DIR")) : home(".codebuddy")
  const jsonl = (n) => n.endsWith(".jsonl")
  return [
    { agent: "claude", kind: "claude", root: join(claude, "projects"), depth: 1, match: jsonl, live: join(claude, "sessions") },
    { agent: "codex", kind: "codex", root: join(codex, "sessions"), depth: 3, match: (n) => n.startsWith("rollout-") && n.endsWith(".jsonl") },
    { agent: "dsh", kind: "dsh", root: join(dsh, "sessions"), depth: 2, match: (n) => n === "session.v4.jsonl.zstd" || n === "session.v4.jsonl" },
    { agent: "gemini", kind: "gemini", root: home(".gemini", "tmp"), depth: 2, match: (n) => n.startsWith("session-") && (n.endsWith(".json") || n.endsWith(".jsonl")) },
    { agent: "qwen", kind: "gemini", root: home(".qwen", "tmp"), depth: 2, match: (n) => n.startsWith("session-") && (n.endsWith(".json") || n.endsWith(".jsonl")) },
    { agent: "pi", kind: "pi", root: join(pi, "sessions"), depth: 1, match: jsonl },
    { agent: "omp", kind: "pi", root: home(".omp", "agent", "sessions"), depth: 1, match: jsonl },
    { agent: "qoder", kind: "claude", root: join(qoder, "projects"), depth: 1, match: jsonl, live: join(qoder, "sessions") },
    { agent: "qoder-cn", kind: "claude", root: join(qodercn, "projects"), depth: 1, match: jsonl, live: join(qodercn, "sessions") },
    { agent: "workbuddy", kind: "claude", root: join(workbuddy, "projects"), depth: 1, match: jsonl, live: join(workbuddy, "sessions") },
    { agent: "codebuddy", kind: "claude", root: join(codebuddy, "projects"), depth: 1, match: jsonl, live: join(codebuddy, "sessions") },
  ]
}

// the files under root, `depth` folders down, changed since `since`
function walk(root, depth, match, since, out) {
  let names
  try { names = readdirSync(root, { withFileTypes: true }) } catch { return }
  for (const e of names) {
    const p = join(root, e.name)
    if (depth > 0) {
      if (!e.isDirectory()) continue
      // Codex's YYYY/MM/DD: a whole old month or day is skipped by its name
      walk(p, depth - 1, match, since, out)
    } else if (e.isFile() && match(e.name)) {
      let st
      try { st = statSync(p) } catch { continue }
      if (st.mtimeMs >= since) out.push({ path: p, size: st.size, mtime: st.mtimeMs })
    }
  }
}

function readRange(path, from, len) {
  const fd = openSync(path, "r")
  try {
    const b = Buffer.alloc(len)
    const n = readSync(fd, b, 0, len, from)
    return b.subarray(0, n).toString("utf8")
  } finally { closeSync(fd) }
}

function zstd(path) {
  const raw = readFileSync(path)
  if (typeof Bun !== "undefined" && Bun.zstdDecompressSync) return new TextDecoder().decode(Bun.zstdDecompressSync(raw))
  throw new Error("no zstd here")
}

// whether a process with this pid is running: EPERM is someone else's, still
// running; only ESRCH says there is none
function pidAlive(pid) {
  try { process.kill(pid, 0); return true } catch (e) { return e?.code !== "ESRCH" }
}

// The sessions folder of a Claude-format agent: which session ids have a
// running process. null when it can't say: the folder has never been seen
// to hold such a file (an agent, or a version, that doesn't keep them), or
// can't be read. Once a folder has held one, an empty folder means no
// process runs.
export function createProcesses() {
  const dirs = new Map() // dir -> { kept: bool, files: Map(name -> { mtime, pid, id, here }) }
  function running(dir) {
    let d = dirs.get(dir)
    if (!d) { d = { kept: false, files: new Map() }; dirs.set(dir, d) }
    let names
    try { names = readdirSync(dir) } catch { return null }
    const seen = new Set()
    for (const n of names) {
      if (!/^\d+\.json$/.test(n)) continue
      seen.add(n)
      const p = join(dir, n)
      let st
      try { st = statSync(p) } catch { continue }
      let f = d.files.get(n)
      if (!f || f.mtime !== st.mtimeMs) {
        let j
        try { j = JSON.parse(readFileSync(p, "utf8")) } catch { j = null }
        if (!j) { d.files.delete(n); return null } // half-written: unknown this time
        // a pid of another system's (Claude Code in WSL writing here) can't
        // be asked about from this one
        const here = !j.pidDomain || j.pidDomain === process.platform
        f = { mtime: st.mtimeMs, pid: Number(j.pid), id: String(j.sessionId || ""), here }
        d.files.set(n, f)
      }
      if (f.id && Number.isInteger(f.pid) && f.pid > 0) d.kept = true
    }
    for (const n of d.files.keys()) if (!seen.has(n)) d.files.delete(n)
    if (!d.kept) return null
    const ids = new Set()
    for (const f of d.files.values()) if (f.id && (!f.here || pidAlive(f.pid))) ids.add(f.id)
    return ids
  }
  return { running }
}

function readerFor(kind, agent) {
  switch (kind) {
    case "claude": return (t, id) => readClaude(t, agent, id)
    case "codex": return (t, id) => readCodex(t, id)
    case "dsh": return (t, id) => readDsh(t, id)
    case "gemini": return (t, id) => readGemini(t, agent, id)
    case "pi": return (t, id) => readPi(t, agent, id)
  }
}

function idOf(src, path) {
  const name = basename(path)
  if (src.kind === "dsh") return basename(dirname(path))
  if (src.kind === "codex") { const m = /-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:_[^.]*)?\.jsonl$/i.exec(name); return m ? m[1] : name }
  return name.replace(/\.jsonl?$/, "").replace(/^\d{4}-\d{2}-\d{2}T[^_]+_/, "")
}

// Codex names a thread in session_index.jsonl ({id, thread_name}), the
// latest line for an id winning
function codexTitles() {
  const dir = env("CODEX_HOME") ? expand(env("CODEX_HOME")) : home(".codex")
  const out = new Map()
  try {
    for (const l of readFileSync(join(dir, "session_index.jsonl"), "utf8").split("\n")) {
      if (!l) continue
      try { const d = JSON.parse(l); if (d.id && d.thread_name) out.set(d.id, String(d.thread_name).trim()) } catch {}
    }
  } catch {}
  return out
}

export function createScanner(opts = {}) {
  const o = { days: 2, max: 40, zstdMax: ZSTD_MAX, zstdEvery: ZSTD_EVERY, ...opts }
  const files = new Map() // path -> { size, mtime, head, session }
  let srcs = o.sources || sources()
  const procs = o.processes || createProcesses()

  // one pass: every changed file read again; gives the sessions, latest first
  function scan(now = Date.now()) {
    const since = now - o.days * 86400e3
    const found = []
    for (const src of srcs) {
      if (!existsSync(src.root)) continue
      const got = []
      walk(src.root, src.depth, src.match, since, got)
      for (const f of got) found.push({ ...f, src })
    }
    found.sort((a, b) => b.mtime - a.mtime)
    const keep = found.slice(0, o.max)
    const live = new Set(keep.map((f) => f.path))
    for (const p of files.keys()) if (!live.has(p)) files.delete(p)
    const out = []
    let titles = null
    const running = new Map() // a sessions folder, read once a pass
    for (const f of keep) {
      let c = files.get(f.path)
      const changed = !c || c.size !== f.size || c.mtime !== f.mtime
      if (changed) {
        const zstd = f.path.endsWith(".zstd")
        // decode an active compressed session at most once every
        // zstdEvery ms; its file time still says it is at work
        if (zstd && c?.session && now - (c.decodedAt || 0) < o.zstdEvery) {
          c.size = f.size
          c.mtime = f.mtime
          c.session.touched = Math.max(c.session.touched || 0, f.mtime)
        } else {
          try { c = readOne(f, c, now) } catch (e) { continue }
          files.set(f.path, c)
        }
      }
      if (!c.session) continue
      if (c.session.agent === "codex") {
        titles ??= codexTitles()
        const t = titles.get(c.session.id)
        if (t) c.session.title = t.length > 48 ? t.slice(0, 47) + "…" : t
      }
      const s = c.session
      if (f.src.live && MIDTURN.has(s.phase) && now - f.mtime >= GONE_AFTER) {
        if (!running.has(f.src.live)) running.set(f.src.live, procs.running(f.src.live))
        const ids = running.get(f.src.live)
        if (ids && !ids.has(s.id)) { out.push({ ...s, phase: "aborted", pending: [], gone: true }); continue }
      }
      out.push(s)
    }
    return out
  }

  function readOne(f, was, now = Date.now()) {
    const read = readerFor(f.src.kind, f.src.agent)
    const id = idOf(f.src, f.path)
    let text
    if (f.path.endsWith(".zstd")) {
      if (f.size > o.zstdMax) return { size: f.size, mtime: f.mtime, session: was?.session || null, decodedAt: now }
      text = zstd(f.path)
      const s = read(text, id)
      s.path = f.path
      return { size: f.size, mtime: f.mtime, session: finish(s, f), decodedAt: now }
    } else if (f.size <= HEAD + TAIL) {
      text = readRange(f.path, 0, f.size)
    } else {
      // the start once (header, first prompt), and the end every time
      const head = was?.head ?? readRange(f.path, 0, HEAD)
      let tail = readRange(f.path, f.size - TAIL, TAIL)
      tail = tail.slice(tail.indexOf("\n") + 1)
      text = head.slice(0, head.lastIndexOf("\n") + 1) + tail
      const s = read(text, id)
      s.path = f.path
      return { size: f.size, mtime: f.mtime, head, session: finish(s, f) }
    }
    const s = read(text, id)
    s.path = f.path
    return { size: f.size, mtime: f.mtime, session: finish(s, f) }
  }

  function finish(s, f) {
    if (!s.id) s.id = idOf(f.src, f.path)
    if (!s.updated) s.updated = f.mtime
    // the file's own time: a line being written is the session at work
    s.touched = f.mtime
    s.key = `${s.agent}|${s.id}`
    return s
  }

  return { scan, files, setSources: (x) => { srcs = x; files.clear() } }
}
