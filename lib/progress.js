// dsh-novel-studio — writing progress.
//
// Word counts alone are cheap to recompute, but *production* is not: how many
// words were written today, this week, on each of the last thirty days. That
// needs a memory, so a save appends its delta to `progress.yaml`:
//
//   goal:     { words, deadline }        the target the author set
//   chapters: { <chapterId>: words }     last known size, for the delta
//   history:  { 'YYYY-MM-DD': words }    net words written that day
//
// The map is tiny (one line per active day), rewritten atomically on save, and
// is never allowed to fail a save: records.js treats this module as optional.
// Deleting prose counts negative — the panel shows net output, not effort.

const V = new URL(import.meta.url).searchParams.get('v') ?? '0'

const { atomicWrite, readYamlFile } = await import(`./library.js?v=${V}`)
const { listUnit, countWords } = await import(`./records.js?v=${V}`)
const { getSchema } = await import(`./schema.js?v=${V}`)

const { join } = await import('node:path')

export const PROGRESS_FILE = 'progress.yaml'
export const PROGRESS_VERSION = 1
export const HISTORY_DAYS = 30

function bad(message, status = 400) {
  const err = new Error(message)
  err.status = status
  return err
}

// ── the file ──────────────────────────────────────────────────────────────

export function dayKey(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`
}

function shiftDays(key, delta) {
  const [y, m, d] = String(key).split('-').map(Number)
  const date = new Date(y, (m || 1) - 1, d || 1)
  date.setDate(date.getDate() + delta)
  return dayKey(date)
}

export async function readProgress(bookDir) {
  const data = await readYamlFile(join(bookDir, PROGRESS_FILE), null)
  const doc = data && typeof data === 'object' && !Array.isArray(data) ? data : {}
  const goal = doc.goal && typeof doc.goal === 'object' ? doc.goal : {}
  return {
    version: Number(doc.version) || PROGRESS_VERSION,
    goal: { words: Number(goal.words) || 0, deadline: goal.deadline ? String(goal.deadline) : '' },
    chapters: doc.chapters && typeof doc.chapters === 'object' && !Array.isArray(doc.chapters) ? { ...doc.chapters } : {},
    history: doc.history && typeof doc.history === 'object' && !Array.isArray(doc.history) ? { ...doc.history } : {},
    startedAt: doc.startedAt || null,
    updatedAt: doc.updatedAt || null,
  }
}

async function writeProgress(bookDir, doc) {
  const next = { version: PROGRESS_VERSION, startedAt: doc.startedAt || new Date().toISOString(), ...doc, updatedAt: new Date().toISOString() }
  await atomicWrite(join(bookDir, PROGRESS_FILE), `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  return next
}

// ── recording ─────────────────────────────────────────────────────────────

/**
 * Record that a chapter now holds `words` words. Called from records.writeUnit
 * after a chapter lands; a no-op when nothing changed.
 */
export async function noteChapterSaved(bookDir, id, words) {
  const key = String(id)
  const now = Math.max(0, Math.trunc(Number(words) || 0))
  const doc = await readProgress(bookDir)
  const previous = Number(doc.chapters[key]) || 0
  if (previous === now && doc.startedAt) return { ok: true, changed: false }
  const delta = now - previous
  const day = dayKey()
  doc.chapters[key] = now
  if (delta !== 0) doc.history[day] = (Number(doc.history[day]) || 0) + delta
  await writeProgress(bookDir, doc)
  return { ok: true, changed: true, delta, day, words: now }
}

/** Record the removal of a chapter, so the day's net output stays truthful. */
export async function noteChapterDeleted(bookDir, id) {
  const key = String(id)
  const doc = await readProgress(bookDir)
  if (!(key in doc.chapters)) return { ok: true, changed: false }
  const previous = Number(doc.chapters[key]) || 0
  delete doc.chapters[key]
  if (previous !== 0) {
    const day = dayKey()
    doc.history[day] = (Number(doc.history[day]) || 0) - previous
  }
  await writeProgress(bookDir, doc)
  return { ok: true, changed: true, delta: -previous }
}

/**
 * Move the per-chapter bookkeeping when chapter files are renamed. Renumbering
 * must not look like "delete the old chapter, write a new one": that would
 * double-count the prose into today's history.
 */
