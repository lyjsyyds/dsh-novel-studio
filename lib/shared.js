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
//   <root>/.novel-shared/shared.yaml            index: series / entries / templates
//   <root>/.novel-shared/<unit dir>/<file>      the entity, byte-for-byte as promoted
//   <root>/.novel-shared/series/<sid>/<unit>/…  a series-scoped (书系) entity
//   <root>/.novel-shared/.versions/<key>/…      backup taken when a promote overwrites
//   <bookDir>/.shared-links.yaml                links: per key { mode, rev, local, pin, scope?, overrides? }
//
//   key     = `<unitKey>/<id>` — unit keys are unique across the schema
//   scope   = '' (global, the default) or a series id. A series key is
//             `series:<sid>:<unitKey>/<id>`; plain keys keep their P1 meaning
//             so every existing link keeps working unchanged. The book-side
//             link map stays keyed by the plain key (a book holds one file per
//             id) and records the scope beside it.
//   rev     = sha1 of the shared file at the last import/sync  (stale ⇒ source moved on)
//   local   = sha1 of the book file right after that write     (drift ⇒ edited locally)
//   status  = stable | draft — only stable entries may be linked in (防污染: 准入)
//
// The store starts with a dot, and the shelf scanner skips dot-prefixed
// directories (library.js), so it never shows up as a book on the shelf.

const V = new URL(import.meta.url).searchParams.get('v') ?? '0'

const { SECTIONS } = await import(`./schema.js?v=${V}`)
const { createBook, listBooks, readYamlFile, writeYamlFile } = await import(`./library.js?v=${V}`)

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
  const { scope, rest } = splitKey(key)
  const at = rest.indexOf('/')
  if (at <= 0) throw bad('invalid key', 400, 'shared-key-invalid')
  const unit = unitOf(rest.slice(0, at))
  const id = safeId(rest.slice(at + 1))
  return { unit, id, scope, key: scopedKey(scope, `${unit.key}/${id}`), plain: `${unit.key}/${id}` }
}

/** Encode a scope into a store key: `series:<sid>:<unit>/<id>`, plain when ''. */
export function scopedKey(scope, key) {
  const sid = String(scope || '').trim()
  return sid ? `series:${sid}:${key}` : key
}

/** Peel a scoped key apart. A malformed series prefix is an invalid key. */
function splitKey(key) {
  const s = String(key ?? '')
  if (!s.startsWith('series:')) return { scope: '', rest: s }
  const at = s.indexOf(':', 7)
  if (at <= 7) throw bad('invalid key', 400, 'shared-key-invalid')
  const sid = s.slice(7, at)
  if (!sid || /[\\/:]/.test(sid)) throw bad('invalid key', 400, 'shared-key-invalid')
  return { scope: sid, rest: s.slice(at + 1) }
}

/** A series id is a path segment and a key part: tame the name, keep it readable. */
function seriesIdOf(name) {
  const s = String(name ?? '').trim()
  if (!s) throw bad('missing name')
  let sid = s.replace(/[\\/:*?"<>|]/g, '-').replace(/^\.+/, '')
  if (!sid) throw bad('invalid name')
  if (sid.length > 60) sid = sid.slice(0, 60)
  return sid
}

// ── paths ─────────────────────────────────────────────────────────────────

export function sharedDir(root) {
  return join(root, SHARED_DIR)
}

async function sharedFileOf(root, unit, id, scope = '') {
  // records live in `<id>.yaml` (or the .yml the book happens to use); plain
  // files keep their name including the extension. A series scopes the whole
  // subtree under `series/<sid>/`.
  const base = scope
    ? join(sharedDir(root), 'series', scope, unit.dir)
    : join(sharedDir(root), unit.dir)
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
  return {
    series: { ...(doc?.series || {}) },
    entries: { ...(doc?.entries || {}) },
    templates: { ...(doc?.templates || {}) },
  }
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
  // Scopes: the global store ('') plus every series the index knows about,
  // and any series directory that appeared on disk without an index row.
  const sids = new Set(Object.keys(index.series || {}))
  try {
    for (const n of await readdir(join(sharedDir(root), 'series'))) {
      if (!n.startsWith('.')) sids.add(n)
    }
  } catch {
    /* no series directory yet */
  }
  for (const scope of ['', ...[...sids].sort()]) {
    for (const unit of units) {
      const dir = scope
        ? join(sharedDir(root), 'series', scope, unit.dir)
        : join(sharedDir(root), unit.dir)
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
        const key = scopedKey(scope, `${unit.key}/${id}`)
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
          scope: scope || '',
          series: scope ? index.series?.[scope]?.name || scope : null,
          status: meta.status === 'draft' ? 'draft' : 'stable',
          origin: meta.origin || null,
          updatedAt: meta.updatedAt || null,
          rev: sha1(await readBytes(file)),
        })
      }
    }
  }
  return { root, units, entries, series: index.series || {}, templates: Object.keys(index.templates || {}).length }
}

