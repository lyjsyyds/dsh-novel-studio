// Standalone smoke test for 读者模拟 (reader simulation) — runs outside DSH
// against a throwaway root: the checklist the model returns is read into four
// 0-10 numbers plus the reader's own words, kept per chapter, replaced on a
// re-run, drawn as a curve and removed again.
import { mkdtemp, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const lib = await import(new URL('../lib/library.js', import.meta.url).href)
const rd = await import(new URL('../lib/reader.js', import.meta.url).href)
const pr = await import(new URL('../lib/prompt.js', import.meta.url).href)

const root = await mkdtemp(join(tmpdir(), 'novel-reader-smoke-'))
const log = []
const check = (name, ok, extra = '') => {
  log.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`)
  if (!ok) process.exitCode = 1
}
const boom = (fn) => fn.then(() => null, (e) => e)

const ANSWER = [
  '紧张度: 7',
  '爽感: 6',
  '好奇心: 9',
  '代入感: 8',
  '预期: 读者以为林望会在这一章揭穿账本',
  '爽点: 码头对质，位置在第二节',
  '弃书点: 无',
  '毒点: 无',
  '悬念: 勾住，最后一句把账本翻了出来',
].join('\n')

try {
  // ── the checklist in the task prompts for exactly the labels we parse ────
  const task = pr.TASKS.find((t) => t.key === 'reader')
  check('prompt: a reader task exists', !!task)
  check('prompt: the reader task needs a chapter', task?.needs === 'chapter', task?.needs)
  check('prompt: the reader task asks for every label',
    ['紧张度', '爽感', '好奇心', '代入感', '弃书点', '毒点', '悬念'].every((k) => task.system.includes(k)),
    task?.system)
  check('prompt: the task is bilingual', task?.zh === '读者模拟' && task?.en === 'Reader simulation')

  // ── reading the answer ──────────────────────────────────────────────────
  const parsed = rd.parseReport(ANSWER)
  check('four scores parsed', JSON.stringify(parsed.scores) === '{"tension":7,"fun":6,"curiosity":9,"immersion":8}', parsed.scores)
  check('the expectation is kept verbatim', parsed.expectation.startsWith('读者以为林望'), parsed.expectation)
  check('the drop point is kept', parsed.drop === '无', parsed.drop)
  check('the hook is kept', parsed.hook.startsWith('勾住'), parsed.hook)
  check('the raw answer is kept', parsed.raw.includes('好奇心: 9'))

  const decorated = rd.parseReport('- **紧张度**：11\n- **爽感**: -3\n**预测**: nope\n好奇心: 高')
  check('an out-of-range score is clamped, not dropped',
    decorated.scores.tension === 10 && decorated.scores.fun === 0, decorated.scores)
  check('a non-numeric score is ignored', decorated.scores.curiosity === undefined, decorated.scores)
  check('an unknown label is ignored', decorated.expectation === '', decorated.expectation)

  const english = rd.parseReport('tension: 4\ncuriosity: 5\ndrop: 三节太拖')
  check('english labels are accepted too',
    english.scores.tension === 4 && english.scores.curiosity === 5 && english.drop === '三节太拖', english)

  check('a "无" answer reads as empty', rd.isEmptyAnswer('无') && rd.isEmptyAnswer('') && !rd.isEmptyAnswer('三节太拖'))

  // ── storing reports ─────────────────────────────────────────────────────
  const book = await lib.createBook(root, { title: '读者测试' })
  const empty = await rd.listReports(book.dir)
  check('a fresh book has no reports', empty.reports.length === 0 && empty.curve.length === 0)

  const first = await rd.saveReport(book.dir, '0001-开篇', rd.parseReport(ANSWER))
  check('saveReport returns the stored report', first.report.chapter === '0001-开篇' && first.count === 1, first)
  check('the report file is written', !!(await stat(join(book.dir, rd.READER_FILE)).catch(() => null)))
  check('a timestamp is stamped on', typeof first.report.at === 'string' && first.report.at.includes('T'))

  const kept = await rd.listReports(book.dir)
  check('the stored report reads back', kept.reports.length === 1 && kept.reports[0].scores.curiosity === 9, kept.reports)
  check('the curve carries the chapter and the four numbers',
    JSON.stringify(kept.curve) === JSON.stringify([{ chapter: '0001-开篇', tension: 7, fun: 6, curiosity: 9, immersion: 8 }]),
    kept.curve)

  // a re-run on the same chapter replaces the earlier reading
  const again = await rd.saveReport(book.dir, '0001-开篇', rd.parseReport('紧张度: 2\n爽感: 3'))
  check('re-running a chapter replaces it', again.count === 1 && again.report.scores.tension === 2, again)
  check('a missing score defaults to 0', again.report.scores.immersion === 0, again.report.scores)

  // chapters sort by their number, not by string order
  await rd.saveReport(book.dir, '0010-中段', rd.parseReport('紧张度: 5'))
  await rd.saveReport(book.dir, '0002-第二', rd.parseReport('紧张度: 4'))
  const ordered = await rd.listReports(book.dir)
  check('chapters come back in reading order',
    JSON.stringify(ordered.reports.map((r) => r.chapter)) === JSON.stringify(['0001-开篇', '0002-第二', '0010-中段']),
    ordered.reports.map((r) => r.chapter))
  check('the curve follows the same order', ordered.curve.map((c) => c.chapter).join(',') === '0001-开篇,0002-第二,0010-中段')

  const guards = await boom(rd.saveReport(book.dir, '  ', rd.parseReport(ANSWER)))
  check('a report without a chapter is refused', guards && guards.status === 400 && guards.code === 'bad-chapter', guards && guards.message)

  const gone = await rd.deleteReport(book.dir, '0002-第二')
  check('deleteReport removes one chapter', gone.removed === '0002-第二' && gone.count === 2, gone)
  const goneAgain = await boom(rd.deleteReport(book.dir, '0002-第二'))
  check('deleting twice is 404', goneAgain && goneAgain.status === 404 && goneAgain.code === 'reader-missing', goneAgain && goneAgain.message)
  check('the others survive a delete', (await rd.listReports(book.dir)).reports.length === 2)
} finally {
  console.log(log.join('\n'))
  const pass = log.filter((l) => l.startsWith('PASS')).length
  const fail = log.filter((l) => l.startsWith('FAIL')).length
  console.log(`\nreader: ${pass} passed${fail ? `, ${fail} FAILED` : ''} (${log.length} checks)`)
  const { rm } = await import('node:fs/promises')
  await rm(root, { recursive: true, force: true })
}