export async function remapChapters(bookDir, pairs) {
  const list = Array.isArray(pairs) ? pairs : []
  if (!list.length) return { ok: true, changed: 0 }
  const doc = await readProgress(bookDir)
  let changed = 0
  for (const pair of list) {
    const from = String(pair?.from ?? '')
    const to = String(pair?.to ?? '')
    if (!from || !to || from === to) continue
    if (from in doc.chapters) {
      doc.chapters[to] = doc.chapters[from]
      delete doc.chapters[from]
      changed += 1
    }
  }
  if (changed) await writeProgress(bookDir, doc)
  return { ok: true, changed }
}

/** Set the word goal and/or period end. Empty values clear the field. */
export async function setGoal(bookDir, patch = {}) {
  const doc = await readProgress(bookDir)
  const words = patch.words === undefined ? doc.goal.words : Math.max(0, Math.trunc(Number(patch.words) || 0))
  let deadline = patch.deadline === undefined ? doc.goal.deadline : String(patch.deadline || '')
  if (deadline && !/^\d{4}-\d{2}-\d{2}$/.test(deadline)) throw bad('deadline 需要 YYYY-MM-DD', 400)
  doc.goal = { words, deadline }
  await writeProgress(bookDir, doc)
  return { ok: true, goal: { words, deadline } }
}

// ── the picture ───────────────────────────────────────────────────────────

/** Days from today (inclusive) to `deadline`; 0 when it is today or past. */
function daysLeft(deadline) {
  if (!deadline) return null
  const today = dayKey()
  let days = 0
  let cursor = today
  // Bounded walk: a decade is far beyond any real deadline.
  for (let i = 0; i < 3650; i += 1) {
    if (cursor >= deadline) return days
    cursor = shiftDays(cursor, 1)
    days += 1
  }
  return days
}

export async function progressFor(bookDir) {
  const doc = await readProgress(bookDir)
  const schema = await getSchema()
  const unit = schema.byKey.get('chapters')
  let chapters = []
  if (unit) {
    const { items } = await listUnit(bookDir, unit)
    chapters = items.map((item) => ({ id: String(item.id), title: item.title || item.name || String(item.id), words: item.words ?? 0 }))
  }
  const done = chapters.reduce((sum, c) => sum + (Number(c.words) || 0), 0)
  const empty = chapters.filter((c) => !(Number(c.words) > 0)).length
  const longest = chapters.reduce((max, c) => (c.words > (max?.words ?? 0) ? c : max), null)

  const today = dayKey()
  const days = []
  for (let i = HISTORY_DAYS - 1; i >= 0; i -= 1) {
    const key = shiftDays(today, -i)
    days.push({ date: key, words: Number(doc.history[key]) || 0 })
  }
  const todayWords = days[days.length - 1].words
  const week = days.slice(-7)
  const weekTotal = week.reduce((sum, d) => sum + d.words, 0)
  const trackedTotal = days.reduce((sum, d) => sum + d.words, 0)
  const activeDays = days.filter((d) => d.words !== 0).length

  // Streak counts back from today; a day without a save breaks it.
  let streak = 0
  for (let i = days.length - 1; i >= 0; i -= 1) {
    if (days[i].words > 0) streak += 1
    else if (i === days.length - 1) continue // today may simply not have started yet
    else break
  }

  const goal = doc.goal.words
  const remaining = goal > 0 ? Math.max(0, goal - done) : 0
  const percent = goal > 0 ? Math.min(100, Math.round((done / goal) * 1000) / 10) : 0
  const left = daysLeft(doc.goal.deadline)
  const perDayNeeded = goal > 0 && left ? Math.ceil(remaining / Math.max(1, left)) : null
  const avg7 = weekTotal / 7
  const projectedDays = avg7 > 0 ? Math.ceil(remaining / avg7) : null

  return {
    ok: true,
    goal: { words: goal, deadline: doc.goal.deadline },
    done,
    remaining,
    percent,
    chapters: { count: chapters.length, empty, longest: longest ? { id: longest.id, title: longest.title, words: longest.words } : null, average: chapters.length ? Math.round(done / chapters.length) : 0 },
    today: todayWords,
    week: weekTotal,
    trackedTotal,
    activeDays,
    streak,
    average: { day7: Math.round(avg7), active: activeDays ? Math.round(trackedTotal / activeDays) : 0 },
    pace: { daysLeft: left, perDayNeeded, projectedDays, projectedFinish: projectedDays !== null ? shiftDays(today, projectedDays) : null },
    history: days,
    tracked: { since: doc.startedAt, updatedAt: doc.updatedAt, known: Object.keys(doc.chapters).length },
  }
}

/** Exported for the tests: the summary shape is the contract the panel reads. */
export { shiftDays as shiftDayKey }
