// dsh-novel-studio — 读者模拟 (reader simulation) reports.
//
// One report per chapter: the four 0-10 numbers a simulated reader gave it, the
// expectation it formed, and the raw answer behind them. They live in
// reader/reports.yaml so the curve survives a reload, the same chapter is never
// paid for twice by accident, and the assistant can read the reactions without
// spending another call.

import { join } from 'node:path'

const V = new URL(import.meta.url).searchParams.get('v') ?? '0'
const { readYamlFile, writeYamlFile } = await import(`./library.js?v=${V}`)

export const READER_DIR = 'reader'
export const READER_FILE = 'reader/reports.yaml'

/** The four numbers the curve is drawn from. */
export const SCORE_KEYS = ['tension', 'fun', 'curiosity', 'immersion']

/** The prose fields a report keeps verbatim. */
export const TEXT_KEYS = ['expectation', 'highlight', 'drop', 'poison', 'hook']

/** Chinese label → field. The task asks the model for exactly these labels. */
const FIELDS = {
  紧张度: 'tension',
  爽感: 'fun',
  好奇心: 'curiosity',
  代入感: 'immersion',
  预期: 'expectation',
  爽点: 'highlight',
  弃书点: 'drop',
  毒点: 'poison',
  悬念: 'hook',
  tension: 'tension',
  fun: 'fun',
  curiosity: 'curiosity',
  immersion: 'immersion',
  expectation: 'expectation',
  highlight: 'highlight',
  drop: 'drop',
  poison: 'poison',
  hook: 'hook',
}

/** A "无 / none" answer means the reader found nothing there. */
export function isEmptyAnswer(value) {
  const s = String(value ?? '').trim()
  return !s || /^(无|没有|none|n\/a|无。|—|-)$/i.test(s)
}

/**
 * Read the model's checklist answer. Numbers are clamped to 0-10 — a model that
 * answers `紧张度: 11` is wrong, not a reason to break the curve — and every
 * other field is kept as written.
 */
export function parseReport(text) {
  const out = { scores: {}, expectation: '', highlight: '', drop: '', poison: '', hook: '', raw: String(text ?? '').trim() }
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const m = /^\s*(?:[-*]\s*)?\*{0,2}([^:：*]{1,10}?)\*{0,2}\s*[:：]\s*(.+?)\s*$/.exec(line)
    if (!m) continue
    const key = FIELDS[m[1].trim()]
    if (!key) continue
    const value = m[2].trim()
    if (SCORE_KEYS.includes(key)) {
      const n = Number((/(-?\d+(?:\.\d+)?)/.exec(value) || [])[1])
      if (Number.isFinite(n)) out.scores[key] = Math.max(0, Math.min(10, Math.round(n)))
    } else if (TEXT_KEYS.includes(key)) {
      out[key] = value
    }
  }
  return out
}

/** One stored report, with missing numbers defaulted rather than dropped. */
function normalizeReport(raw, chapter) {
  const id = String(raw?.chapter ?? chapter ?? '').trim()
  if (!id) return null
  const scores = {}
  for (const key of SCORE_KEYS) {
    const n = Number(raw?.scores?.[key])
    scores[key] = Number.isFinite(n) ? n : 0
  }
  const entry = { chapter: id, at: raw?.at ?? null, scores }
  for (const key of TEXT_KEYS) entry[key] = String(raw?.[key] ?? '')
  entry.raw = String(raw?.raw ?? '')
  return entry
}

/** Stored reports, oldest chapter first, plus the curve they draw. */
export async function listReports(bookDir) {
  const doc = await readYamlFile(join(bookDir, READER_FILE), {})
  const reports = (Array.isArray(doc?.reports) ? doc.reports : [])
    .map((r) => normalizeReport(r, r?.chapter))
    .filter(Boolean)
    .sort((a, b) => String(a.chapter).localeCompare(String(b.chapter), 'zh-Hans-CN', { numeric: true }))
  return { reports, curve: curveOf(reports) }
}

/** `[{ chapter, tension, fun, curiosity, immersion }]` for the chart. */
export function curveOf(reports) {
  return reports.map((r) => ({ chapter: r.chapter, ...r.scores }))
}

/** Upsert one chapter's report. A re-run replaces the earlier reading. */
export async function saveReport(bookDir, chapter, report) {
  const id = String(chapter ?? '').trim()
  if (!id) throw Object.assign(new Error('missing chapter'), { status: 400, code: 'bad-chapter' })
  const doc = (await readYamlFile(join(bookDir, READER_FILE), {})) || {}
  const list = Array.isArray(doc.reports) ? doc.reports : []
  const entry = normalizeReport({ ...report, chapter: id, at: new Date().toISOString() }, id)
  const at = list.findIndex((r) => String(r?.chapter) === id)
  if (at >= 0) list[at] = entry
  else list.push(entry)
  await writeYamlFile(join(bookDir, READER_FILE), { ...doc, reports: list })
  return { report: entry, count: list.length }
}

/** Drop one chapter's report. Nothing else in the file is touched. */
export async function deleteReport(bookDir, chapter) {
  const id = String(chapter ?? '').trim()
  const doc = (await readYamlFile(join(bookDir, READER_FILE), {})) || {}
  const list = Array.isArray(doc.reports) ? doc.reports : []
  const kept = list.filter((r) => String(r?.chapter) !== id)
  if (kept.length === list.length) {
    throw Object.assign(new Error(`没有这一章的读者报告：${id}`), { status: 404, code: 'reader-missing' })
  }
  await writeYamlFile(join(bookDir, READER_FILE), { ...doc, reports: kept })
  return { removed: id, count: kept.length }
}
