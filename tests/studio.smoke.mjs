// dsh-novel-studio — stage-9 smoke test: whole-library search, chapter order
// and renumbering, the draft box, writing progress, per-book settings, and
// import / restore (JSON backup plus a plain Markdown manuscript).
//
//   node tests/studio.smoke.mjs

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const url = (n) => new URL(`../lib/${n}`, import.meta.url).href

const { getSchema } = await import(url('schema.js'))
const { createBook, readSettings, updateSettings, SETTING_DEFAULTS } = await import(url('library.js'))
const { writeUnit, listUnit, readUnit } = await import(url('records.js'))
const { searchBook, parseQuery } = await import(url('search.js'))
const {
  chapterPlan,
  cnOrdinal,
  splitOrdinal,
  chapterStem,
  detectStyle,
  ordinalIssues,
  renumberChapters,
  reorderChapters,
  saveDraft,
  listDrafts,
  readDraft,
  restoreDraft,
  deleteDraft,
} = await import(url('chapters.js'))
const { progressFor, noteChapterSaved, setGoal, dayKey, shiftDayKey } = await import(url('progress.js'))
const { exportBook } = await import(url('export.js'))
const {
  parseBackup,
  describeBackup,
  importBackup,
  parseMarkdownChapters,
  importMarkdown,
  importableFiles,
  importFile,
} = await import(url('import.js'))
const { invoke } = await import(url('ops.js'))

