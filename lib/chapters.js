// dsh-novel-studio — chapter-set operations and the draft box.
//
// Writing *one* chapter is records.writeUnit's job. This module handles what
// touches the set as a whole, plus the snapshots that sit next to the prose:
//
//   reorder / renumber  rename files so the reading order is the numbering;
//   saveDraft / list / restore / delete  the drafts/ snapshot box.
//
// Renaming is done with `rename`, never rewrite-then-delete: the bytes of a
// chapter are never lost to a crash half-way through a renumber, and a chapter
// whose title does not change is not rewritten at all.

const V = new URL(import.meta.url).searchParams.get('v') ?? '0'

const { listUnit, readUnit, writeUnit, deleteUnit, countWords, parseFrontMatter, compareChapters } = await import(`./records.js?v=${V}`)
const { getSchema } = await import(`./schema.js?v=${V}`)

const { rename, readdir } = await import('node:fs/promises')
const { join } = await import('node:path')
const { stringify: stringifyYaml } = await import('yaml')

const CHAPTER_EXT = '.md'

function bad(message, status = 400) {
  const err = new Error(message)
  err.status = status
  return err
}

// ── ordinals ──────────────────────────────────────────────────────────────

const CN_DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九']

/** 1..9999 → 一, 十, 十一, 二十一, 一百零三 … */
export function cnOrdinal(n) {
  const num = Math.trunc(Number(n))
  if (!Number.isFinite(num) || num < 0 || num > 9999) return String(n)
  if (num < 10) return CN_DIGITS[num]
  const units = ['', '十', '百', '千']
  const digits = String(num).split('').map(Number)
  let out = ''
  let zero = false
  digits.forEach((d, i) => {
    const place = digits.length - 1 - i
    if (d === 0) {
      zero = true
      return
    }
    if (zero && out) out += '零'
    zero = false
    out += CN_DIGITS[d] + units[place]
  })
  // 十/百/千 lead with 一 in Chinese only above 十: 十, 十一, but 一百一十.
  return out.replace(/^一十/, '十')
}

/**
 * Split a chapter id into its ordinal prefix and what follows it, so a renumber
 * keeps whatever the author wrote after the number (`第一章-拾荒` → 拾荒).
 */
export function splitOrdinal(id) {
  const s = String(id ?? '')
  const m = /^第\s*([0-9]+|[零〇一二两三四五六七八九十百千]+)\s*([章回节篇卷])([\s\-—_:：.]*)(.*)$/.exec(s)
  if (!m) return { prefix: '', rest: s, separator: '', ordinal: null }
  return { prefix: m[0].slice(0, m[0].length - m[4].length), rest: m[4], separator: m[3], ordinal: m[1] }
}

/** The chapter-id stem for a position, in the book's own numbering style. */
export function chapterStem(position, { style = 'cn', width = 0, separator = '-', rest = '' } = {}) {
  const label = style === 'digit' ? String(position).padStart(width || 0, '0') : cnOrdinal(position)
  const tail = rest ? `${separator || ''}${rest}` : ''
  return `第${label}章${tail}`
}

/** Numbering style the book already uses — all digits or all Chinese. */
export function detectStyle(ids) {
  for (const id of ids) {
    const m = /^第\s*([0-9]+)\s*章/.exec(String(id))
    if (m) return 'digit'
  }
  return 'cn'
}

/** Duplicated and skipped ordinals, for the panel to show before a renumber. */
export function ordinalIssues(ids) {
  const seen = new Map()
  const dupes = []
  let max = 0
  let bare = 0
  for (const id of ids) {
    const { ordinal } = splitOrdinal(id)
    if (ordinal === null) {
      bare += 1
      continue
    }
    const n = /^[0-9]+$/.test(ordinal) ? Number(ordinal) : cnToNumber(ordinal)
    if (!Number.isFinite(n)) continue
    if (seen.has(n)) dupes.push(n)
    else seen.set(n, id)
    max = Math.max(max, n)
  }
  const gaps = []
  for (let i = 1; i <= max; i += 1) if (!seen.has(i)) gaps.push(i)
  return { dupes: [...new Set(dupes)].sort((a, b) => a - b), gaps, bare, max }
}

