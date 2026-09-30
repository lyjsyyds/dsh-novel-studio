// dsh-novel-studio — generic record I/O.
//
// Every section kind is read and written through here. The client never sends a
// filesystem path: it sends a (sectionKey, groupKey, id) triple, and the schema
// decides where that lands. Nothing outside a book directory is reachable.
//
// Imported by api.js with the same cache-busting token, so library.js is shared
// rather than loaded twice.

import { readdir, stat, unlink, readFile } from 'node:fs/promises'
import { join, basename, extname } from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

const V = new URL(import.meta.url).searchParams.get('v') ?? '0'

const { atomicWrite, readYamlFile, writeYamlFile, slugify } = await import(`./library.js?v=${V}`)

/** Extensions the client may edit as text in the materials browser. */
const TEXT_EXT = new Set(['.md', '.markdown', '.txt', '.yaml', '.yml', '.json', '.csv', '.html', '.css', '.js'])

const MAX_TEXT_BYTES = 1024 * 1024

function bad(message, status = 400) {
  const err = new Error(message)
  err.status = status
  return err
}

/** A record id is a filename stem — never a path. */
function safeId(id) {
  const s = String(id ?? '').trim()
  if (!s) throw bad('missing id')
  if (s.includes('/') || s.includes('\\') || s.includes('..') || s.startsWith('.')) throw bad('invalid id')
  if (s.length > 120) throw bad('id too long')
  return s
}

