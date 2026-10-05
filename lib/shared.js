// dsh-novel-studio — the shared library across books.
//
// Two scopes: every book keeps its own records exactly as before (nothing in
// the book pipeline changes), and one library-level store sits beside the
// books at `<root>/.novel-shared/` for entities a writer chose to publish
// (提升 / promote). Other books bring an entity in with 引入 (link — stays in
// sync with the source, can be locked) or 派生 (fork — a private copy that
// evolves on its own).
//
// Layout
//   <root>/.novel-shared/shared.yaml            index: per key { status, origin, updatedAt }
//   <root>/.novel-shared/<unit dir>/<file>      the entity, byte-for-byte as promoted
//   <root>/.novel-shared/.versions/<key>/…      backup taken when a promote overwrites
//   <bookDir>/.shared-links.yaml                links: per key { mode, rev, local, pin }
//
//   key     = `<unitKey>/<id>` — unit keys are unique across the schema
//   rev     = sha1 of the shared file at the last import/sync  (stale ⇒ source moved on)
//   local   = sha1 of the book file right after that write     (drift ⇒ edited locally)
//   status  = stable | draft — only stable entries may be linked in (防污染: 准入)
//
// The store starts with a dot, and the shelf scanner skips dot-prefixed
// directories (library.js), so it never shows up as a book on the shelf.

const V = new URL(import.meta.url).searchParams.get('v') ?? '0'

const { SECTIONS } = await import(`./schema.js?v=${V}`)
const { listBooks, readYamlFile, writeYamlFile } = await import(`./library.js?v=${V}`)

const { createHash } = await import('node:crypto')
const { mkdir, readdir, readFile, stat, writeFile } = await import('node:fs/promises')
const { join } = await import('node:path')

function bad(message, status = 400, code) {
  const err = new Error(message)
  err.status = status
  if (code) err.code = code
  return err
}

/** A shared-store file name is a stem inside one unit — never a path. */
function safeId(id) {
  const s = String(id ?? '').trim()
  if (!s) throw bad('missing id')
  if (s.includes('/') || s.includes('\\') || s.includes('..') || s.startsWith('.')) throw bad('invalid id')
  if (s.length > 120) throw bad('id too long')
  return s
}

function sha1(buf) {
  return createHash('sha1').update(buf).digest('hex')
}

export const SHARED_DIR = '.novel-shared'
export const LINKS_FILE = '.shared-links.yaml'

// ── catalog ───────────────────────────────────────────────────────────────

/**
 * The units the shared library can hold: one-file records (人物/世界观/场景)
 * plus plain files (素材). Chapters, doc lists and drafts stay out — they are
 * book-shaped, not entity-shaped.
 */
export function unitCatalog() {
  const out = []
  for (const s of SECTIONS) {
    if (s.kind === 'records') out.push({ key: s.key, route: s.key, dir: s.dir, kind: 'records', zh: s.zh, en: s.en, titleField: s.titleField })
    if (s.kind === 'files' && s.key !== 'drafts') out.push({ key: s.key, route: s.key, dir: s.dir, kind: 'files', zh: s.zh, en: s.en })
    for (const g of s.groups || []) {
      if (g.kind === 'records') out.push({ key: g.key, route: `${s.key}/${g.key}`, dir: g.dir, kind: 'records', zh: g.zh, en: g.en, titleField: g.titleField })
      if (g.kind === 'files') out.push({ key: g.key, route: `${s.key}/${g.key}`, dir: g.dir, kind: 'files', zh: g.zh, en: g.en })
    }
  }
  return out
}

function unitOf(key) {
  const unit = unitCatalog().find((u) => u.key === key)
  if (!unit) throw bad(`unknown unit: ${key}`, 404, 'shared-unit-unknown')
  return unit
}

/** Split `characters/林望` → { unit, id } with both sides validated. */
function parseKey(key) {
  const s = String(key ?? '')
  const at = s.indexOf('/')
  if (at <= 0) throw bad('invalid key', 400, 'shared-key-invalid')
  const unit = unitOf(s.slice(0, at))
  const id = safeId(s.slice(at + 1))
  return { unit, id, key: `${unit.key}/${id}` }
}

// ── paths ─────────────────────────────────────────────────────────────────

export function sharedDir(root) {
  return join(root, SHARED_DIR)
}

async function sharedFileOf(root, unit, id) {
  // records live in `<id>.yaml` (or the .yml the book happens to use); plain
  // files keep their name including the extension.
  const base = join(sharedDir(root), unit.dir)
  if (unit.kind === 'files') return join(base, id)
  for (const ext of ['.yaml', '.yml']) {
    const file = join(base, `${id}${ext}`)
    if (await stat(file).then(() => true, () => false)) return file
  }
  return join(base, `${id}.yaml`)
}

async function bookFileOf(bookDir, unit, id) {
  const base = join(bookDir, unit.dir)
  if (unit.kind === 'files') return join(base, id)
  for (const ext of ['.yaml', '.yml']) {
    const file = join(base, `${id}${ext}`)
    if (await stat(file).then(() => true, () => false)) return file
  }
  return join(base, `${id}.yaml`)
}