// ── promote (本书 → 共享库) ───────────────────────────────────────────────

/**
 * Copy one of this book's records into the shared store. An overwrite first
 * keeps the previous file under `.versions/` (防污染: 保留版本) — the impact
 * prompt itself happens in the panel, which asks before calling this.
 * @returns { Promise<{ key, backup: string|null, status }> }
 */
export async function promote(root, bookDir, bookId, unitKey, id, status = 'stable', scope = '') {
  const unit = unitOf(unitKey)
  const clean = safeId(id)
  if (unit.kind === 'files' && clean.includes('/')) throw bad('素材子目录里的文件暂时不能放入共享库')
  const sid = String(scope || '').trim()
  const index = await readIndex(root)
  if (sid && !index.series?.[sid]) throw bad('这个书系不存在，先新建一个', 404, 'shared-series-unknown')
  const src = await bookFileOf(bookDir, unit, clean)
  if (!(await exists(src))) throw bad('本书里没有这个条目', 404, 'shared-source-book-missing')
  const bytes = await readBytes(src)

  const dest = await sharedFileOf(root, unit, clean, sid)
  let backup = null
  if (await exists(dest)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const ext = dest.slice(dest.lastIndexOf('.'))
    const rel = join('.versions', sid ? `series/${sid}/${unit.key}/${clean}` : `${unit.key}/${clean}`, `${stamp}${ext}`)
    const into = join(sharedDir(root), rel)
    await mkdir(join(into, '..'), { recursive: true })
    await writeFile(into, await readBytes(dest))
    backup = rel
  }
  await mkdir(join(dest, '..'), { recursive: true })
  await writeFile(dest, bytes)

  const skey = scopedKey(sid, `${unit.key}/${clean}`)
  const prev = index.entries[skey] || {}
  const at = new Date().toISOString()
  index.entries[skey] = {
    status: status === 'draft' ? 'draft' : 'stable',
    origin: { book: bookId, at: prev.origin?.at || at },
    updatedAt: at,
  }
  await writeIndex(root, index)
  return { key: skey, backup, status: index.entries[skey].status }
}

// ── import (共享库 → 本书): 引入 link / 派生 fork ─────────────────────────

/**
 * Bring a shared entry into this book. A link requires a stable entry
 * (防污染: 只有稳定版才允许被引用); a fork is a plain copy that may start
 * from a draft. The book must not already hold that id — nothing existing is
 * ever overwritten by an import.
 * @returns { Promise<{ key, mode }> }
 */
export async function importToBook(root, bookDir, unitKey, id, mode = 'link', scope = '') {
  const unit = unitOf(unitKey)
  const clean = safeId(id)
  if (mode !== 'link' && mode !== 'fork') throw bad('mode must be link or fork')
  const sid = String(scope || '').trim()
  const index = await readIndex(root)
  const plain = `${unit.key}/${clean}`
  const skey = scopedKey(sid, plain)
  const status = index.entries[skey]?.status === 'draft' ? 'draft' : 'stable'
  if (mode === 'link' && status !== 'stable') {
    throw bad('只有稳定版的共享条目才能引入（当前是草稿，可先派生或标为稳定版）', 409, 'shared-not-stable')
  }
  const src = await sharedFileOf(root, unit, clean, sid)
  if (!(await exists(src))) throw bad('共享库里还没有这个条目', 404, 'shared-source-missing')
  const dest = await bookFileOf(bookDir, unit, clean)
  if (await exists(dest)) throw bad('本书已有同名条目，先改名或删除后再引入', 409, 'shared-target-exists')

  const bytes = await readBytes(src)
  await mkdir(join(dest, '..'), { recursive: true })
  await writeFile(dest, bytes)

  const store = await readLinks(bookDir)
  store.links[plain] = { mode, rev: sha1(bytes), local: sha1(bytes), pin: false, ...(sid ? { scope: sid } : {}) }
  await writeLinks(bookDir, store.links)
  return { key: plain, mode, scope: sid || '' }
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
    const scope = entry.scope || ''
    const src = await sharedFileOf(root, parsed.unit, parsed.id, scope)
    const sourceExists = await exists(src)
    const srcBytes = sourceExists ? await readBytes(src) : null
    const dest = await bookFileOf(bookDir, parsed.unit, parsed.id)
    const destExists = await exists(dest)
    const destBytes = destExists ? await readBytes(dest) : null
    const indexKey = scopedKey(scope, key)
    const status = index.entries[indexKey]?.status === 'draft' ? 'draft' : 'stable'
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
      scope,
      series: scope ? index.series?.[scope]?.name || scope : null,
      mode: entry.mode === 'fork' ? 'fork' : 'link',
      pin: !!entry.pin,
      overrides: Array.isArray(entry.overrides) ? entry.overrides : [],
      status,
      sourceExists,
      stale: sourceExists && entry.rev !== sha1(srcBytes),
      drift: destExists && entry.local !== sha1(destBytes),
    })
  }
  out.sort((a, b) => String(a.key).localeCompare(String(b.key)))
  return { links: out }
}