/** One level of subdirectory is allowed in the materials browser, nothing more. */
function safeRelName(name) {
  const s = String(name ?? '').trim().replace(/\\/g, '/')
  const parts = s.split('/').filter(Boolean)
  if (!parts.length || parts.length > 2) throw bad('invalid file name')
  for (const p of parts) {
    if (p === '.' || p === '..' || p.startsWith('.')) throw bad('invalid file name')
    if (/[\\/:*?"<>|\u0000-\u001f]/.test(p)) throw bad('invalid file name')
  }
  return parts.join('/')
}

// ── front matter (chapters) ───────────────────────────────────────────────

export function parseFrontMatter(text) {
  const src = String(text ?? '')
  if (!src.startsWith('---')) return { meta: {}, body: src }
  const close = src.indexOf('\n---', 3)
  if (close === -1) return { meta: {}, body: src }
  const head = src.slice(4, close + 1)
  // The serializer emits `---\n<head>\n---\n\n<body>`. Drop the delimiter's own
  // newline and then the blank separator line, so parse∘serialize is identity.
  let tail = src.slice(close + 4)
  tail = tail.replace(/^\r?\n/, '')
  tail = tail.replace(/^[ \t]*\r?\n/, '')
  let meta = {}
  try {
    meta = parseYaml(head) || {}
  } catch {
    meta = {}
  }
  if (typeof meta !== 'object' || Array.isArray(meta)) meta = {}
  return { meta, body: tail }
}

/**
 * Word count for prose. Every CJK ideograph is one word; a run of latin letters
 * or digits is one word. This is the single definition — the chapter list, the
 * export summary and the validator all have to agree on it.
 */
export function countWords(text) {
  return (String(text ?? '').match(/[\u4e00-\u9fff]|[A-Za-z0-9]+/g) || []).length
}

function withFrontMatter(meta, body) {
  const clean = {}
  for (const [k, v] of Object.entries(meta || {})) {
    if (v === undefined || v === null || v === '') continue
    clean[k] = v
  }
  const head = stringifyYaml(clean, { lineWidth: 0 }).trimEnd()
  const text = String(body ?? '').replace(/^\s*\n/, '')
  return `---\n${head}\n---\n\n${text}`
}

// ── sorting ───────────────────────────────────────────────────────────────

const collator = new Intl.Collator('zh-Hans-CN', { numeric: true, sensitivity: 'base' })

function sortNames(names) {
  return names.slice().sort(collator.compare)
}

// ── chapter order ─────────────────────────────────────────────────────────
//
// Plain pinyin collation reads 第二章 before 第一章 (èr sorts before yī), which
// would export a manuscript out of order. So chapters sort by the ordinal in
// their name first — Arabic or Chinese numerals — and only then by collation.

const CN_DIGIT = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
const CN_UNIT = { 十: 10, 百: 100, 千: 1000 }

/** "一十二" → 12, "二十" → 20, "一百零五" → 105. Null when it is not a number. */
function cnNumber(text) {
  let section = 0
  let digit = 0
  let seen = false
  for (const ch of text) {
    if (ch in CN_DIGIT) {
      digit = CN_DIGIT[ch]
      seen = true
      continue
    }
    const unit = CN_UNIT[ch]
    if (unit === undefined) return null
    section += (digit || 1) * unit
    digit = 0
    seen = true
  }
  return seen ? section + digit : null
}

const CN_NUM = '零〇一二两三四五六七八九十百千'
const CHAPTER_ORDINAL = [
  new RegExp(`^第\\s*([0-9]+|[${CN_NUM}]+)\\s*[章回节篇卷]`),
  new RegExp(`^([${CN_NUM}]+)\\s*[、.，:：]`),
  /^([0-9]+)\s*[.、，,：:—_-]/,
  /^([0-9]+)$/,
]

/**
 * The reading position implied by a chapter name, or Infinity when the name
 * carries no ordinal at all (a bare title sorts after the numbered ones).
 */
export function chapterOrder(name) {
  const s = String(name ?? '')
  for (const re of CHAPTER_ORDINAL) {
    const m = re.exec(s)
    if (!m) continue
    const n = /^[0-9]+$/.test(m[1]) ? Number(m[1]) : cnNumber(m[1])
    if (typeof n === 'number' && Number.isFinite(n)) return n
  }
  const lead = /^([0-9]+)/.exec(s)
  return lead ? Number(lead[1]) : Number.POSITIVE_INFINITY
}

/** Reading order: ordinal first, then collation for names sharing one. */
export function compareChapters(a, b) {
  const na = chapterOrder(a)
  const nb = chapterOrder(b)
  if (na !== nb && Number.isFinite(na) && Number.isFinite(nb)) return na - nb
  if (Number.isFinite(na) !== Number.isFinite(nb)) return Number.isFinite(na) ? -1 : 1
  return collator.compare(String(a), String(b))
}

// ── unit dispatch ─────────────────────────────────────────────────────────

function unitDir(bookDir, unit) {
  return join(bookDir, unit.dir)
}

/**
 * List everything in a unit.
 * @returns {Promise<{ items: any[], extra?: any }>}
 */
export async function listUnit(bookDir, unit) {
  switch (unit.kind) {
    case 'records': {
      const dir = unitDir(bookDir, unit)
      let names = []
      try {
        names = (await readdir(dir)).filter((n) => n.endsWith('.yaml') || n.endsWith('.yml'))
      } catch {
        return { items: [] }
      }
      const items = []
      for (const name of sortNames(names)) {
        const data = await readYamlFile(join(dir, name), {})
        items.push({ id: basename(name, extname(name)), ...data })
      }
      return { items }
    }

    case 'doc': {
      const file = join(bookDir, unit.path)
      const doc = await readYamlFile(file, {})
      const list = Array.isArray(doc?.[unit.listKey]) ? doc[unit.listKey] : []
      return { items: list, extra: { path: unit.path, listKey: unit.listKey } }
    }

    case 'chapters': {
      const dir = unitDir(bookDir, unit)
      let names = []
      try {
        names = (await readdir(dir)).filter((n) => n.endsWith('.md'))
      } catch {
        return { items: [] }
      }
      const items = []
      const ordered = names.slice().sort((a, b) => compareChapters(basename(a, '.md'), basename(b, '.md')))
      for (const name of ordered) {
        let meta = {}
        let words = 0
        try {
          const parsed = parseFrontMatter(await readFile(join(dir, name), 'utf8'))
          meta = parsed.meta
          words = countWords(parsed.body)
        } catch {
          /* unreadable chapter still lists */
        }
        items.push({ id: basename(name, '.md'), ...meta, words })
      }
      return { items }
    }

    case 'files': {
      const dir = unitDir(bookDir, unit)
      let entries = []
      try {
        entries = await readdir(dir, { withFileTypes: true })
      } catch {
        return { items: [] }
      }
      const items = []
      for (const e of sortNames(entries.map((x) => x.name)).map((n) => entries.find((x) => x.name === n))) {
        if (e.name.startsWith('.')) continue
        if (e.isDirectory()) {
          let sub = []
          try {
            sub = await readdir(join(dir, e.name), { withFileTypes: true })
          } catch {
            continue
          }
          for (const s of sub) {
            if (s.isFile() && !s.name.startsWith('.')) {
              const st = await stat(join(dir, e.name, s.name))
              items.push({ id: `${e.name}/${s.name}`, size: st.size, mtime: st.mtimeMs })
            }
          }
          continue
        }
        if (!e.isFile()) continue
        const st = await stat(join(dir, e.name))
        items.push({ id: e.name, size: st.size, mtime: st.mtimeMs })
      }
      return { items }
    }

    case 'raw': {
      const file = join(bookDir, unit.path)
      const exists = await readYamlFile(file, null)
      return { items: [], extra: { path: unit.path, text: exists === null ? '' : stringifyYaml(exists, { lineWidth: 0 }) } }
    }

    default:
      throw bad(`unsupported unit kind: ${unit.kind}`, 500)
  }
}

/** Read one entry. `id` is ignored for kinds that hold a single document. */
export async function readUnit(bookDir, unit, id) {
  switch (unit.kind) {
    case 'records': {
      const file = join(unitDir(bookDir, unit), `${safeId(id)}.yaml`)
      const data = await readYamlFile(file, null)
      if (data === null) throw bad('not-found', 404)
      return { id: safeId(id), data }
    }

    case 'doc': {
      const list = (await listUnit(bookDir, unit)).items
      const index = Number(id)
      if (!Number.isInteger(index) || index < 0 || index >= list.length) throw bad('not-found', 404)
      return { id: String(index), data: list[index] }
    }

    case 'chapters': {
      const file = join(unitDir(bookDir, unit), `${safeId(id)}.md`)
      let text
      try {
        text = await readFile(file, 'utf8')
      } catch {
        throw bad('not-found', 404)
      }
      const { meta, body } = parseFrontMatter(text)
      return { id: safeId(id), data: { ...meta, body } }
    }

    case 'files': {
      const rel = safeRelName(id)
      const file = join(unitDir(bookDir, unit), rel)
      const st = await stat(file).catch(() => null)
      if (!st || !st.isFile()) throw bad('not-found', 404)
      const editable = TEXT_EXT.has(extname(rel).toLowerCase()) && st.size <= MAX_TEXT_BYTES
      return {
        id: rel,
        data: editable ? { text: await readFile(file, 'utf8') } : {},
        meta: { editable, size: st.size, binary: !editable },
      }
    }

    case 'raw':
      return listUnit(bookDir, unit)

    default:
      throw bad(`unsupported unit kind: ${unit.kind}`, 500)
  }
}

/** Create or update one entry. Returns the stored value. */
/**
 * Tell the progress ledger a chapter now holds this many words. Imported
 * lazily so this module stays usable without it, and swallowed on error:
 * bookkeeping must never fail a save.
 */
async function noteChapter(bookDir, id, body) {
  try {
    const mod = await import(`./progress.js?v=${V}`)
    await mod.noteChapterSaved(bookDir, id, countWords(body))
  } catch {
    /* progress is a reporting nicety */
  }
}

export async function writeUnit(bookDir, unit, id, payload) {
  switch (unit.kind) {
    case 'records': {
      const clean = safeId(id)
      const file = join(unitDir(bookDir, unit), `${clean}.yaml`)
      const current = await readYamlFile(file, {})
      const next = { ...current, ...(payload || {}) }
      delete next.id
      await writeYamlFile(file, next)
      return { id: clean, data: next }
    }

    case 'doc': {
      const file = join(bookDir, unit.path)
      const doc = await readYamlFile(file, {})
      const list = Array.isArray(doc?.[unit.listKey]) ? doc[unit.listKey].slice() : []
      const value = { ...(payload || {}) }

      if (id === undefined || id === null || id === '' || id === 'new') {
        list.push(value)
      } else {
        const index = Number(id)
        if (!Number.isInteger(index) || index < 0 || index >= list.length) throw bad('not-found', 404)
        list[index] = { ...(list[index] || {}), ...value }
      }
      await writeYamlFile(file, { ...doc, [unit.listKey]: list })
      return { items: list }
    }

    case 'chapters': {
      const clean = safeId(id)
      const file = join(unitDir(bookDir, unit), `${clean}.md`)
      const { body, ...meta } = payload || {}
      let previous = {}
      let previousBody = ''
      try {
        const parsed = parseFrontMatter(await readFile(file, 'utf8'))
        previous = parsed.meta
        previousBody = parsed.body
      } catch {
        /* new chapter */
      }
      // A metadata-only write (renumbering a title, for instance) must not wipe
      // the prose: `body` is only taken as a replacement when it was sent.
      const nextBody = body === undefined ? previousBody : body
      await atomicWrite(file, withFrontMatter({ ...previous, ...meta }, nextBody))
      await noteChapter(bookDir, clean, nextBody)
      return { id: clean, words: countWords(nextBody) }
    }

    case 'files': {
      const rel = safeRelName(id)
      const text = payload?.text
      if (typeof text !== 'string') throw bad('body must be { text: string }')
      if (Buffer.byteLength(text, 'utf8') > MAX_TEXT_BYTES) throw bad('file too large to edit', 413)
      await atomicWrite(join(unitDir(bookDir, unit), rel), text)
      return { id: rel }
    }

    case 'raw': {
      const raw = payload?.text
      if (typeof raw !== 'string') throw bad('body must be { text: string }')
      let value
      try {
        value = parseYaml(raw) ?? {}
      } catch (err) {
        throw bad(`YAML parse error: ${err.message}`)
      }
      await writeYamlFile(join(bookDir, unit.path), value)
      return { ok: true }
    }

    default:
      throw bad(`unsupported unit kind: ${unit.kind}`, 500)
  }
}

/**
 * Remove one field from an entry, leaving every sibling key alone.
 *
 * The graph needs this to break a field-derived edge: merging `{ [field]: '' }`
 * through `writeUnit` would leave an empty key behind in the reader's file.
 */
export async function clearField(bookDir, unit, id, field) {
  if (!field) throw bad('a field name is required')

  switch (unit.kind) {
    case 'records': {
      const clean = safeId(id)
      const file = join(unitDir(bookDir, unit), `${clean}.yaml`)
      const current = await readYamlFile(file, {})
      if (!(field in current)) return { id: clean, changed: false }
      const next = { ...current }
      delete next[field]
      await writeYamlFile(file, next)
      return { id: clean, changed: true }
    }

    case 'doc': {
      const file = join(bookDir, unit.path)
      const doc = await readYamlFile(file, {})
      const list = Array.isArray(doc?.[unit.listKey]) ? doc[unit.listKey].slice() : []
      const index = Number(id)
      if (!Number.isInteger(index) || index < 0 || index >= list.length) throw bad('not-found', 404)
      const next = { ...(list[index] || {}) }
      const changed = field in next
      delete next[field]
      list[index] = next
      await writeYamlFile(file, { ...doc, [unit.listKey]: list })
      return { index, changed }
    }

    default:
      throw bad(`unsupported unit kind: ${unit.kind}`, 400)
  }
}

/** Remove one entry. */
export async function deleteUnit(bookDir, unit, id) {
  switch (unit.kind) {
    case 'records': {
      const file = join(unitDir(bookDir, unit), `${safeId(id)}.yaml`)
      await unlink(file).catch((err) => {
        if (err.code === 'ENOENT') throw bad('not-found', 404)
        throw err
      })
      return { id: safeId(id) }
    }

    case 'doc': {
      const file = join(bookDir, unit.path)
      const doc = await readYamlFile(file, {})
      const list = Array.isArray(doc?.[unit.listKey]) ? doc[unit.listKey].slice() : []
      const index = Number(id)
      if (!Number.isInteger(index) || index < 0 || index >= list.length) throw bad('not-found', 404)
      list.splice(index, 1)
      await writeYamlFile(file, { ...doc, [unit.listKey]: list })
      return { items: list }
    }

    case 'chapters': {
      const clean = safeId(id)
      const file = join(unitDir(bookDir, unit), `${clean}.md`)
      await unlink(file).catch((err) => {
        if (err.code === 'ENOENT') throw bad('not-found', 404)
        throw err
      })
      await import(`./progress.js?v=${V}`)
        .then((mod) => mod.noteChapterDeleted(bookDir, clean))
        .catch(() => {})
      return { id: clean }
    }

    case 'files': {
      const rel = safeRelName(id)
      await unlink(join(unitDir(bookDir, unit), rel)).catch((err) => {
        if (err.code === 'ENOENT') throw bad('not-found', 404)
        throw err
      })
      return { id: rel }
    }

    default:
      throw bad(`cannot delete from kind: ${unit.kind}`, 405)
  }
}

/**
 * Derive a form shape from the data itself, for units that declare no `fields`.
 * This is what lets a new panel be added by an extension — or by an AI writing
 * records — without anyone declaring a schema first.
 */
export function inferFields(items) {
  const keys = []
  const seen = new Set()
  for (const item of items.slice(0, 50)) {
    for (const k of Object.keys(item || {})) {
      if (k === 'id' || k === 'words' || seen.has(k)) continue
      seen.add(k)
      keys.push(k)
    }
  }
  if (seen.size < 12) {
    for (const k of ['summary', 'description', 'notes', 'note', 'body', 'tags']) {
      if (!seen.has(k)) {
        seen.add(k)
        keys.push(k)
      }
    }
  }
  return keys.map((k) => {
    let type = 'text'
    for (const item of items) {
      const v = item?.[k]
      if (v === undefined || v === null) continue
      if (typeof v === 'boolean') type = 'boolean'
      else if (typeof v === 'number') type = 'number'
      else if (Array.isArray(v)) type = 'tags'
      else if (typeof v === 'string' && (v.length > 60 || v.includes('\n'))) type = 'textarea'
      else type = 'text'
      break
    }
    return { k, zh: k, en: k, type }
  })
}

/** A stable, human-readable id for a new entry of this unit. */
export function idForNew(unit, payload) {
  const title = payload?.[unit.titleField] || payload?.title || payload?.name || payload?.term
  return slugify(title || 'item')
}