function indexFile(root) {
  return join(sharedDir(root), 'shared.yaml')
}

function linksFile(bookDir) {
  return join(bookDir, LINKS_FILE)
}

async function readIndex(root) {
  const doc = await readYamlFile(indexFile(root), {})
  return { entries: { ...(doc?.entries || {}) } }
}

async function writeIndex(root, index) {
  await writeYamlFile(indexFile(root), index)
}

async function readLinks(bookDir) {
  const doc = await readYamlFile(linksFile(bookDir), {})
  return { links: { ...(doc?.links || {}) } }
}

async function writeLinks(bookDir, links) {
  await writeYamlFile(linksFile(bookDir), { links })
}

async function readBytes(file) {
  return readFile(file)
}

async function exists(file) {
  return stat(file).then(() => true, () => false)
}

// ── browse ────────────────────────────────────────────────────────────────

/**
 * Everything in the shared store, grouped by unit, with live revs so the panel
 * can tell a linked copy whether the source moved on.
 * @returns { Promise<{ root: string, units: any[], entries: any[] }> }
 */
export async function listShared(root) {
  const units = unitCatalog()
  const index = await readIndex(root)
  const entries = []
  for (const unit of units) {
    const dir = join(sharedDir(root), unit.dir)
    let names = []
    try {
      names = (await readdir(dir)).filter((n) => !n.startsWith('.'))
    } catch {
      continue
    }
    for (const name of names) {
      const file = join(dir, name)
      const st = await stat(file).catch(() => null)
      if (!st || !st.isFile()) continue
      const id = unit.kind === 'records' ? name.replace(/\.(yaml|yml)$/i, '') : name
      const key = `${unit.key}/${id}`
      const meta = index.entries[key] || {}
      let title = id
      if (unit.kind === 'records') {
        const data = await readYamlFile(file, {})
        title = String(data?.[unit.titleField] || data?.name || data?.title || id)
      }
      entries.push({
        key,
        unit: unit.key,
        route: unit.route,
        id,
        title,
        status: meta.status === 'draft' ? 'draft' : 'stable',
        origin: meta.origin || null,
        updatedAt: meta.updatedAt || null,
        rev: sha1(await readBytes(file)),
      })
    }
  }
  return { root, units, entries }
}

// ── promote (本书 → 共享库) ───────────────────────────────────────────────

/**
 * Copy one of this book's records into the shared store. An overwrite first
 * keeps the previous file under `.versions/` (防污染: 保留版本) — the impact
 * prompt itself happens in the panel, which asks before calling this.
 * @returns { Promise<{ key, backup: string|null, status }> }
 */
export async function promote(root, bookDir, bookId, unitKey, id, status = 'stable') {
  const unit = unitOf(unitKey)
  const clean = safeId(id)
  if (unit.kind === 'files' && clean.includes('/')) throw bad('素材子目录里的文件暂时不能放入共享库')
  const src = await bookFileOf(bookDir, unit, clean)
  if (!(await exists(src))) throw bad('本书里没有这个条目', 404, 'shared-source-book-missing')
  const bytes = await readBytes(src)

  const dest = await sharedFileOf(root, unit, clean)
  let backup = null
  if (await exists(dest)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const ext = dest.slice(dest.lastIndexOf('.'))
    const rel = join('.versions', `${unit.key}/${clean}`, `${stamp}${ext}`)
    const into = join(sharedDir(root), rel)
    await mkdir(join(into, '..'), { recursive: true })
    await writeFile(into, await readBytes(dest))
    backup = rel
  }
  await mkdir(join(dest, '..'), { recursive: true })
  await writeFile(dest, bytes)

  const index = await readIndex(root)
  const prev = index.entries[`${unit.key}/${clean}`] || {}
  const at = new Date().toISOString()
  index.entries[`${unit.key}/${clean}`] = {
    status: status === 'draft' ? 'draft' : 'stable',
    origin: { book: bookId, at: prev.origin?.at || at },
    updatedAt: at,
  }
  await writeIndex(root, index)
  return { key: `${unit.key}/${clean}`, backup, status: index.entries[`${unit.key}/${clean}`].status }
}

// ── import (共享库 → 本书): 引入 link / 派生 fork ─────────────────────────

/**
 * Bring a shared entry into this book. A link requires a stable entry
 * (防污染: 只有稳定版才允许被引用); a fork is a plain copy that may start
 * from a draft. The book must not already hold that id — nothing existing is
 * ever overwritten by an import.
 * @returns { Promise<{ key, mode }> }
 */