/** Pull the shared file over this book's copy. Locked links refuse (锁定).
 *  A record with 字段例外 (overrides) merges instead: the source wins everywhere
 *  except the fields this book chose to keep. */
export async function sync(root, bookDir, unitKey, id) {
  const unit = unitOf(unitKey)
  const clean = safeId(id)
  const key = `${unit.key}/${clean}`
  const store = await readLinks(bookDir)
  const entry = store.links[key]
  if (!entry) throw bad('本书没有这条引用记录', 404, 'shared-link-missing')
  if (entry.pin) throw bad('这条引用已锁定，先解锁才能同步', 409, 'shared-pinned')
  if (entry.mode === 'fork') throw bad('派生的副本不跟源同步，它是独立演化的', 409, 'shared-fork')
  const src = await sharedFileOf(root, unit, clean, entry.scope || '')
  if (!(await exists(src))) throw bad('共享库里已经没有这个条目', 404, 'shared-source-missing')
  const srcBytes = await readBytes(src)
  const dest = await bookFileOf(bookDir, unit, clean)
  await mkdir(join(dest, '..'), { recursive: true })
  let outBytes = srcBytes
  const overrides = Array.isArray(entry.overrides) ? entry.overrides : []
  if (overrides.length && unit.kind === 'records') {
    const srcData = await readYamlFile(src, {})
    const localData = (await exists(dest)) ? await readYamlFile(dest, {}) : {}
    const merged = { ...srcData }
    for (const k of overrides) {
      if (localData && localData[k] !== undefined) merged[k] = localData[k]
    }
    await writeYamlFile(dest, merged)
    outBytes = await readBytes(dest)
  } else {
    await writeFile(dest, srcBytes)
  }
  entry.rev = sha1(srcBytes)
  entry.local = sha1(outBytes)
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
    const entry = store?.links?.[parsed.plain]
    // The book must reference the same scope: a global link is not impact for
    // the series copy of the same unit/id.
    if (entry && (entry.scope || '') === (parsed.scope || '')) {
      books.push({ id: b.id, title: b.title || b.id, mode: entry.mode === 'fork' ? 'fork' : 'link' })
    }
  }
  return { key: parsed.key, scope: parsed.scope || '', books }
}

// ── series (书系层) ────────────────────────────────────────────────────────

/** Every series the store knows, with display names. */
export async function listSeries(root) {
  const index = await readIndex(root)
  const series = Object.entries(index.series || {}).map(([sid, s]) => ({
    sid,
    name: s?.name || sid,
    createdAt: s?.createdAt || null,
  }))
  series.sort((a, b) => String(a.name).localeCompare(String(b.name)))
  return { series }
}

/** Create (or return) a series. The same name twice is idempotent. */
export async function createSeries(root, name) {
  const index = await readIndex(root)
  const label = String(name ?? '').trim()
  const sid = seriesIdOf(label)
  const existing = index.series?.[sid]
  if (existing) {
    if ((existing.name || sid) === label) return { sid, name: existing.name || sid, existed: true }
    throw bad('这个书系名字已被占用，换个说法', 409, 'shared-series-conflict')
  }
  index.series = { ...(index.series || {}), [sid]: { name: label, createdAt: new Date().toISOString() } }
  await writeIndex(root, index)
  return { sid, name: label, existed: false }
}

// ── templates (题材模板 · 从模板建书) ─────────────────────────────────────

function templateIdFor(index, name) {
  const base = seriesIdOf(name)
  if (!index.templates?.[base]) return base
  return `${base}-${Date.now().toString(36)}`
}

/** Remember a set of shared entries as one named template. */
export async function saveTemplate(root, name, items) {
  const index = await readIndex(root)
  const label = String(name ?? '').trim()
  if (!label) throw bad('missing name')
  if (!Array.isArray(items) || !items.length) throw bad('模板至少要有一个条目')
  const keys = []
  for (const raw of items) {
    const parsed = parseKey(raw)
    if (!index.entries[parsed.key]) throw bad(`共享库里还没有这个条目：${parsed.key}`, 404, 'shared-source-missing')
    keys.push(parsed.key)
  }
  const tid = templateIdFor(index, label)
  const tpl = { name: label, items: [...new Set(keys)], createdAt: new Date().toISOString() }
  index.templates = { ...(index.templates || {}), [tid]: tpl }
  await writeIndex(root, index)
  return { tid, ...tpl }
}

