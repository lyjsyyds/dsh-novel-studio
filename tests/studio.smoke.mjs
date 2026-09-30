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
  const zoomClasses = ['ns-zoom-mask', 'ns-zoom-card', 'ns-zoom-head', 'ns-zoom-text', 'ns-zoom-foot', 'ns-field-bar']
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