/** Local Chinese-numeral reader (records.js keeps its own copy private). */
function cnToNumber(text) {
  const map = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
  const units = { 十: 10, 百: 100, 千: 1000 }
  let total = 0
  let current = 0
  for (const ch of String(text)) {
    if (units[ch]) {
      total += (current || 1) * units[ch]
      current = 0
    } else if (map[ch] !== undefined) {
      current = current * 10 + map[ch]
    } else {
      return Number.NaN
    }
  }
  return total + current
}

// ── reading order ─────────────────────────────────────────────────────────

async function chaptersUnit() {
  const schema = await getSchema()
  const unit = schema.byKey.get('chapters')
  if (!unit) throw bad('this book has no chapters section', 500)
  return unit
}

/** Every chapter, in reading order, with the facts a planner needs. */
export async function chapterPlan(bookDir) {
  const unit = await chaptersUnit()
  const { items } = await listUnit(bookDir, unit)
  const ordered = [...items]
    .map((item) => ({ id: String(item.id), title: item.title || item.name || String(item.id), words: item.words ?? 0 }))
    .sort((a, b) => compareChapters(a.id, b.id))
  const issues = ordinalIssues(ordered.map((c) => c.id))
  return {
    chapters: ordered,
    count: ordered.length,
    words: ordered.reduce((sum, c) => sum + (c.words || 0), 0),
    style: detectStyle(ordered.map((c) => c.id)),
    issues,
  }
}

/**
 * Rename chapter files in two phases, so no name is ever clobbered while a
 * swap is in flight (`1↔2` would otherwise overwrite one of them).
 */
async function remapChapterFiles(bookDir, pairs) {
  if (!pairs.length) return
  const stamp = Date.now().toString(36)
  const staged = pairs.map((p, i) => ({ ...p, tmp: `__studio_move_${stamp}_${i}` }))
  for (const p of staged) await rename(join(bookDir, 'chapters', p.from + CHAPTER_EXT), join(bookDir, 'chapters', p.tmp + CHAPTER_EXT))
  for (const p of staged) await rename(join(bookDir, 'chapters', p.tmp + CHAPTER_EXT), join(bookDir, 'chapters', p.to + CHAPTER_EXT))
}

/** Carry the progress ledger along when chapters change file name. */
async function remapProgress(bookDir, moves) {
  if (!moves.length) return
  try {
    const mod = await import(`./progress.js?v=${V}`)
    await mod.remapChapters(bookDir, moves)
  } catch {
    /* bookkeeping is optional */
  }
}

/** Strip an ordinal prefix from a title, keeping the author's own text. */
function retitle(title, position, options) {
  const { prefix, rest } = splitOrdinal(title)
  if (!prefix) return null // the title carries no number: leave it untouched
  return chapterStem(position, { ...options, rest: rest || '' })
}

/**
 * Reassign the numbering of the current reading order.
 * @param options { start=1, style='cn'|'digit', width=0, separator='-', dryRun=false, retitle=true }
 */