/** Templates with entries resolved (title / status / scope) for the panel. */
export async function listTemplates(root) {
  const index = await readIndex(root)
  const out = []
  for (const [tid, tpl] of Object.entries(index.templates || {})) {
    const items = []
    for (const key of tpl.items || []) {
      let parsed = null
      try {
        parsed = parseKey(key)
      } catch {
        /* a key the schema no longer understands */
      }
      if (!parsed) {
        items.push({ key, missing: true })
        continue
      }
      const file = await sharedFileOf(root, parsed.unit, parsed.id, parsed.scope)
      const here = await exists(file)
      let title = parsed.id
      if (here && parsed.unit.kind === 'records') {
        const data = await readYamlFile(file, {})
        title = String(data?.[parsed.unit.titleField] || data?.name || data?.title || parsed.id)
      }
      items.push({
        key,
        unit: parsed.unit.key,
        route: parsed.unit.route,
        id: parsed.id,
        title,
        scope: parsed.scope || '',
        status: index.entries[parsed.key]?.status === 'draft' ? 'draft' : 'stable',
        missing: !here,
      })
    }
    out.push({ tid, name: tpl.name || tid, createdAt: tpl.createdAt || null, items })
  }
  out.sort((a, b) => String(a.name).localeCompare(String(b.name)))
  return { templates: out }
}

export async function deleteTemplate(root, tid) {
  const index = await readIndex(root)
  const id = String(tid ?? '')
  if (!index.templates?.[id]) throw bad('模板不存在', 404, 'shared-template-missing')
  delete index.templates[id]
  await writeIndex(root, index)
  return { tid: id }
}

/** New book from a template: create it, then bring every entry in — links
 *  where the entry is stable, forks where it is still a draft. */
export async function bookFromTemplate(root, title, tid) {
  const index = await readIndex(root)
  const tpl = index.templates?.[String(tid ?? '')]
  if (!tpl) throw bad('模板不存在', 404, 'shared-template-missing')
  const book = await createBook(root, { title: String(title ?? '').trim() || tpl.name })
  const imported = []
  const skipped = []
  for (const key of tpl.items || []) {
    let parsed = null
    try {
      parsed = parseKey(key)
    } catch {
      /* skip a key the schema no longer understands */
    }
    if (!parsed) {
      skipped.push(String(key))
      continue
    }
    const status = index.entries[parsed.key]?.status === 'draft' ? 'draft' : 'stable'
    const mode = status === 'stable' ? 'link' : 'fork'
    try {
      await importToBook(root, book.dir, parsed.unit.key, parsed.id, mode, parsed.scope || '')
      imported.push({ key, mode })
    } catch {
      skipped.push(String(key))
    }
  }
  return { book: { id: book.id, title: book.title || book.id }, imported, skipped }
}

// ── overrides (覆盖 Override · 简化版) ─────────────────────────────────────

/** Field-level exceptions on a link: the listed fields stay local, everything
 *  else keeps following the source on sync. Forks never get exceptions. */
export async function setOverrides(bookDir, unitKey, id, fields) {
  const unit = unitOf(unitKey)
  const clean = safeId(id)
  if (unit.kind !== 'records') throw bad('只有记录类条目可以设置字段例外', 400, 'shared-override-files')
  const key = `${unit.key}/${clean}`
  const store = await readLinks(bookDir)
  const entry = store.links[key]
  if (!entry) throw bad('本书没有这条引用记录', 404, 'shared-link-missing')
  if (entry.mode === 'fork') throw bad('派生副本独立演化，没有字段例外', 409, 'shared-fork')
  if (!Array.isArray(fields)) throw bad('fields must be an array')
  const list = [...new Set(fields.map((f) => String(f ?? '').trim()).filter(Boolean))]
  if (list.length) entry.overrides = list
  else delete entry.overrides
  await writeLinks(bookDir, store.links)
  return { key, overrides: entry.overrides || [] }
}

// ── cross-book foreshadowing (跨书伏笔) ───────────────────────────────────

/**
 * Every book's 伏笔 in one list, tagged with the book it lives in — so a
 * series can see what book 1 planted and book 3 still owes.
 * @returns { Promise<{ groups: [{ book, title, items }] }> }
 */
export async function crossForeshadowing(root) {
  const groups = []
  for (const b of await listBooks(root)) {
    const doc = await readYamlFile(join(b.dir, 'outline', 'foreshadowing.yaml'), null)
    const list = Array.isArray(doc?.items) ? doc.items : []
    if (!list.length) continue
    groups.push({
      book: b.id,
      title: b.title || b.id,
      items: list.map((it, i) => ({
        title: String(it?.title || `#${i + 1}`),
        planted: String(it?.planted || ''),
        payoff: String(it?.payoff || ''),
        status: String(it?.status || ''),
      })),
    })
  }
  return { groups }
}