const log = []
let failed = 0
const check = (name, ok, extra = '') => {
  if (!ok) failed += 1
  log.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`)
}
const threw = async (fn) => {
  try {
    await fn()
    return null
  } catch (err) {
    return err
  }
}

const root = await mkdtemp(join(tmpdir(), 'novel-studio9-'))
// ops.js resolves the novel root from the environment (`resolveRoot()`), so the
// operation-layer checks below act on this temporary library, not the real one.
process.env.DSH_NOVEL_ROOT = root

try {
  const schema = await getSchema()
  const chapters = schema.byKey.get('chapters')
  const characters = schema.byKey.get('characters')

  // ── a book with two chapters ────────────────────────────────────────────
  const book = await createBook(root, { title: '检索测试书' })
  const dir = book.dir
  await writeUnit(dir, chapters, '第一章-拾荒', {
    title: '第一章-拾荒',
    body: '林望在废墟里拾荒，遇见一只旧狗。\n第二行提到白塔。',
  })
  await writeUnit(dir, chapters, '第二章-记忆', {
    title: '第二章-记忆',
    body: '白塔的行情每天在变，记忆也是。',
  })
  await writeUnit(dir, characters, '林望', { name: '林望', role: '拾荒者', tags: ['主角'] })

  const plan0 = await chapterPlan(dir)
  check('chapterPlan: order, count, style', plan0.count === 2 && plan0.style === 'cn' && plan0.chapters[0].id === '第一章-拾荒',
    `${plan0.chapters.map((c) => c.id).join('|')} style=${plan0.style}`)
  check('chapterPlan: words counted from prose', plan0.words > 20, `words=${plan0.words}`)
  check('chapterPlan: no gaps or duplicates in 1..2', plan0.issues.gaps.length === 0 && plan0.issues.dupes.length === 0 && plan0.issues.bare === 0,
    JSON.stringify(plan0.issues))

  // ── ordinal helpers ────────────────────────────────────────────────────
  check('cnOrdinal: 十 / 十一 / 二十三 / 一百零三',
    cnOrdinal(10) === '十' && cnOrdinal(11) === '十一' && cnOrdinal(23) === '二十三' && cnOrdinal(103) === '一百零三',
    [cnOrdinal(10), cnOrdinal(11), cnOrdinal(23), cnOrdinal(103)].join(','))
  const split = splitOrdinal('第三章-白塔的行情')
  check('splitOrdinal: keeps the rest after the number', split.rest === '白塔的行情' && split.ordinal === '三', JSON.stringify(split))
  check('chapterStem: digit style pads', chapterStem(7, { style: 'digit', width: 2, rest: 'x' }) === '第07章-x')
  check('detectStyle: arabic when any id is arabic', detectStyle(['第一章-甲', '第2章-乙']) === 'digit')
  const issues = ordinalIssues(['第一章-甲', '第一章-乙', '第三章-丙', '无名'])
  check('ordinalIssues: duplicates, gaps and bare names', issues.dupes.length === 1 && issues.dupes[0] === 1 && issues.gaps.length === 1 && issues.gaps[0] === 2 && issues.bare === 1,
    JSON.stringify(issues))

  // ── search ──────────────────────────────────────────────────────────────
  const prose = await searchBook(dir, '拾荒')
  check('search: finds the word in chapter prose', prose.total >= 2 && prose.hits.some((h) => h.section === 'chapters' && h.line === 1),
    JSON.stringify(prose.hits.map((h) => `${h.section}/${h.id}/${h.field}${h.line ? ':' + h.line : ''}`)))
  const field = await searchBook(dir, '拾荒者')
  check('search: finds the word inside a record field',
    field.hits.some((h) => h.section === 'characters' && h.id === '林望' && h.field === 'role'), JSON.stringify(field.hits))
  const two = await searchBook(dir, '林望 废墟')
  check('search: every term must match, and one field is reported once',
    two.total >= 1 && two.hits.every((h) => h.section === 'chapters'))
  const scoped = await searchBook(dir, '林望', { section: 'characters' })
  check('search: section filter', scoped.hits.length >= 1 && scoped.hits.every((h) => h.section === 'characters'))
  const none = await searchBook(dir, '这个词不存在于书里')
  check('search: a miss is empty, not an error', none.total === 0 && none.hits.length === 0)
  check('search: a snippet surrounds the hit', /\S/.test(prose.hits[0].snippet) && prose.hits[0].snippet.includes('拾荒'))
  const emptyQ = await threw(() => searchBook(dir, '   '))
  check('search: an empty query is refused', !!emptyQ && /搜索词/.test(emptyQ.message), emptyQ && emptyQ.message)
  check('parseQuery: splits on whitespace and lowercases', parseQuery(' 林望  White  塔 ').terms.join('|') === '林望|white|塔',
    JSON.stringify(parseQuery(' 林望  White  塔 ')))
  const limited = await searchBook(dir, '白塔', { limit: 1 })
  check('search: limit truncates and reports it', limited.hits.length === 1 && limited.truncated === true && limited.total >= 2)

  // ── reorder / renumber ──────────────────────────────────────────────────
  const order = await reorderChapters(dir, ['第二章-记忆', '第一章-拾荒'])
  const afterOrder = await chapterPlan(dir)
  check('reorder: renames files so the order is the numbering',
    afterOrder.chapters[0].id === '第一章-记忆' && afterOrder.chapters[1].id === '第二章-拾荒',
    `${afterOrder.chapters.map((c) => c.id).join('|')} renamed=${JSON.stringify(order.renamed)}`)
  check('reorder: titles follow their chapter',
    afterOrder.chapters[0].title === '第一章-记忆' && afterOrder.chapters[1].title === '第二章-拾荒',
    afterOrder.chapters.map((c) => c.title).join('|'))
  const badOrder = await threw(() => reorderChapters(dir, ['第一章-记忆']))
  check('reorder: a short list is refused', !!badOrder && /需要 2 个/.test(badOrder.message), badOrder && badOrder.message)
  const dupOrder = await threw(() => reorderChapters(dir, ['第一章-记忆', '第一章-记忆']))
  check('reorder: a duplicate id is refused', !!dupOrder && /重复/.test(dupOrder.message), dupOrder && dupOrder.message)

  const dry = await renumberChapters(dir, { style: 'digit', start: 1, dryRun: true })
  const still = await chapterPlan(dir)
  check('renumber: dryRun reports the renames and writes nothing',
    dry.dryRun === true && dry.renamed.length === 2 && still.chapters[0].id === '第一章-记忆',
    JSON.stringify(dry.renamed))
  const real = await renumberChapters(dir, { style: 'digit', start: 1 })
  const now = await chapterPlan(dir)
  check('renumber: digit style renames and retitles',
    real.style === 'digit' && now.chapters[0].id === '第1章-记忆' && now.chapters[1].id === '第2章-拾荒',
    `${now.chapters.map((c) => `${c.id}(${c.title})`).join('|')}`)
  const back = await renumberChapters(dir, { style: 'cn', start: 1 })
  check('renumber: back to Chinese numerals', back.style === 'cn' && (await chapterPlan(dir)).chapters[0].id === '第一章-记忆')

  // ── progress ────────────────────────────────────────────────────────────
  const p0 = await progressFor(dir)
  check('progress: totals come from the prose on disk', p0.done === plan0.words && p0.chapters.count === 2, `done=${p0.done} plan=${plan0.words}`)
  check('progress: 30 days of history, today carries the day\'s output',
    p0.history.length === 30 && p0.history[29].date === dayKey() && p0.today === p0.trackedTotal,
    `today=${p0.today} tracked=${p0.trackedTotal}`)
  check('progress: streak counts today', p0.streak >= 1 && p0.activeDays >= 1)
  await noteChapterSaved(dir, '第一章-记忆', 500)
  const p1 = await progressFor(dir)
  check('noteChapterSaved: a delta lands on today', p1.today - p0.today === 500 - 12 || p1.trackedTotal > p0.trackedTotal,
    `today ${p0.today}→${p1.today}`)
  const goalSet = await setGoal(dir, { words: 1000, deadline: shiftDayKey(dayKey(), 10) })
  const p2 = await progressFor(dir)
  check('setGoal: percent, daysLeft and per-day pace',
    goalSet.goal.words === 1000 && p2.percent >= 0 && p2.percent <= 100 && p2.pace.daysLeft === 10 && p2.pace.perDayNeeded === Math.ceil(p2.remaining / 10),
    `percent=${p2.percent} left=${p2.pace.daysLeft} need=${p2.pace.perDayNeeded} remaining=${p2.remaining}`)
  const badDate = await threw(() => setGoal(dir, { deadline: '2026/01/01' }))
  check('setGoal: a bad deadline is refused', !!badDate && /YYYY-MM-DD/.test(badDate.message), badDate && badDate.message)

  // ── drafts ──────────────────────────────────────────────────────────────
  const chapterId = (await chapterPlan(dir)).chapters[0].id
  const snap = await saveDraft(dir, chapterId, { note: '改写前' })
  const box = await listDrafts(dir)
  check('saveDraft: the snapshot carries chapter, words and note',
    snap.words > 0 && box.count === 1 && box.drafts[0].chapter === chapterId && box.drafts[0].note === '改写前',
    JSON.stringify(box.drafts[0]))
  const got = await readDraft(dir, snap.id)
  check('readDraft: returns the body that was snapshotted', got.body.includes('白塔'), got.body.slice(0, 40))
  await writeUnit(dir, chapters, chapterId, { body: '换了一段完全不同的文字。' })
  const conflict = await restoreDraft(dir, snap.id)
  check('restoreDraft: reports the conflict instead of overwriting',
    conflict.changed === false && conflict.conflict === true && conflict.draftWords === snap.words,
    JSON.stringify(conflict))
  const forced = await restoreDraft(dir, snap.id, { force: true })
  const restored = await readUnit(dir, chapters, chapterId)
  check('restoreDraft: force restores the prose and snapshots what it replaced',
    forced.changed === true && !!forced.snapshot && restored.data.body.includes('白塔') && (await listDrafts(dir)).count === 2,
    `snapshot=${forced.snapshot} count=${(await listDrafts(dir)).count}`)
  await deleteDraft(dir, forced.snapshot)
  check('deleteDraft: removes one snapshot', (await listDrafts(dir)).count === 1)

  // ── settings ────────────────────────────────────────────────────────────
  const before = await readSettings(dir)
  check('readSettings: the scaffold theme is visible', before.theme === SETTING_DEFAULTS.theme && Number(before.schemaVersion) === 1, JSON.stringify(before))
  const merged = await updateSettings(dir, { theme: 'dark', fontSize: 17, myOwnKey: 'kept' })
  check('updateSettings: known keys are validated and unknown ones pass through',
    merged.theme === 'dark' && merged.fontSize === 17 && merged.myOwnKey === 'kept' && Number(merged.schemaVersion) === 1,
    JSON.stringify(merged))
  const badTheme = await threw(() => updateSettings(dir, { theme: 'neon' }))
  check('updateSettings: an unknown theme is refused', !!badTheme && /未知主题/.test(badTheme.message), badTheme && badTheme.message)
  const badSize = await threw(() => updateSettings(dir, { fontSize: 99 }))
  check('updateSettings: an out-of-range font size is refused', !!badSize && /fontSize/.test(badSize.message), badSize && badSize.message)

  // ── JSON backup → describe → dry run → restore ──────────────────────────
  const rendered = await exportBook(dir, { ...book, dir }, { format: 'json' })
  const parsed = parseBackup(rendered.text)
  check('export json: parses as a backup with both chapters', parsed.chapters.length === 2 && parsed.version === 1, `chapters=${parsed.chapters.length}`)
  check('export json: file bodies travel with the backup',
    Array.isArray(parsed.data.materials) && parsed.data.materials.every((f) => typeof f.text === 'string' || f.binary === true),
    JSON.stringify(parsed.data.materials?.map((f) => f.id)))
  const described = await describeBackup(rendered.text)
  check('describeBackup: names the sections and flags restorable ones',
    described.chapters === 2 && described.sections.some((s) => s.key === 'characters' && s.restorable === true),
    JSON.stringify(described.sections.map((s) => `${s.key}:${s.restorable}`)))
  const target = await createBook(root, { title: '恢复目标' })
  const dryImport = await importBackup(target.dir, rendered.text, { dryRun: true })
  const untouched = await chapterPlan(target.dir)
  check('importBackup: a dry run reports and writes nothing',
    dryImport.dryRun === true && dryImport.written > 0 && untouched.count === 0,
    `written=${dryImport.written} count=${untouched.count}`)
  const realImport = await importBackup(target.dir, rendered.text, {})
  const targetPlan = await chapterPlan(target.dir)
  const targetChars = await listUnit(target.dir, characters)
  check('importBackup: chapters, records and materials land in the target',
    realImport.dryRun === false && targetPlan.count === 2 && targetPlan.chapters[0].id === '第一章-记忆'
    && targetChars.items.some((c) => c.id === '林望'),
    `chapters=${targetPlan.chapters.map((c) => c.id).join('|')} records=${targetChars.items.length}`)
  const again = await importBackup(target.dir, rendered.text, {})
  check('importBackup: re-importing the same backup is idempotent', (await chapterPlan(target.dir)).count === 2, `count=${(await chapterPlan(target.dir)).count}`)

  // ── markdown manuscript ─────────────────────────────────────────────────
  const manuscript = ['# 星海拾遗', '', '# 第一章 甲', '', '甲的故事。', '', '## 第二章 乙', '', '乙的故事。'].join('\n')
  const mdSplit = parseMarkdownChapters(manuscript, { skipTitle: '星海拾遗' })
  check('parseMarkdownChapters: headings split, the book title is skipped',
    mdSplit.count === 2 && mdSplit.chapters[0].title === '第一章 甲' && mdSplit.chapters[1].body === '乙的故事。',
    JSON.stringify(mdSplit.chapters.map((c) => c.title)))
  const third = await createBook(root, { title: '导入目标' })
  const mdDry = await importMarkdown(third.dir, manuscript, { dryRun: true, skipTitle: '星海拾遗' })
  check('importMarkdown: dryRun reports the plan without writing',
    mdDry.dryRun === true && mdDry.count === 2 && (await chapterPlan(third.dir)).count === 0,
    JSON.stringify(mdDry.chapters))
  const md = await importMarkdown(third.dir, manuscript, { skipTitle: '星海拾遗' })
  const mdPlan = await chapterPlan(third.dir)
  check('importMarkdown: the manuscript becomes chapters, source numbers preserved',
    mdPlan.count === 2 && mdPlan.chapters[0].id.startsWith('第一章') && mdPlan.chapters[1].id.startsWith('第二章'),
    mdPlan.chapters.map((c) => c.id).join('|'))

  // ── files inside the book ───────────────────────────────────────────────
  await writeFile(join(third.dir, 'materials', '草稿.md'), '# 素材\n一段素材。', 'utf8')
  const listable = await importableFiles(third.dir)
  check('importableFiles: offers a manuscript already inside the book',
    listable.files.some((f) => f.dir === 'materials' && f.name === '草稿.md' && f.kind === 'markdown'),
    JSON.stringify(listable.files))
  const fromFile = await importFile(third.dir, { dir: 'materials', name: '草稿.md' }, { dryRun: true, start: 10 })
  check('importFile: reads a whitelisted file and reports the plan',
    fromFile.source === 'materials/草稿.md' && fromFile.dryRun === true, JSON.stringify(Object.keys(fromFile)))
  const escape = await threw(() => importFile(third.dir, { dir: '../..', name: 'x.md' }, {}))
  check('importFile: a directory outside the whitelist is refused', !!escape && /只允许/.test(escape.message), escape && escape.message)

  // ── the operation layer the agent tools call ────────────────────────────
  const opsSearch = await invoke('search', { root, book: book.id, q: '白塔', limit: 3 })
  check('invoke(search): reaches the same search', opsSearch.ok === true && opsSearch.hits.length > 0, `hits=${opsSearch.hits?.length}`)
  const opsPlan = await invoke('chapters', { root, book: book.id, action: 'plan' })
  check('invoke(chapters): plan', opsPlan.ok === true && opsPlan.count === 2)
  const opsDrafts = await invoke('drafts', { root, book: book.id, action: 'list' })
  check('invoke(drafts): list', opsDrafts.ok === true && opsDrafts.count === 1)
  const opsProgress = await invoke('progress', { root, book: book.id, action: 'get' })
  check('invoke(progress): get', opsProgress.ok === true && opsProgress.goal.words === 1000)
  const opsSettings = await invoke('settings', { root, book: book.id, action: 'set', patch: { theme: 'sepia' } })
  check('invoke(settings): set', opsSettings.ok === true && opsSettings.settings.theme === 'sepia' && opsSettings.defaults.theme === 'default')
  const opsDescribe = await invoke('import', { root, book: book.id, action: 'backup', text: rendered.text, describe: true })
  check('invoke(import): describe a backup', opsDescribe.ok === true && opsDescribe.chapters === 2)
  const opsUnknown = await invoke('chapters', { root, book: book.id, action: 'explode' })
  check('invoke: an unknown action is a value, not a throw', opsUnknown.ok === false && opsUnknown.code === 'unknown-action', JSON.stringify(opsUnknown))

  // ── the browser half, as a text contract ────────────────────────────────
  // lib/client.js wants React and a DOM, so it cannot be imported here. It can
  // still be read: every key its t() calls ask for has to be declared in both
  // dicts, and the classes its markup leans on have to exist in the stylesheet.
  const clientText = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  const dictText = clientText.slice(clientText.indexOf('const DICT ='), clientText.indexOf('function ensureStyle'))
  const [zhText, enText] = dictText.split(/\n\s*en: \{/)
  const declared = (block, key) => new RegExp(`(^|[\\s,{])${key}\\s*:`).test(block || '')
  const asked = [...new Set([...clientText.matchAll(/\bt\('([A-Za-z][\w]*)'\)/g)].map((m) => m[1]))]
  const missingZh = asked.filter((k) => !declared(zhText, k))
  const missingEn = asked.filter((k) => !declared(enText, k))
  check('client: every t() key is declared in Chinese', missingZh.length === 0, missingZh.join(','))
  check('client: every t() key is declared in English', missingEn.length === 0, missingEn.join(','))
  check('client: the enlarge view is mounted exactly once, in the root', (clientText.match(/h\(Zoom, \{/g) || []).length === 1)
  check('client: the chapter pane reads the chapters the author ticks', (clientText.match(/h\(ExtractPicker, \{/g) || []).length === 1)
  check('client: both entry points share the one review drawer', (clientText.match(/h\(ExtractBox, \{/g) || []).length === 2)
  check('client: a ticked batch is sent as one list, not one request per chapter', clientText.includes('{ chapters: passages }'))
  check('client: the AI tab and the reading drawer share one model form', (clientText.match(/function ModelForm\(/g) || []).length === 1)
  check('client: that form is mounted in both places', (clientText.match(/h\(ModelForm, \{/g) || []).length === 2)
  check('client: only the shared form reads or writes a book’s route', (clientText.match(/\/model`/g) || []).length === 2)
  check('client: the AI tab kept no second copy of the picker', !clientText.includes('setModelOpen'))
  check('client: a slice that could not be read is reported', clientText.includes("t('aiExtractMissed')"))
  check(
    'client: the answer box is an editable box, not a printout',
    clientText.includes("h('textarea', {") &&
      clientText.includes("'data-ai-out': '1'") &&
      clientText.includes("className: 'ns-ai-out'") &&
      !clientText.includes("h('pre', { className: 'ns-ai-out'"),
  )
  check('client: a long answer cannot swallow the panel', /\.ns-ai-out\{[^}]*max-height/.test(clientText))
  check('client: the answer can be filed as a chapter of its own', clientText.includes("{ value: 'newchapter' }"))
  check('client: a new chapter is written through the unit route', clientText.includes('unit/chapters`, { title, body: text }'))
  check('client: the next chapter name is guessed from the book', (clientText.match(/nextChapterTitle\(/g) || []).length >= 3)
  check(
    'client: the graph can be zoomed',
    clientText.includes("'data-graph-zoom': 'in'") &&
      clientText.includes("'data-graph-zoom': 'out'") &&
      clientText.includes("'data-graph-zoom': 'pct'") &&
      clientText.includes('width: `${zoom * 100}%`'),
  )
  check('client: graph zoom stays between half and four times', /Math\.min\(4, Math\.max\(0\.5,/.test(clientText))
  check(
    'client: ctrl+wheel zooms the graph without zooming the page',
    clientText.includes("addEventListener('wheel', onWheel, { passive: false })") &&
      clientText.includes('if (!ev.ctrlKey && !ev.metaKey) return'),
  )
  check(
    'client: dragging the graph pans it instead of picking nodes',
    clientText.includes('if (dragged.current) { dragged.current = false; return }') &&
      clientText.includes('el.scrollLeft = p.left - dx'),
  )
  check('client: the graph frame scrolls', /\.ns-graph-wrap\{[^}]*overflow:auto/.test(clientText))
  check(
    'client: the shelf can move a book into the recycle bin',
    clientText.includes("className: 'ns-book-del'") &&
      clientText.includes("call('DELETE', `/library/${enc(b.id)}`)") &&
      clientText.includes("t('bookTrashAsk')"),
  )
  check(
    'client: the recycle bin restores and purges',
    clientText.includes("call('POST', `/trash/${enc(e.id)}/restore`)") &&
      clientText.includes("call('DELETE', `/trash/${enc(e.id)}`)") &&
      clientText.includes("call('GET', '/trash')"),
  )
  check(
    'client: the bin is its own partition on the shelf',
    clientText.includes("t('shelfTrash')") &&
      clientText.includes("'data-open': trashOpen ? '1' : '0'") &&
      clientText.includes("className: 'ns-trash-row'"),
  )
  check('client: deleting the open book closes it', clientText.includes('if (selected === b.id) await onPick(null)'))
  check(
    'client: a shelf row never repeats its own name as the sub line',
    clientText.includes("const sub = [b.author, b.genre].filter(Boolean).join(' · ') || (label !== b.id ? b.id : '')") &&
      clientText.includes("}, label, sub ? h('small', null, sub) : null),"),
  )
  check(
    'client: both faces of the shelf are bilingual',
    clientText.includes("bookTrashAsk: '把《{n}》移入回收站？") &&
      clientText.includes("bookTrashAsk: 'Move \"{n}\" to the recycle bin?"),
  )
  const trashClasses = ['ns-book-row', 'ns-book-del', 'ns-trash-row', 'ns-trash-info', 'ns-trash-name', 'ns-trash-when', 'ns-trash-acts', 'ns-trash-open']
  const missingTrashCss = trashClasses.filter((c) => !new RegExp(`\\.${c}[,{ ]`).test(clientText))
  check('client: recycle bin CSS is in place', missingTrashCss.length === 0, missingTrashCss.join(','))
  check(
    'client: website cards open in a fresh browser tab',
    clientText.includes("window.open(it.url, '_blank', 'noopener,noreferrer')"),
  )
  check(
    'client: the website list is loaded and saved through the API',
    clientText.includes("call('GET', '/websites')") &&
      clientText.includes("call('POST', '/websites', { items: next })"),
  )
  check(
    'client: both faces of the website section are bilingual',
    clientText.includes("websites: '网站接口'") &&
      clientText.includes("websites: 'Websites'") &&
      clientText.includes("websiteBadUrl: '网址要以 http:// 或 https:// 开头'") &&
      clientText.includes("websiteBadUrl: 'The URL must start with http:// or https://'"),
  )
  check(
    'client: the empty pane hosts the website section',
    clientText.includes("h('div', { className: 'ns-welcome' }") && clientText.includes('h(Websites)'),
  )
  check(
    'client: website entries can be edited and removed',
    clientText.includes('setDraft({ index, name: it.name, url: it.url })') &&
      clientText.includes("window.confirm(t('websiteRemoveAsk').replace('{n}', it.name))"),
  )
  const siteClasses = ['ns-welcome', 'ns-sites', 'ns-sites-grid', 'ns-site', 'ns-site-open', 'ns-site-name', 'ns-site-url', 'ns-site-acts', 'ns-site-act', 'ns-site-form']
  const missingSiteCss = siteClasses.filter((c) => !new RegExp(`\\.${c}[,{ ]`).test(clientText))
  check('client: website section CSS is in place', missingSiteCss.length === 0, missingSiteCss.join(','))
  check(
    'client: the website grid scales with the pane',
    clientText.includes('repeat(auto-fill,minmax(174px,1fr))'),
  )
  // ── layout rebuild, phase 1: workbench overview + grouped navigation ──
  check(
    'client: the overview is a workbench with widgets',
    clientText.includes("className: 'ns-wb-top'") &&
      clientText.includes("t('wbContinue')") &&
      clientText.includes("t('wbGoal')") &&
      clientText.includes("t('wbValidate')") &&
      clientText.includes("t('wbNewChapter')"),
  )
  check(
    'client: the workbench grounds itself in live data',
    clientText.includes('/progress`).catch(() => null)') &&
      clientText.includes('/validate`).catch(() => null)') &&
      clientText.includes('/unit/chapters`).catch(() => null)') &&
      clientText.includes('onGo: (k) => setActive(k)'),
  )
  check(
    'client: the quick new chapter goes through the chapters API',
    clientText.includes("call('POST', `/library/${enc(book.id)}/unit/chapters`, { title: nextChapterTitle(items), body: '' })"),
  )
  check(
    'client: navigation is grouped into three columns',
    clientText.includes("className: 'ns-groups'") &&
      clientText.includes("t('grpWrite')") &&
      clientText.includes("t('grpLib')") &&
      clientText.includes("t('grpTools')") &&
      clientText.includes("grpWrite: '创作流'") &&
      clientText.includes("grpWrite: 'Workflow'"),
  )
  check(
    'client: group card copy is truthful (no invented features)',
    clientText.includes("cdValidate: '悬空关系 · 未收束伏笔 · 章节断号 · 未完结线索'") &&
      clientText.includes("cdDrafts: '章节改前的快照，可回退可另存'") &&
      clientText.includes("cdExport: 'MD · TXT · HTML · JSON 备份 · 发布 · 网站接口'") &&
      !clientText.includes('DOCX'),
  )
  check(
    'client: the counts row speaks Chinese, not raw keys',
    clientText.includes("className: 'ns-wb-counts'") && clientText.includes('labelOf[k] || k'),
  )
  check(
    'client: websites are embedded in the export pane too',
    clientText.split('h(Websites').length - 1 >= 2,
  )
  const wbClasses = ['ns-wb-top', 'ns-wb-widget', 'ns-groups', 'ns-group-title', 'ns-group-card', 'ns-group-foot', 'ns-link', 'ns-wb-counts']
  const missingWbCss = wbClasses.filter((c) => !new RegExp(`\\.${c}[,{ ]`).test(clientText))
  check('client: workbench and group CSS is in place', missingWbCss.length === 0, missingWbCss.join(','))
  check(
    'client: the grouped columns reflow on narrow panes',
    clientText.includes('repeat(auto-fit,minmax(240px,1fr))') &&
      clientText.includes('repeat(auto-fit,minmax(184px,1fr))'),
  )
  // ── layout rebuild, phase 1b: overview-driven navigation ──
  check(
    'client: the tab strip is opt-in behind a persisted toggle',
    clientText.includes("const NAV_OPEN = 'dsh-novel-studio.nav-open'") &&
      clientText.includes("window.localStorage.getItem(NAV_OPEN) === '1'") &&
      clientText.includes("window.localStorage.setItem(NAV_OPEN, next ? '1' : '0')"),
  )
  check(
    'client: the tab strip renders only while the nav is expanded',
    clientText.includes("navOpen ? h('div', { className: 'ns-tabs' },") &&
      clientText.includes("}, t('settingsOpen'))) : null,"),
  )
  check(
    'client: the overview swaps to the grouped columns when collapsed',
    clientText.includes("navOpen ? null : h('div', { className: 'ns-groups' }, columns.map((col) =>") &&
      clientText.includes('onClick: toggleNav') &&
      clientText.includes("navOpen ? t('navCollapse') : t('navExpand')"),
  )
  check(
    'client: sections exit straight back to the overview',
    clientText.includes("className: 'ns-exit-bar'") &&
      clientText.includes("onClick: () => setActive('overview') }, t('navExit')"),
  )
  check(
    'client: nav labels are bilingual',
    clientText.includes("navExpand: '展开导航'") &&
      clientText.includes("navExpand: 'Expand nav'") &&
      clientText.includes("navExit: '← 退出到总览'") &&
      clientText.includes("navExit: '← Exit to overview'"),
  )
  check(
    'client: the open book can be closed straight back to the welcome page',
    clientText.includes("onClick: () => { setActive('overview'); openBook(null) }") &&
      clientText.includes("closeBook: '✕ 关闭本书'") &&
      clientText.includes("closeBook: '✕ Close book'"),
  )
  check(
    'client: the shared library has a pane of its own',
    (clientText.match(/function SharedPane\(/g) || []).length === 1 &&
      (clientText.match(/h\(SharedPane, \{/g) || []).length === 1 &&
      clientText.includes(": active === 'shared'"),
  )
  check(
    'client: the shared pane sits in the nav strip and the lib column',
    clientText.includes("'data-on': active === 'shared' ? '1' : '0',") &&
      clientText.includes("key: 'shared', desc: t('cdShared')") &&
      clientText.includes("shared: t('sharedTab')"),
  )
  check(
    'client: every shared action goes over the /shared routes',
    clientText.includes("call('GET', '/shared')") &&
      clientText.includes('call(\'GET\', `/shared/links?book=${enc(book.id)}`)') &&
      clientText.includes('/shared/impact?key=${encodeURIComponent(key)}') &&
      clientText.includes("run('/shared/import',") &&
      clientText.includes("run('/shared/promote',") &&
      clientText.includes("run('/shared/sync',") &&
      clientText.includes("run('/shared/pin',"),
  )
  check(
    'client: shared labels are bilingual',
    clientText.includes("sharedTab: '共享库'") &&
      clientText.includes("sharedTab: 'Shared'") &&
      clientText.includes("shStale: '源已更新'") &&
      clientText.includes("shStale: 'Source updated'") &&
      clientText.includes("shModeFork: '派生副本'") &&
      clientText.includes("shModeFork: 'Forked copy'") &&
      clientText.includes("shConfirmTitle: '覆盖会影响这些书'") &&
      clientText.includes("shConfirmTitle: 'Overwriting affects these books'"),
  )
  const sharedClasses = ['ns-sh-group', 'ns-sh-row', 'ns-sh-pill', 'ns-sh-acts', 'ns-sh-impact', 'ns-sh-form', 'ns-sh-confirm']
  const missingSharedCss = sharedClasses.filter((c) => !new RegExp(`\\.${c}[,{ ]`).test(clientText))
  check('client: shared styles are in place', missingSharedCss.length === 0, missingSharedCss.join(','))
  check(
    'client: the promote form can file a book into a series layer',
    clientText.includes("shScope: '存放层'") &&
      clientText.includes("shScope: 'Lives in'") &&
      clientText.includes("call('POST', '/shared/series', { name })") &&
      clientText.includes("if (!srcUnit || !srcPick || srcScope === '__new__') return"),
  )
  check(
    'client: the browse view stacks entries by scope layer',
    clientText.includes("const layerNames = ['', ...Object.keys(seriesMap).sort()]") &&
      clientText.includes("className: 'ns-sh-layer'") &&
      clientText.includes("className: 'ns-sh-layerhead'") &&
      clientText.includes("sc ? (seriesMap[sc]?.name || sc) : t('shGlobal')"),
  )
  check(
    'client: templates, foreshadowing and field exceptions have views of their own',
    clientText.includes("call('GET', '/shared/templates')") &&
      clientText.includes("call('GET', '/shared/foreshadowing')") &&
      clientText.includes("t('shTemplates')") &&
      clientText.includes("t('shFos')") &&
      clientText.includes("run('/shared/override',"),
  )
  check(
    'client: a new book can start from a template on the welcome page',
    (clientText.match(/function TemplateStart\(/g) || []).length === 1 &&
      clientText.includes('h(TemplateStart, {') &&
      clientText.includes("call('POST', '/shared/from-template', { tid: pick })") &&
      clientText.includes("shTplMake: '从模板新建作品'") &&
      clientText.includes("shTplMake: 'New book from template'"),
  )
  check(
    'client: linked entries wear their scope badge in the editor',
    clientText.includes("className: 'ns-sh-badge'") &&
      clientText.includes("className: 'ns-sh-mini'") &&
      clientText.includes("shBadge: '来自共享库'") &&
      clientText.includes("shBadge: 'From the shared store'") &&
      clientText.includes("shOvCount: '{n} 字段本地'"),
  )
  check(
    'client: P2 shared labels are bilingual',
    clientText.includes("shTemplates: '模板'") &&
      clientText.includes("shTemplates: 'Templates'") &&
      clientText.includes("shFos: '跨书伏笔'") &&
      clientText.includes("shFos: 'Cross-book foreshadowing'") &&
      clientText.includes("shOverride: '字段例外'") &&
      clientText.includes("shOverride: 'Field exceptions'"),
  )
  const p2Classes = ['ns-sh-layer', 'ns-sh-layerhead', 'ns-sh-override', 'ns-sh-ovfields', 'ns-sh-ovfield', 'ns-sh-badge', 'ns-sh-mini', 'ns-tplstart', 'ns-tplstart-label']
  const missingP2Css = p2Classes.filter((c) => !new RegExp(`\\.${c}[,{ ]`).test(clientText))
  check('client: P2 shared styles are in place', missingP2Css.length === 0, missingP2Css.join(','))
  check(
    'client: the review pane has a consistency and a reader sub-tab',
    (clientText.match(/function IssueReport\(/g) || []).length === 1 &&
      (clientText.match(/function ReaderPane\(/g) || []).length === 1 &&
      clientText.includes('h(IssueReport, { book })') &&
      clientText.includes('h(ReaderPane, { book })') &&
      clientText.includes("t('validateIssues')") &&
      clientText.includes("t('readerTab')"),
  )
  check(
    'client: the reader pane runs one chapter and draws its curve',
    clientText.includes('call(\'GET\', `/library/${enc(book.id)}/reader`)') &&
      clientText.includes('call(\'POST\', `/library/${enc(book.id)}/reader`, { chapter })') &&
      clientText.includes('call(\'DELETE\', `/library/${enc(book.id)}/reader/${enc(id)}`)') &&
      clientText.includes("t('readerCurve')") &&
      clientText.includes("className: 'ns-rd-bar'") &&
      clientText.includes("t('readerRunHint')"),
  )
  check(
    'client: reader labels are bilingual',
    clientText.includes("readerTension: '紧张度'") &&
      clientText.includes("readerTension: 'Tension'") &&
      clientText.includes("readerDrop: '弃书点'") &&
      clientText.includes("readerDrop: 'Drop risk'") &&
      clientText.includes("readerEmpty: '还没有读者报告：选一章跑一次，情绪曲线会随报告长出来。'") &&
      clientText.includes("readerEmpty: 'No reader reports yet — run one chapter and the curve grows.'"),
  )
  check(
    'client: the top bar carries a co-pilot reminder',
    clientText.includes("className: 'ns-coach'") &&
      clientText.includes("t('coachIssues')") &&
      clientText.includes("onClick: () => setActive('validate')") &&
      clientText.includes('call(\'GET\', `/library/${enc(selected)}/validate`)'),
  )
  const p1Classes = ['ns-coach', 'ns-rd', 'ns-rd-legend', 'ns-rd-row', 'ns-rd-bars', 'ns-rd-bar', 'ns-rd-item', 'ns-rd-line']
  const missingP1Css = p1Classes.filter((c) => !new RegExp(`\\.${c}[,{ ]`).test(clientText))
  check('client: P1 styles are in place', missingP1Css.length === 0, missingP1Css.join(','))
  const navClasses = ['ns-exit-bar', 'ns-exit', 'ns-nav-toggle']
  const missingNavCss = navClasses.filter((c) => !new RegExp(`\\.${c}[,{ ]`).test(clientText))
  check('client: nav toggle CSS is in place', missingNavCss.length === 0, missingNavCss.join(','))
  const zoomClasses = ['ns-zoom-mask', 'ns-zoom-card', 'ns-zoom-head', 'ns-zoom-text', 'ns-zoom-foot', 'ns-field-bar', 'ns-pill-src']
  const missingCss = zoomClasses.filter((c) => !new RegExp(`\\.${c}[,{ ]`).test(clientText))

  // Loading it is not out of reach either: the loader is stubbed, React is
  // stubbed, and the factory is asked to register its seams against a fake ctx.
  // A module-scope mistake or a bad registration fails here, without a browser.
  const el = (type, props, ...kids) => ({ type, props: props || {}, kids })
  const fakeReact = {
    createElement: el,
    Fragment: 'fragment',
    useState: (first) => [typeof first === 'function' ? first() : first, () => {}],
    useEffect: () => {},
    useCallback: (fn) => fn,
    useMemo: (fn) => fn(),
    useRef: (first) => ({ current: first === undefined ? null : first }),
  }
  let loaded = null
  globalThis.window = {
    __ModuleLoader__: { load: (mod) => { loaded = mod } },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    addEventListener: () => {},
    removeEventListener: () => {},
  }
  // No navigator stub: Node has one of its own, and the clipboard is only ever
  // touched by a click, which this check never makes.
  await import(url('client.js'))
  check('client: the browser half announces itself to the loader', loaded?.id === 'dsh-novel-studio-lyjs' && typeof loaded.factory === 'function')
  const half = loaded.factory((name) => {
    if (name === 'react') return fakeReact
    throw new Error(`unexpected require: ${name}`)
  })
  check('client: it asks for the locale and the slot service', Array.isArray(half.inject) && half.inject.includes('locale') && half.inject.includes('slots'))
  const registered = []
  const ctx = {
    effect: () => () => {},
    locale: { register: () => () => {}, bind: () => (k) => k },
    inject: (names, fn) => fn({ uiWorkspace: { pickDirectory: async () => null } }),
    slots: {
      inject: (name, fn) => fn(),
      register: (def, component) => { registered.push({ def, component }); return () => {} },
    },
    get: () => null,
  }
  half.apply(ctx)
  const sidebar = registered.find((r) => r.def.name === 'sidebar.panellist')
  const mainPanel = registered.find((r) => r.def.name === 'main')
  check('client: apply registers the sidebar entry and the main panel', Boolean(sidebar && mainPanel), registered.map((r) => r.def.name).join(','))
  const icon = sidebar && sidebar.component({ size: 20, active: true })
  check('client: the sidebar icon renders', Boolean(icon && icon.type === 'svg'))
  check('client: the enlarge view and its field bar have styles', missingCss.length === 0, missingCss.join(','))
} finally {
  await rm(root, { recursive: true, force: true })
}

console.log(log.join('\n'))
const passed = log.filter((l) => l.startsWith('PASS')).length
console.log(`\n${passed}/${log.length} passed${failed ? ` — ${failed} FAILED` : ''}`)
process.exit(failed ? 1 : 0)