export async function renumberChapters(bookDir, options = {}) {
  const start = Math.max(1, Number(options.start) || 1)
  const plan = await chapterPlan(bookDir)
  if (!plan.chapters.length) throw bad('这本书还没有章节', 400)
  const style = options.style === 'digit' || options.style === 'cn' ? options.style : plan.style
  const separator = typeof options.separator === 'string' ? options.separator : '-'
  const width = Math.max(0, Number(options.width) || 0)
  const shouldRetitle = options.retitle !== false
  const dryRun = options.dryRun === true

  const moves = []
  const retitles = []
  plan.chapters.forEach((chapter, index) => {
    const position = start + index
    const { rest } = splitOrdinal(chapter.id)
    const to = chapterStem(position, { style, width, separator, rest })
    if (to !== chapter.id) moves.push({ from: chapter.id, to })
    if (shouldRetitle && chapter.title) {
      const next = retitle(chapter.title, position, { style, width, separator })
      if (next && next !== chapter.title) retitles.push({ id: to, title: next })
    }
  })

  if (!dryRun) {
    await remapChapterFiles(bookDir, moves)
    await remapProgress(bookDir, moves)
    const unit = await chaptersUnit()
    for (const r of retitles) await writeUnit(bookDir, unit, r.id, { title: r.title })
  }
  return { ok: true, dryRun, style, separator, width, start, renamed: moves, retitled: retitles, plan: plan.chapters.length }
}

/**
 * Move the given ids into exactly this order, renumbering 1..N to match.
 * @param ids every current chapter id, in the wanted order
 */
export async function reorderChapters(bookDir, ids) {
  const wanted = Array.isArray(ids) ? ids.map(String) : []
  const plan = await chapterPlan(bookDir)
  const current = plan.chapters.map((c) => c.id)
  if (wanted.length !== current.length) throw bad(`需要 ${current.length} 个章节 id，收到 ${wanted.length} 个`, 400)
  const set = new Set(current)
  for (const id of wanted) if (!set.has(id)) throw bad(`没有这个章节：${id}`, 400)
  if (new Set(wanted).size !== wanted.length) throw bad('章节 id 重复', 400)

  const style = plan.style
  const moves = []
  wanted.forEach((id, index) => {
    const { separator, rest } = splitOrdinal(id)
    const to = chapterStem(index + 1, { style, separator: separator || '-', rest })
    if (to !== id) moves.push({ from: id, to })
  })
  await remapChapterFiles(bookDir, moves)
  await remapProgress(bookDir, moves)

  const unit = await chaptersUnit()
  const byId = new Map(plan.chapters.map((c) => [c.id, c]))
  const retitled = []
  wanted.forEach((id, index) => {
    const title = byId.get(id)?.title
    if (!title) return
    const next = retitle(title, index + 1, { style, separator: splitOrdinal(id).separator || '-' })
    if (next && next !== title) retitled.push({ id: moves.find((m) => m.from === id)?.to || id, title: next })
  })
  for (const r of retitled) await writeUnit(bookDir, unit, r.id, { title: r.title })

  return { ok: true, order: wanted, renamed: moves, retitled }
}

// ── drafts ────────────────────────────────────────────────────────────────

const DRAFT_AUTO = 'restore 前的自动快照'

