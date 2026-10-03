// dsh-novel-studio — data layer.
//
// The whole novel library is plain files on disk: one directory per book, YAML
// for structured records and Markdown for prose. Nothing here is a database —
// the point is that a writer can open the folder, read it, edit it by hand or
// sync it to git, and the studio is only a lens over it.
//
// Layout (per book):
//   <root>/<bookId>/book.yaml
//   characters/<id>.yaml        relationships.yaml
//   world/{rules,glossary,economy,timeline}.yaml  world/{locations,factions,items,races,cultures}/
//   outline/{tree,threads,foreshadowing,beats,hooks}.yaml  outline/scenes/
//   panels/{status,skills,equipment,tasks,reputation}.yaml  panels/custom/
//   chapters/0001-<title>.md    meta/0001.yaml    drafts/  materials/  publish/
//   settings.yaml

import { mkdir, copyFile, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

export const SCHEMA_VERSION = 1

/** Where the studio remembers a library location chosen in the panel. */
export function configPath() {
  const env = process.env.DSH_NOVEL_CONFIG
  if (typeof env === 'string' && env.trim()) return env.trim()
  return join(homedir(), '.dsh', 'novel-studio.yaml')
}

/** Where the library lives when nobody chose anything. */
export function defaultRoot() {
  return join(homedir(), '.dsh', 'novels')
}

let savedCache = { path: '', mtimeMs: 0, root: null }

/**
 * The root saved by the panel, or null.
 *
 * Synchronous on purpose: `resolveRoot()` is called by every route, and it is
 * synchronous already. The cache is keyed on the file's mtime, so an edit by
 * hand is picked up on the next call without paying for a read every time.
 */
function savedRoot() {
  const file = configPath()
  try {
    const info = statSync(file)
    if (savedCache.path === file && savedCache.mtimeMs === info.mtimeMs) return savedCache.root
    const doc = parseYaml(readFileSync(file, 'utf8')) || {}
    const value = typeof doc.root === 'string' && doc.root.trim() ? doc.root.trim() : null
    savedCache = { path: file, mtimeMs: info.mtimeMs, root: value }
    return value
  } catch {
    savedCache = { path: file, mtimeMs: 0, root: null }
    return null
  }
}

/**
 * Book roots are directories holding one `<bookId>/` per novel.
 *
 * Precedence: an explicit override → `DSH_NOVEL_ROOT` → what the panel saved →
 * the default `~/.dsh/novels`. The environment variable stays on top on purpose:
 * it is how a deployment (or a test run) pins the library, and a value saved in
 * the panel must never quietly win over it.
 */
export function resolveRoot(override) {
  if (typeof override === 'string' && override.trim()) return override.trim()
  const env = process.env.DSH_NOVEL_ROOT
  if (typeof env === 'string' && env.trim()) return env.trim()
  const saved = savedRoot()
  if (saved) return saved
  return defaultRoot()
}

/** Everything the panel needs to show — and to explain — where the library is. */
export function rootInfo() {
  const env = typeof process.env.DSH_NOVEL_ROOT === 'string' ? process.env.DSH_NOVEL_ROOT.trim() : ''
  const saved = savedRoot()
  return {
    root: resolveRoot(),
    source: env ? 'env' : saved ? 'settings' : 'default',
    locked: Boolean(env),
    envRoot: env || null,
    configuredRoot: saved,
    defaultRoot: defaultRoot(),
    configPath: configPath(),
  }
}

/** True when `child` is `parent` itself or sits underneath it. */
function isInside(child, parent) {
  const rel = relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function badRoot(message) {
  const err = new Error(message)
  err.status = 400
  err.code = 'bad-root'
  return err
}

/**
 * Save — or clear, with `null` / `''` — the library location chosen in the panel.
 *
 * A relative path is refused: it would resolve against the server's working
 * directory, which is never what a writer picking a folder means. A folder that
 * contains the current library (or lives inside it) is refused too, because
 * moving a library into itself loses books.
 */
export async function writeRoot(value) {
  const text = value === null || value === undefined ? '' : String(value).trim()
  if (text && !isAbsolute(text)) throw badRoot('位置需要一个绝对路径')
  if (/[\u0000]/.test(text)) throw badRoot('位置里不能有 NUL 字符')
  if (text.length > 1000) throw badRoot('位置太长了')
  const current = resolveRoot()
  if (text && text !== current && (isInside(text, current) || isInside(current, text))) {
    throw badRoot('新位置不能是当前位置的上层或子目录，请选一个独立的文件夹')
  }
  const file = configPath()
  const doc = (await readYamlFile(file, null)) || {}
  if (!text) delete doc.root
  else Object.assign(doc, { schemaVersion: SCHEMA_VERSION, root: text })
  await writeYamlFile(file, doc)
  savedCache = { path: '', mtimeMs: 0, root: null }
  return rootInfo()
}

async function copyTree(from, to) {
  await mkdir(to, { recursive: true })
  for (const entry of await readdir(from, { withFileTypes: true })) {
    const source = join(from, entry.name)
    const target = join(to, entry.name)
    if (entry.isDirectory()) await copyTree(source, target)
    else if (entry.isFile()) await copyFile(source, target)
    // Links and special files are skipped on purpose: a moved library should
    // hold what the studio wrote, not a pointer out of it.
  }
}

/**
 * Move every top-level directory from one library to another.
 *
 * A same-volume move is a rename; a cross-volume one (EXDEV) copies and then
 * deletes. Anything already sitting at the destination is reported and left
 * alone — a books folder is not something to overwrite silently.
 */
export async function moveRoot(fromRoot, toRoot) {
  const from = resolveRoot(fromRoot)
  const to = resolveRoot(toRoot)
  const moved = []
  const skipped = []
  if (from === to) return { moved, skipped, from, to }
  await mkdir(to, { recursive: true })
  let entries = []
  try {
    entries = await readdir(from, { withFileTypes: true })
  } catch (err) {
    if (err && err.code === 'ENOENT') return { moved, skipped, from, to }
    throw err
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      skipped.push({ name: entry.name, reason: 'not-a-directory' })
      continue
    }
    const target = join(to, entry.name)
    try {
      await stat(target)
      skipped.push({ name: entry.name, reason: 'target-exists' })
      continue
    } catch {
      /* free */
    }
    try {
      await rename(join(from, entry.name), target)
    } catch (err) {
      if (err && err.code === 'EXDEV') {
        await copyTree(join(from, entry.name), target)
        await rm(join(from, entry.name), { recursive: true, force: true })
      } else {
        skipped.push({ name: entry.name, reason: String((err && err.code) || err) })
        continue
      }
    }
    moved.push(entry.name)
  }
  return { moved, skipped, from, to }
}

/**
 * The folders that could hold the library, one level at a time.
 *
 * The panel browses with this because a browser cannot hand a native absolute
 * path back to the host: an `<input type="file">` yields a relative name, and
 * there is no directory picker at all. No path means the roots of this machine
 * (the drives on Windows, `/` elsewhere); a path lists that folder's
 * sub-folders. Only directories are listed — a library root is a directory —
 * and `parent`/`home` are offered as shortcuts, since the interesting places
 * (a Documents folder, the home directory) are rarely at the top.
 */
export async function listFolders(raw) {
  const asked = typeof raw === 'string' ? raw.trim() : ''
  if (!asked) {
    if (process.platform !== 'win32') {
      return { path: '', parent: null, home: homedir(), items: [{ name: '/', path: '/' }] }
    }
    const drives = []
    for (let code = 65; code <= 90; code += 1) {
      const at = `${String.fromCharCode(code)}:\\`
      try {
        const info = await stat(at)
        if (info.isDirectory()) drives.push({ name: at, path: at })
      } catch {
        /* a letter with no drive behind it */
      }
    }
    return { path: '', parent: null, home: homedir(), items: drives }
  }

  const at = resolve(asked)
  const info = await stat(at).catch(() => null)
  if (!info || !info.isDirectory()) {
    const err = new Error(`${at} is not a folder`)
    err.status = 400
    err.code = 'bad-path'
    throw err
  }
  const entries = await readdir(at, { withFileTypes: true })
  const items = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ name: entry.name, path: join(at, entry.name) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh'))
  const up = dirname(at)
  return { path: at, parent: up === at ? null : up, home: homedir(), items }
}

/** Characters Windows/Node refuse in a path segment, plus leading/trailing dots. */
const ILLEGAL = /[\\/:*?"<>|\u0000-\u001f]/g

export function slugify(title) {
  const base = String(title ?? '')
    .replace(ILLEGAL, '')
    .replace(/\s+/g, '-')
    .replace(/^[.\-]+|[.\-]+$/g, '')
    .slice(0, 64)
  return base || 'untitled'
}

/** Unique directory name inside `root`: slug, then slug-2, slug-3, … */
async function uniqueId(root, title) {
  const base = slugify(title)
  for (let n = 1; n < 1000; n += 1) {
    const id = n === 1 ? base : `${base}-${n}`
    try {
      await stat(join(root, id))
    } catch {
      return id
    }
  }
  return `${base}-${Date.now()}`
}

/** Write through a sibling temp file, then rename — readers never see a partial file. */
export async function atomicWrite(file, text) {
  await mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`
  await writeFile(tmp, text, 'utf8')
  try {
    await rename(tmp, file)
  } catch (err) {
    await rm(tmp, { force: true })
    throw err
  }
}

export async function readYamlFile(file, fallback = null) {
  try {
    const text = await readFile(file, 'utf8')
    const value = parseYaml(text)
    return value === null || value === undefined ? fallback : value
  } catch (err) {
    if (err && err.code === 'ENOENT') return fallback
    throw err
  }
}

export function writeYamlFile(file, value) {
  return atomicWrite(file, stringifyYaml(value, { lineWidth: 0 }))
}

/** Every directory the studio expects inside one book. */
const BOOK_DIRS = [
  'characters',
  'world',
  'world/locations',
  'world/factions',
  'world/items',
  'world/races',
  'world/cultures',
  'outline',
  'outline/scenes',
  'panels',
  'panels/custom',
  'chapters',
  'meta',
  'drafts',
  'materials',
  'publish',
]

/** Seed files, so a fresh book is readable rather than a pile of empty folders. */
const SEED_FILES = {
  'relationships.yaml': { schemaVersion: SCHEMA_VERSION, edges: [] },
  'world/rules.yaml': { schemaVersion: SCHEMA_VERSION, rules: [] },
  'world/glossary.yaml': { schemaVersion: SCHEMA_VERSION, terms: [] },
  'world/economy.yaml': { schemaVersion: SCHEMA_VERSION, currencies: [], prices: [] },
  'world/timeline.yaml': { schemaVersion: SCHEMA_VERSION, events: [] },
  'outline/tree.yaml': { schemaVersion: SCHEMA_VERSION, arcs: [] },
  'outline/threads.yaml': { schemaVersion: SCHEMA_VERSION, threads: [] },
  'outline/foreshadowing.yaml': { schemaVersion: SCHEMA_VERSION, items: [] },
  'outline/beats.yaml': { schemaVersion: SCHEMA_VERSION, beats: [] },
  'outline/hooks.yaml': { schemaVersion: SCHEMA_VERSION, hooks: [] },
  'panels/status.yaml': { schemaVersion: SCHEMA_VERSION, fields: [] },
  'panels/skills.yaml': { schemaVersion: SCHEMA_VERSION, categories: [], skills: [] },
  'panels/equipment.yaml': { schemaVersion: SCHEMA_VERSION, slots: [], items: [] },
  'panels/tasks.yaml': { schemaVersion: SCHEMA_VERSION, tasks: [] },
  'panels/reputation.yaml': { schemaVersion: SCHEMA_VERSION, factions: [] },
}

export function blankBook(title, extra = {}) {
  const now = new Date().toISOString()
  return {
    schemaVersion: SCHEMA_VERSION,
    title: String(title ?? '').trim() || '未命名作品',
    author: String(extra.author ?? '').trim(),
    genre: String(extra.genre ?? '').trim(),
    tags: Array.isArray(extra.tags) ? extra.tags.map(String) : [],
    logline: String(extra.logline ?? '').trim(),
    createdAt: now,
    updatedAt: now,
  }
}

/** Create `<root>/<id>/` with the full scaffold. Throws if `root` is unusable. */
export async function createBook(root, input = {}) {
  const title = String(input.title ?? '').trim()
  if (!title) {
    const err = new Error('title is required')
    err.status = 400
    throw err
  }

  await mkdir(root, { recursive: true })
  const id = await uniqueId(root, title)
  const dir = join(root, id)

  await mkdir(dir, { recursive: true })
  for (const d of BOOK_DIRS) await mkdir(join(dir, d), { recursive: true })

  const book = { id, ...blankBook(title, input) }
  await writeYamlFile(join(dir, 'book.yaml'), book)
  await writeYamlFile(join(dir, 'settings.yaml'), { schemaVersion: SCHEMA_VERSION, theme: 'default' })
  for (const [rel, seed] of Object.entries(SEED_FILES)) {
    await writeYamlFile(join(dir, rel), seed)
  }

  return { ...book, dir }
}

/** `<root>/<id>/book.yaml`, with the live on-disk path attached. */
export async function readBook(root, id) {
  const safe = slugify(id)
  if (safe !== String(id)) {
    const err = new Error(`invalid book id: ${id}`)
    err.status = 400
    throw err
  }
  const dir = join(root, safe)
  const book = await readYamlFile(join(dir, 'book.yaml'))
  if (!book) {
    const err = new Error(`no such book: ${id}`)
    err.status = 404
    throw err
  }
  return { id: safe, ...book, dir }
}

async function countFiles(dir, ext) {
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    return entries.filter((e) => e.isFile() && (!ext || e.name.endsWith(ext))).length
  } catch {
    return 0
  }
}

/** Per-section tallies used by the overview panel. */
export async function bookCounts(dir) {
  const [characters, chapters, locations, factions, scenes, materials, drafts] = await Promise.all([
    countFiles(join(dir, 'characters'), '.yaml'),
    countFiles(join(dir, 'chapters'), '.md'),
    countFiles(join(dir, 'world', 'locations'), '.yaml'),
    countFiles(join(dir, 'world', 'factions'), '.yaml'),
    countFiles(join(dir, 'outline', 'scenes'), '.yaml'),
    countFiles(join(dir, 'materials')),
    countFiles(join(dir, 'drafts')),
  ])
  return { characters, chapters, locations, factions, scenes, materials, drafts }
}

/** Backfill a missing `id` (books created by hand) without touching mtime ordering. */
export async function listBooks(root) {
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch (err) {
    if (err && err.code === 'ENOENT') return []
    throw err
  }

  const books = []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const dir = join(root, entry.name)
    const book = await readYamlFile(join(dir, 'book.yaml'))
    if (!book) continue
    books.push({
      id: entry.name,
      title: book.title || entry.name,
      author: book.author || '',
      genre: book.genre || '',
      logline: book.logline || '',
      tags: Array.isArray(book.tags) ? book.tags : [],
      updatedAt: book.updatedAt || book.createdAt || '',
      dir,
    })
  }

  books.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)) || a.id.localeCompare(b.id))
  return books
}

/** Shallow merge into `book.yaml`; unknown keys pass through, `id` is not writable. */
export async function updateBook(root, id, patch = {}) {
  const book = await readBook(root, id)
  const next = { ...book, ...patch, id: book.id, updatedAt: new Date().toISOString() }
  await writeYamlFile(join(book.dir, 'book.yaml'), next)
  return next
}

// ── settings.yaml ─────────────────────────────────────────────────────────
//
// Per-book preferences (word goal, panel bits) live here, next to book.yaml but
// separate from it: book.yaml is what the shelf shows, settings.yaml is how this
// one book is worked on. Same shallow-merge rule, same unknown-key pass-through,
// so a setting an extension invents survives every later write.

export async function readSettings(dir) {
  const data = await readYamlFile(join(dir, 'settings.yaml'), null)
  return data && typeof data === 'object' && !Array.isArray(data) ? data : {}
}

/** Merge a patch into `settings.yaml` and return the merged document. */
export async function updateSettings(dir, patch = {}) {
  const current = await readSettings(dir)
  const next = { ...current, ...normalizeSettings(patch) }
  if (next.schemaVersion === undefined) next.schemaVersion = SCHEMA_VERSION
  await writeYamlFile(join(dir, 'settings.yaml'), next)
  return next
}

/** What a book gets before anyone changes anything. */
export const SETTING_DEFAULTS = { theme: 'default', autosave: true, fontSize: 15 }

const THEMES = new Set(['default', 'sepia', 'dark'])

function badSetting(message) {
  const err = new Error(message)
  err.status = 400
  return err
}

/**
 * Validate the settings the panel exposes.
 *
 * Only known keys are checked; anything else is passed through untouched, so an
 * extension can keep its own preference in this file without editing this list.
 */
export function normalizeSettings(patch = {}) {
  const next = { ...(patch || {}) }
  if ('theme' in next) {
    const theme = String(next.theme ?? '').trim()
    if (!THEMES.has(theme)) throw badSetting(`未知主题：${theme}（可选 ${[...THEMES].join('/')}）`)
    next.theme = theme
  }
  if ('autosave' in next) {
    if (typeof next.autosave !== 'boolean') throw badSetting('autosave 需要 true 或 false')
  }
  if ('fontSize' in next) {
    const size = Number(next.fontSize)
    if (!Number.isFinite(size) || size < 11 || size > 24) throw badSetting('fontSize 需要在 11 和 24 之间')
    next.fontSize = Math.round(size)
  }
  if ('wordGoal' in next) {
    const goal = Number(next.wordGoal)
    if (!Number.isFinite(goal) || goal < 0) throw badSetting('wordGoal 需要是非负数字')
    next.wordGoal = Math.floor(goal)
  }
  return next
}

// ── recycle bin ─────────────────────────────────────────────────────────
//
// Deleting a book never destroys it: the folder is renamed into `<root>/.trash`,
// a dot-folder the shelf listing skips (it already skips dot-directories) and
// that a library move carries along like every other directory. Each entry is
// `<original id>__ts<epoch ms>`, so the same name can be deleted twice and both
// copies stay distinguishable; the parsed front half is what a restore puts back.

const TRASH_DIR = '.trash'

const TRASH_ENTRY = /^(.*)__ts(\d+)(?:-\d+)?$/

/** A bin entry is a directory name — nothing that could walk out of .trash. */
function safeTrashEntry(entry) {
  const name = String(entry ?? '')
  if (!name || name.startsWith('.') || name.includes('/') || name.includes('\\') || name.includes('\0')) {
    const err = new Error(`invalid recycle-bin entry: ${name || '(empty)'}`)
    err.status = 400
    throw err
  }
  return name
}

/** `<root>/.trash/<entry>`, verified to be a directory that exists. */
async function trashDirOf(root, entry) {
  const name = safeTrashEntry(entry)
  const dir = join(root, TRASH_DIR, name)
  let info
  try {
    info = await stat(dir)
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      const gone = new Error(`no such recycle-bin entry: ${name}`)
      gone.status = 404
      throw gone
    }
    throw err
  }
  if (!info.isDirectory()) {
    const err = new Error(`not a recycle-bin entry: ${name}`)
    err.status = 400
    throw err
  }
  return dir
}

/** Move a book into the recycle bin — a rename, so the bytes are untouched. */
export async function deleteBook(root, id) {
  const book = await readBook(root, id)
  const bin = join(root, TRASH_DIR)
  await mkdir(bin, { recursive: true })
  let entry = `${book.id}__ts${Date.now()}`
  for (let n = 2; ; n += 1) {
    try {
      await stat(join(bin, entry))
    } catch {
      break // free
    }
    entry = `${book.id}__ts${Date.now()}-${n}`
  }
  await rename(book.dir, join(bin, entry))
  return { id: book.id, deleted: true, trashed: entry }
}

/** What the bin holds, newest deletion first. `deletedAt` is the folder's mtime. */
export async function listTrash(root) {
  const bin = join(root, TRASH_DIR)
  let entries
  try {
    entries = await readdir(bin, { withFileTypes: true })
  } catch (err) {
    if (err && err.code === 'ENOENT') return []
    throw err
  }
  const out = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const at = await stat(join(bin, entry.name))
    const m = TRASH_ENTRY.exec(entry.name)
    out.push({
      id: entry.name,
      name: (m && m[1]) || entry.name,
      deletedAt: new Date(at.mtimeMs).toISOString(),
    })
  }
  out.sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt)))
  return out
}

/**
 * Put a binned book back on the shelf under its original name.
 *
 * A name that was taken in the meantime (the book was recreated) gets the same
 * `-2`, `-3` suffix a fresh book would — restoring must never overwrite a live
 * book that happened to reuse the folder name.
 */
export async function restoreTrash(root, entry) {
  const source = await trashDirOf(root, entry)
  const m = TRASH_ENTRY.exec(safeTrashEntry(entry))
  const base = (m && m[1]) || String(entry)
  let target = base
  for (let n = 2; ; n += 1) {
    try {
      await stat(join(root, target))
    } catch {
      break // free
    }
    target = `${base}-${n}`
  }
  await rename(source, join(root, target))
  if (target !== base) {
    // The folder was renamed with a suffix, so book.yaml's own `id` has to
    // follow it: readBook lets a stored id win over the folder name, and a
    // stale one would 404 on the very next request for this book.
    const yamlPath = join(root, target, 'book.yaml')
    const yaml = await readYamlFile(yamlPath)
    if (yaml) await writeYamlFile(yamlPath, { ...yaml, id: target })
  }
  return { id: target, restored: true }
}

/** For good. The bin exists precisely so this click stays rare. */
export async function purgeTrash(root, entry) {
  const source = await trashDirOf(root, entry)
  await rm(source, { recursive: true, force: true })
  return { id: String(entry), purged: true }
}