export async function importToBook(root, bookDir, unitKey, id, mode = 'link') {
  const unit = unitOf(unitKey)
  const clean = safeId(id)
  if (mode !== 'link' && mode !== 'fork') throw bad('mode must be link or fork')
  const index = await readIndex(root)
  const key = `${unit.key}/${clean}`
  const status = index.entries[key]?.status === 'draft' ? 'draft' : 'stable'
  if (mode === 'link' && status !== 'stable') {
    throw bad('只有稳定版的共享条目才能引入（当前是草稿，可先派生或标为稳定版）', 409, 'shared-not-stable')
  }
  const src = await sharedFileOf(root, unit, clean)
  if (!(await exists(src))) throw bad('共享库里还没有这个条目', 404, 'shared-source-missing')
  const dest = await bookFileOf(bookDir, unit, clean)
  if (await exists(dest)) throw bad('本书已有同名条目，先改名或删除后再引入', 409, 'shared-target-exists')

  const bytes = await readBytes(src)
  await mkdir(join(dest, '..'), { recursive: true })
  await writeFile(dest, bytes)

  const store = await readLinks(bookDir)
  store.links[key] = { mode, rev: sha1(bytes), local: sha1(bytes), pin: false }
  await writeLinks(bookDir, store.links)
  return { key, mode }
}

// ── book links: status, sync, pin ─────────────────────────────────────────

/**
 * This book's shared references with everything the panel badges need:
 * stale (source moved on), drift (edited here since the last sync), pin,
 * and whether the source still exists at all.
 * @returns { Promise<{ links: any[] }> }
 */
export async function bookLinks(root, bookDir) {
  const store = await readLinks(bookDir)
  const index = await readIndex(root)
  const out = []
  for (const [key, entry] of Object.entries(store.links || {})) {
    const parsed = (() => {
      try {
        return parseKey(key)
      } catch {
        return null
      }
    })()
    if (!parsed) {
      out.push({ key, orphan: true, mode: entry?.mode || 'link', pin: !!entry?.pin })
      continue
    }
    const src = await sharedFileOf(root, parsed.unit, parsed.id)
    const sourceExists = await exists(src)
    const srcBytes = sourceExists ? await readBytes(src) : null
    const dest = await bookFileOf(bookDir, parsed.unit, parsed.id)
    const destExists = await exists(dest)
    const destBytes = destExists ? await readBytes(dest) : null
    const status = index.entries[key]?.status === 'draft' ? 'draft' : 'stable'
    // title comes from whichever copy still exists — the source first, the
    // book's own copy when the shared entry was removed underneath.
    let title = parsed.id
    if (parsed.unit.kind === 'records') {
      const data = await readYamlFile(sourceExists ? src : dest, {})
      title = String(data?.[parsed.unit.titleField] || data?.name || data?.title || parsed.id)
    }
    out.push({
      key,
      unit: parsed.unit.key,
      route: parsed.unit.route,
      id: parsed.id,
      title,
      mode: entry.mode === 'fork' ? 'fork' : 'link',
      pin: !!entry.pin,
      status,
      sourceExists,
      stale: sourceExists && entry.rev !== sha1(srcBytes),
      drift: destExists && entry.local !== sha1(destBytes),
    })
  }
  out.sort((a, b) => String(a.key).localeCompare(String(b.key)))
  return { links: out }
}

/** Pull the shared file over this book's copy. Locked links refuse (锁定). */
export async function sync(root, bookDir, unitKey, id) {
  const unit = unitOf(unitKey)
  const clean = safeId(id)
  const key = `${unit.key}/${clean}`
  const store = await readLinks(bookDir)
  const entry = store.links[key]
  if (!entry) throw bad('本书没有这条引用记录', 404, 'shared-link-missing')
  if (entry.pin) throw bad('这条引用已锁定，先解锁才能同步', 409, 'shared-pinned')
  if (entry.mode === 'fork') throw bad('派生的副本不跟源同步，它是独立演化的', 409, 'shared-fork')
  const src = await sharedFileOf(root, unit, clean)
  if (!(await exists(src))) throw bad('共享库里已经没有这个条目', 404, 'shared-source-missing')
  const bytes = await readBytes(src)
  const dest = await bookFileOf(bookDir, unit, clean)
  await mkdir(join(dest, '..'), { recursive: true })
  await writeFile(dest, bytes)
  entry.rev = sha1(bytes)
  entry.local = sha1(bytes)
  await writeLinks(bookDir, store.links)
  return { key }
}

/** Lock (or unlock) a link: pinned copies stop accepting source updates. */
export async function setPin(bookDir, unitKey, id, pin = true) {
  const unit = unitOf(unitKey)
  const clean = safeId(id)
  const key = `${unit.key}/${clean}`
  const store = await readLinks(bookDir)
  const entry = store.links[key]
  if (!entry) throw bad('本书没有这条引用记录', 404, 'shared-link-missing')
  entry.pin = !!pin
  await writeLinks(bookDir, store.links)
  return { key, pin: entry.pin }
}

// ── impact (改共享体前提示影响范围) ───────────────────────────────────────

/**
 * Which books hold a reference to this shared key — links and forks alike,
 * each with its mode, so the panel can warn before an overwrite.
 * @returns { Promise<{ key, books: [{ id, title, mode }] }> }
 */
export async function impact(root, key) {
  const parsed = parseKey(key)
  const books = []
  for (const b of await listBooks(root)) {
    const store = await readYamlFile(linksFile(b.dir), null)
    const entry = store?.links?.[parsed.key]
    if (entry) books.push({ id: b.id, title: b.title || b.id, mode: entry.mode === 'fork' ? 'fork' : 'link' })
  }
  return { key: parsed.key, books }
}