function stampNow(date = new Date()) {
  const p = (n, w = 2) => String(n).padStart(w, '0')
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`
}

async function draftsUnit() {
  const schema = await getSchema()
  const unit = schema.byKey.get('drafts')
  if (!unit) throw bad('this book has no drafts section', 500)
  return unit
}

async function draftName(bookDir, chapterId, extra = '') {
  const base = `${String(chapterId).replace(/[\\/:*?"<>|]/g, '_')}.${stampNow()}${extra ? `.${extra}` : ''}`
  let name = `${base}.md`
  const dir = join(bookDir, 'drafts')
  let names = []
  try {
    names = await readdir(dir)
  } catch {
    names = []
  }
  const taken = new Set(names)
  let i = 2
  while (taken.has(name)) {
    name = `${base}-${i}.md`
    i += 1
  }
  return name
}

/** Write one snapshot. `body` defaults to the chapter as it currently stands. */
export async function saveDraft(bookDir, chapterId, payload = {}) {
  const id = String(chapterId ?? '').trim()
  if (!id) throw bad('missing chapter id', 400)
  const unit = await draftsUnit()
  let body = payload.body
  if (typeof body !== 'string') {
    const chapter = await readUnit(bookDir, await chaptersUnit(), id)
    body = chapter.data?.body ?? ''
  }
  const at = new Date().toISOString()
  const note = String(payload.note ?? '').slice(0, 200)
  const name = await draftName(bookDir, id, payload.auto ? 'auto' : '')
  const meta = { chapter: id, at, words: countWords(body), ...(note ? { note } : {}) }
  const text = `---\n${stringifyYaml(meta).trimEnd()}\n---\n\n${String(body).replace(/\s+$/, '')}\n`
  await writeUnit(bookDir, unit, name, { text })
  return { ok: true, id: name, chapter: id, at, words: meta.words, note }
}

/** The draft box, newest first, with the chapter each draft belongs to. */
export async function listDrafts(bookDir) {
  const unit = await draftsUnit()
  const { items } = await listUnit(bookDir, unit)
  const plan = await chapterPlan(bookDir).catch(() => ({ chapters: [] }))
  const titles = new Map(plan.chapters.map((c) => [c.id, c.title]))
  const drafts = []
  for (const item of items) {
    const name = String(item.id)
    try {
      const { data } = await readUnit(bookDir, unit, name)
      const { meta, body } = parseFrontMatter(String(data?.text ?? ''))
      drafts.push({
        id: name,
        chapter: meta.chapter || '',
        chapterTitle: titles.get(String(meta.chapter)) || String(meta.chapter || ''),
        at: meta.at || null,
        note: meta.note || '',
        words: countWords(body),
        size: item.size ?? 0,
        mtime: item.mtime ?? null,
      })
    } catch {
      drafts.push({ id: name, chapter: '', chapterTitle: '', at: null, note: '', words: 0, size: item.size ?? 0, mtime: item.mtime ?? null, broken: true })
    }
  }
  drafts.sort((a, b) => String(b.mtime ?? '').localeCompare(String(a.mtime ?? '')) || String(b.at ?? '').localeCompare(String(a.at ?? '')))
  return { drafts, count: drafts.length }
}

/** One draft's text, for the preview pane. */
export async function readDraft(bookDir, name) {
  const unit = await draftsUnit()
  const { data } = await readUnit(bookDir, unit, String(name))
  const { meta, body } = parseFrontMatter(String(data?.text ?? ''))
  return { id: String(name), chapter: meta.chapter || '', at: meta.at || null, note: meta.note || '', words: countWords(body), body }
}

/**
 * Put a draft back into its chapter. Without `force` this only reports the
 * conflict, so the panel can ask; with `force` the current text is snapshotted
 * as an automatic draft first, so a restore is itself undoable.
 */
export async function restoreDraft(bookDir, name, options = {}) {
  const draft = await readDraft(bookDir, name)
  if (!draft.chapter) throw bad('这份草稿没有记录它属于哪一章', 400)
  const unit = await chaptersUnit()
  const chapter = await readUnit(bookDir, unit, draft.chapter)
  const current = String(chapter.data?.body ?? '')
  if (current.trim() === draft.body.trim()) {
    return { ok: true, changed: false, chapter: draft.chapter, words: draft.words, message: '章节内容与这份草稿一致，无需恢复' }
  }
  if (options.force !== true) {
    return {
      ok: true,
      changed: false,
      conflict: true,
      chapter: draft.chapter,
      draftWords: draft.words,
      currentWords: countWords(current),
      message: '章节已在草稿之后被修改过，确认要用草稿覆盖吗',
    }
  }
  const snapshot = await saveDraft(bookDir, draft.chapter, { body: current, note: DRAFT_AUTO, auto: true })
  await writeUnit(bookDir, unit, draft.chapter, { body: draft.body })
  return { ok: true, changed: true, chapter: draft.chapter, words: draft.words, snapshot: snapshot.id, restoredFrom: draft.id }
}

export async function deleteDraft(bookDir, name) {
  const unit = await draftsUnit()
  await deleteUnit(bookDir, unit, String(name))
  return { ok: true, id: String(name) }
}
