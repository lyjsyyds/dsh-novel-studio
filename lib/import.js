// dsh-novel-studio — bringing text in.
//
// Two entry points, one purpose: a manuscript that already exists somewhere
// else must be able to become a book here without retyping.
//
//   importBackup   consumes the JSON that `novel_export` writes (format
//                  `novel-studio/book`) — chapters, records, doc lists and
//                  materials all travel in one file.
//   importMarkdown splits a plain manuscript into chapters on its headings.
//
// Both can run in dry-run mode so the panel can show what *would* be written
// before anything lands. `replace` is the only destructive option and it is
// never implied: the caller has to ask for it explicitly.

const V = new URL(import.meta.url).searchParams.get('v') ?? '0'

const { readYamlFile, writeYamlFile, createBook, updateBook, slugify } = await import(`./library.js?v=${V}`)
const { listUnit, writeUnit, deleteUnit, countWords } = await import(`./records.js?v=${V}`)
const { getSchema } = await import(`./schema.js?v=${V}`)
const { readdir, readFile } = await import('node:fs/promises')
const { join } = await import('node:path')

export const BACKUP_FORMAT = 'novel-studio/book'
export const BACKUP_VERSION = 1
export const MAX_IMPORT_BYTES = 8 * 1024 * 1024

/** Kinds that carry content; `drafts` is deliberately not one of them. */
const CONTENT_KINDS = new Set(['records', 'doc', 'chapters', 'files', 'raw'])

function bad(message, status = 400) {
  const err = new Error(message)
  err.status = status
  return err
}

function tooBig(text) {
  return Buffer.byteLength(String(text ?? ''), 'utf8') > MAX_IMPORT_BYTES
}

/** Resolve a backup key (`characters`, `world/locations`) to its schema unit. */
async function unitFor(key) {
  const schema = await getSchema()
  const parts = String(key || '').split('/').filter(Boolean)
  if (!parts.length) return null
  const section = schema.byKey.get(parts[0])
  if (!section) return null
  if (parts.length === 1) return section.kind === 'groups' ? null : section
  const group = (section.groups || []).find((g) => g.key === parts[1])
  return group || null
}

// ── reading a backup ──────────────────────────────────────────────────────

/** Parse and sanity-check the JSON a `novel_export` call produced. */
export function parseBackup(raw) {
  if (tooBig(raw)) throw bad('备份文件太大（上限 8 MB）', 413)
  let doc
  try {
    doc = JSON.parse(String(raw ?? ''))
  } catch (err) {
    throw bad(`不是有效的 JSON：${err.message}`)
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw bad('备份内容不是一个对象')
  if (doc.format !== BACKUP_FORMAT) throw bad(`这不是本插件导出的整书备份（format=${doc.format ?? '缺少'}）`)
  const version = Number(doc.version) || 0
  if (version > BACKUP_VERSION) throw bad(`备份版本 ${version} 比本插件认识的新（支持到 ${BACKUP_VERSION}）`)
  const chapters = Array.isArray(doc.chapters) ? doc.chapters : []
  const data = doc.data && typeof doc.data === 'object' && !Array.isArray(doc.data) ? doc.data : {}
  return {
    version,
    book: doc.book && typeof doc.book === 'object' ? doc.book : {},
    stats: doc.stats && typeof doc.stats === 'object' ? doc.stats : {},
    exportedAt: doc.exportedAt || null,
    chapters: chapters.filter((c) => c && c.id),
    data,
  }
}

/** A one-screen summary, for the confirm step. */
export async function describeBackup(raw) {
  const backup = parseBackup(raw)
  const sections = []
  for (const [key, value] of Object.entries(backup.data)) {
    const unit = await unitFor(key)
    const items = Array.isArray(value) ? value.length : value && typeof value === 'object' ? 0 : 1
    sections.push({
      key,
      kind: unit?.kind || null,
      zh: unit?.zh || key,
      items,
      restorable: unit ? CONTENT_KINDS.has(unit.kind) && unit.key !== 'drafts' : false,
      note: value && typeof value === 'object' && !Array.isArray(value) && value.error ? String(value.error) : '',
    })
  }
  return {
    ok: true,
    book: { title: backup.book.title || '', author: backup.book.author || '', id: backup.book.id || '' },
    version: backup.version,
    exportedAt: backup.exportedAt,
    chapters: backup.chapters.length,
    words: backup.stats.words ?? backup.chapters.reduce((sum, c) => sum + (Number(c.words) || 0), 0),
    sections,
  }
}

// ── writing a backup back ─────────────────────────────────────────────────

/**
 * Restore a backup into an existing book.
 *
 * @param raw  the JSON text
 * @param options { mode: 'merge'|'replace', dryRun, sections: [key] }
 *
 * `merge` keeps everything the backup does not mention; `replace` removes the
 * entries a restored section does not contain, so the book ends up matching the
 * backup. Chapters are always restored by id, so re-importing the same backup
 * is idempotent.
 */
export async function importBackup(bookDir, raw, options = {}) {
  const backup = parseBackup(raw)
  const mode = options.mode === 'replace' ? 'replace' : 'merge'
  const dryRun = options.dryRun === true
  const only = Array.isArray(options.sections) && options.sections.length ? new Set(options.sections.map(String)) : null

  const warnings = []
  const sections = []
  let written = 0

  // Chapters first: they are the reason anyone restores a backup.
  const chaptersUnit = await unitFor('chapters')
  if (chaptersUnit && (!only || only.has('chapters'))) {
    let n = 0
    for (const chapter of backup.chapters) {
      const id = String(chapter.id)
      const payload = { ...(chapter.meta || {}), body: String(chapter.body ?? '') }
      if (!dryRun) await writeUnit(bookDir, chaptersUnit, id, payload)
      n += 1
    }
    if (mode === 'replace' && !dryRun) {
      const { items } = await listUnit(bookDir, chaptersUnit)
      const keep = new Set(backup.chapters.map((c) => String(c.id)))
      for (const item of items) {
        if (!keep.has(String(item.id))) await deleteUnit(bookDir, chaptersUnit, String(item.id))
      }
    }
    written += n
    sections.push({ key: 'chapters', kind: 'chapters', zh: '章节', written: n, removed: 0, skipped: 0 })
  }

  for (const [key, value] of Object.entries(backup.data)) {
    if (only && !only.has(key)) continue
    // Chapters travel in the top-level array; a files unit that is not content
    // (the draft box) is deliberately left alone.
    if (key === 'chapters') continue
    const unit = await unitFor(key)
    if (!unit) {
      warnings.push(`跳过未知分区：${key}`)
      continue
    }
    if (!CONTENT_KINDS.has(unit.kind)) {
      warnings.push(`跳过只读分区：${key}`)
      continue
    }
    if (unit.key === 'drafts' || /(^|\/)drafts$/.test(key)) {
      warnings.push('草稿箱不参与恢复（快照容易覆盖，宁可留着）')
      continue
    }
    if (value && typeof value === 'object' && !Array.isArray(value) && value.error) {
      warnings.push(`${key} 在备份里就是读取失败的，跳过`)
      continue
    }

    let n = 0
    let skipped = 0
    let removed = 0

    if (unit.kind === 'records') {
      const list = Array.isArray(value) ? value : []
      for (const item of list) {
        const id = String(item?.id ?? item?.name ?? '').trim()
        if (!id) {
          skipped += 1
          continue
        }
        if (!dryRun) await writeUnit(bookDir, unit, id, item)
        n += 1
      }
      if (mode === 'replace' && !dryRun) {
        const { items } = await listUnit(bookDir, unit)
        const keep = new Set(list.map((i) => String(i?.id ?? i?.name ?? '')))
        for (const item of items) {
          if (!keep.has(String(item.id))) {
            await deleteUnit(bookDir, unit, String(item.id))
            removed += 1
          }
        }
      }
    } else if (unit.kind === 'doc') {
      const list = Array.isArray(value) ? value : []
      if (!dryRun) {
        const doc = await readYamlFile(join(bookDir, unit.path), {})
        const next = mode === 'replace' ? list : [...(Array.isArray(doc?.[unit.listKey]) ? doc[unit.listKey] : []), ...list]
        await writeYamlFile(join(bookDir, unit.path), { ...doc, [unit.listKey]: next })
      }
      n = list.length
    } else if (unit.kind === 'files') {
      const list = Array.isArray(value) ? value : []
      for (const entry of list) {
        const name = String(entry?.id ?? entry?.name ?? '').trim()
        if (!name) {
          skipped += 1
          continue
        }
        if (typeof entry?.text !== 'string') {
          // Backups written before file bodies travelled in the JSON only carry
          // { id, size, mtime }; there is nothing to restore from those.
          skipped += 1
          continue
        }
        if (!dryRun) await writeUnit(bookDir, unit, name, { text: entry.text })
        n += 1
      }
      if (skipped && skipped === list.length && list.length) warnings.push(`${key}：这份备份只记录了文件名，没有正文，无法恢复`)
    } else if (unit.kind === 'raw') {
      const text = typeof value === 'string' ? value : ''
      if (!text.trim()) skipped += 1
      else {
        if (!dryRun) await writeUnit(bookDir, unit, undefined, { text })
        n += 1
      }
    }

    written += n
    sections.push({ key, kind: unit.kind, zh: unit.zh || key, written: n, removed, skipped })
  }

  return { ok: true, mode, dryRun, book: backup.book, chapters: backup.chapters.length, written, sections, warnings }
}

/**
 * Restore a backup as a brand-new book: the safe path when the target is not
 * obvious, and the only path when the author wants the original untouched.
 */
export async function restoreToNewBook(root, raw, options = {}) {
  const backup = parseBackup(raw)
  const title = String(options.title || backup.book.title || '恢复的书').trim()
  if (options.dryRun === true) {
    return { ok: true, dryRun: true, title, chapters: backup.chapters.length, book: backup.book }
  }
  const created = await createBook(root, { title })
  const patch = {}
  for (const field of ['author', 'genre', 'logline', 'tags', 'synopsis']) {
    if (backup.book[field] !== undefined) patch[field] = backup.book[field]
  }
  if (Object.keys(patch).length) await updateBook(root, created.id, patch)
  const report = await importBackup(created.dir, raw, { mode: 'replace' })
  return { ok: true, book: { id: created.id, title: created.title, dir: created.dir }, ...report }
}

// ── markdown manuscripts ──────────────────────────────────────────────────

const HEADING = /^(#{1,4})\s+(.+?)\s*#*\s*$/
const ORDINAL_LINE = /^第\s*([0-9]+|[零〇一二两三四五六七八九十百千]+)\s*([章回节篇卷])\s*([^\n]*)$/

/**
 * Split a manuscript on its headings.
 *
 * `# Title` / `## 第一章 名字` / a bare `第一章 名字` line all start a chapter;
 * anything before the first one is a preamble and is reported, not silently
 * dropped.
 */
export function parseMarkdownChapters(text, options = {}) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n')
  const skipTitle = String(options.skipTitle ?? '').trim()
  const chapters = []
  const preamble = []
  let current = null

  const start = (title) => {
    current = { title: title.trim(), lines: [] }
    chapters.push(current)
  }

  for (const line of lines) {
    const heading = HEADING.exec(line)
    if (heading) {
      const title = heading[2].trim()
      if (!chapters.length && skipTitle && title === skipTitle) continue // the book's own title
      start(title)
      continue
    }
    const ordinal = ORDINAL_LINE.exec(line)
    if (ordinal) {
      start(line.trim())
      continue
    }
    if (!current) preamble.push(line)
    else current.lines.push(line)
  }

  const preambleText = preamble.join('\n').trim()
  return {
    chapters: chapters.map((c) => ({ title: c.title, body: c.lines.join('\n').replace(/^\n+|\s+$/g, '') })),
    preamble: preambleText,
    count: chapters.length,
    words: chapters.reduce((sum, c) => sum + countWords(c.lines.join('\n')), 0),
  }
}

/** Strip a leading ordinal so the file name does not repeat the number twice. */
function stripOrdinal(title) {
  const m = /^第\s*(?:[0-9]+|[零〇一二两三四五六七八九十百千]+)\s*[章回节篇卷][\s\-—_:：.、]*/.exec(String(title ?? ''))
  return m ? String(title).slice(m[0].length) : String(title ?? '')
}

/** The number a heading claims, when it claims one. */
function ordinalOf(title) {
  const m = /^第\s*([0-9]+|[零〇一二两三四五六七八九十百千]+)\s*[章回节篇卷]/.exec(String(title ?? ''))
  if (!m) return null
  return /^[0-9]+$/.test(m[1]) ? Number(m[1]) : null
}

/**
 * Import a manuscript into a book's chapters.
 *
 * @param options { mode: 'append'|'replace', start, dryRun, skipTitle, confirm }
 *
 * Every new chapter keeps the heading as its `title`; the file name follows the
 * book's existing numbering style, so a later renumber is a no-op.
 */
export async function importMarkdown(bookDir, text, options = {}) {
  if (tooBig(text)) throw bad('文稿太大（上限 8 MB）', 413)
  const parsed = parseMarkdownChapters(text, options)
  if (!parsed.count) throw bad('没有找到任何章节：请在标题行（# / ## / 第N章）之间分段', 400)

  const mode = options.mode === 'replace' ? 'replace' : 'append'
  if (mode === 'replace' && options.confirm !== true) throw bad('替换整本书需要确认', 409)
  const dryRun = options.dryRun === true
  const unit = await unitFor('chapters')
  if (!unit) throw bad('这本书没有章节分区', 500)

  const { items } = await listUnit(bookDir, unit)
  // In `replace` mode the existing files are about to disappear, so their names
  // must not push the imported ones into `-2` variants.
  const taken = new Set(mode === 'replace' ? [] : items.map((i) => String(i.id)))
  const { chapterPlan, detectStyle, chapterStem } = await import(`./chapters.js?v=${V}`)
  const current = await chapterPlan(bookDir)
  const style = options.style === 'digit' || options.style === 'cn' ? options.style : detectStyle([...taken])
  const separator = typeof options.separator === 'string' ? options.separator : '-'

  // Preserve the source numbering when the headings carry it; otherwise number
  // sequentially after (or instead of) what is already there.
  const claimed = parsed.chapters.map((c) => ordinalOf(c.title)).filter((n) => n !== null)
  const useSource = claimed.length >= Math.max(1, Math.ceil(parsed.chapters.length / 2))
  let position = mode === 'replace' ? 1 : current.count + 1
  if (typeof options.start === 'number' && options.start >= 1) position = Math.trunc(options.start)

  const plan = []
  for (const chapter of parsed.chapters) {
    const wanted = useSource ? ordinalOf(chapter.title) : null
    const at = wanted ?? position
    let name = chapterStem(at, { style, separator, rest: slugify(stripOrdinal(chapter.title) || 'chapter') })
    let n = 2
    while (taken.has(name)) {
      name = chapterStem(at, { style, separator, rest: `${slugify(stripOrdinal(chapter.title) || 'chapter')}-${n}` })
      n += 1
    }
    taken.add(name)
    plan.push({ id: name, title: chapter.title, words: countWords(chapter.body) })
    if (!useSource) position = at + 1
  }

  if (!dryRun) {
    if (mode === 'replace') {
      for (const item of items) await deleteUnit(bookDir, unit, String(item.id))
    }
    for (let i = 0; i < plan.length; i += 1) {
      await writeUnit(bookDir, unit, plan[i].id, { title: plan[i].title, body: parsed.chapters[i].body })
    }
  }

  return {
    ok: true,
    mode,
    dryRun,
    style,
    count: plan.length,
    words: parsed.words,
    chapters: plan,
    removed: mode === 'replace' ? items.length : 0,
    preamble: parsed.preamble ? parsed.preamble.slice(0, 400) : '',
    preambleWords: countWords(parsed.preamble || ''),
  }
}

/** Files the panel can offer, so importing does not mean copy-pasting text. */
export async function importableFiles(bookDir) {
  const files = []
  for (const dir of ['materials', 'publish', 'import']) {
    try {
      const names = await readdir(join(bookDir, dir), { withFileTypes: true })
      for (const entry of names) {
        if (!entry.isFile() || entry.name.startsWith('.')) continue
        if (!/\.(md|markdown|txt|json)$/i.test(entry.name)) continue
        const kind = /\.json$/i.test(entry.name) ? 'backup' : 'markdown'
        files.push({ dir, name: entry.name, path: `${dir}/${entry.name}`, kind })
      }
    } catch {
      /* no such directory */
    }
  }
  files.sort((a, b) => a.path.localeCompare(b.path))
  return { files }
}

/** Directories an import may read from — never an arbitrary path. */
const IMPORT_DIRS = new Set(['materials', 'publish', 'import'])

/**
 * Import straight from a file that already lives in the book (`publish/` holds
 * the backups and exports this studio writes, so "restore that file" is the
 * common case). The path is never taken from the client: only a directory from
 * the whitelist plus a bare file name are accepted.
 */
export async function importFile(bookDir, target = {}, options = {}) {
  const dir = String(target.dir ?? '').trim()
  const name = String(target.name ?? '').trim().replace(/\\/g, '/')
  if (!IMPORT_DIRS.has(dir)) throw bad(`不能从 ${dir || '(空)'} 导入：只允许 ${[...IMPORT_DIRS].join('、')}`)
  if (!name || name.includes('/') || name.startsWith('.')) throw bad('invalid file name')
  const file = join(bookDir, dir, name)
  let text
  try {
    text = await readFile(file, 'utf8')
  } catch (err) {
    throw bad(`读不到 ${dir}/${name}：${err.code || err.message}`, 404)
  }
  const screenshot = { source: `${dir}/${name}`, bytes: Buffer.byteLength(text, 'utf8') }
  if (/\.json$/i.test(name)) {
    if (options.describe === true) return { ...screenshot, ...(await describeBackup(text)) }
    return { ...screenshot, ...(await importBackup(bookDir, text, { mode: options.mode, dryRun: options.dryRun !== false })) }
  }
  return { ...screenshot, ...(await importMarkdown(bookDir, text, options)) }
}
