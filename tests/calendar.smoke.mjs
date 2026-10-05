// dsh-novel-studio — 活历法 (the book's own calendar) smoke test.
//
// Two halves: lib/calendar.js is pure arithmetic, so it is checked directly;
// then the four calendar rules in lib/validate.js are checked against a
// throwaway book whose dates are deliberately wrong in four different ways.
//
//   node tests/calendar.smoke.mjs
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = await mkdtemp(join(tmpdir(), 'novel-calendar-'))
process.env.DSH_NOVEL_ROOT = ROOT

const LIB = join(fileURLToPath(new URL('../lib/', import.meta.url)))
const fresh = (mod, tag) => import(`${new URL(`file://${join(LIB, mod).replace(/\\/g, '/')}`).href}?v=${tag}`)

const log = []
const check = (name, ok, extra = '') => {
  log.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + JSON.stringify(extra) : ''}`)
  if (!ok) process.exitCode = 1
}

// 霜月 / 凌月 / 长月 — a calendar deliberately unlike the Gregorian one.
const MONTHS = [
  { name: '霜月', days: 30, season: '冬' },
  { name: '凌月', days: 30, season: '冬' },
  { name: '长月', days: 40, season: '春' },
]

let createdExt = false

try {
  const cal = await fresh('calendar.js', 'c1')

  // ── the month table ─────────────────────────────────────────────────────
  const table = cal.monthTable(MONTHS)
  check('a declared table is used as given', table.assumed === false && table.list.length === 3, table)
  check('月份长度来自声明', table.list[2].days === 40, table.list)
  check('一年的天数是月份之和', cal.yearDays(MONTHS) === 100, cal.yearDays(MONTHS))
  check('一个月没写天数时按 30 天补', cal.monthTable([{ name: '空月' }]).list[0].days === 30)
  const fallback = cal.monthTable([])
  check('没有月表时回退公历并声明是估算的',
    fallback.assumed === true && fallback.list.length === 12 && fallback.list[1].days === 28, fallback.assumed)

  const spans = cal.monthSpans(MONTHS)
  check('月跨度首尾相接', spans[0].from === 1 && spans[0].to === 30 && spans[1].from === 31 && spans[2].to === 100, spans.map((s) => `${s.name}:${s.from}-${s.to}`))

  // ── month numbers and day-of-year ───────────────────────────────────────
  check('月份可以按名字找', cal.monthNumber('凌月', MONTHS) === 2)
  check('月份可以按数字找', cal.monthNumber('3', MONTHS) === 3 && cal.monthNumber('第2月', MONTHS) === 2)
  check('不存在的月份返回 null', cal.monthNumber('黯月', MONTHS) === null)
  check('dayOfYear 累加前面的月份', cal.dayOfYear(2, 3, MONTHS) === 33, cal.dayOfYear(2, 3, MONTHS))
  check('dayOfYear 拒绝超出的日', cal.dayOfYear(1, 45, MONTHS) === null)
  const back = cal.dateOfDayOfYear(33, MONTHS)
  check('dayOfYear 可以还原成月日', back.month === 2 && back.day === 3, back)
  check('超过一年时绕回', cal.dateOfDayOfYear(101, MONTHS).day === 1, cal.dateOfDayOfYear(101, MONTHS))

  // ── parseDate ───────────────────────────────────────────────────────────
  check('星海历1024年3月5日', cal.parseDate('星海历1024年3月5日', MONTHS).year === 1024)
  const namedDate = cal.parseDate('1024年霜月2日', MONTHS)
  check('数字年 + 本书的月份名', namedDate.year === 1024 && namedDate.month === 1 && namedDate.dayOfYear === 2, namedDate)
  // 长月 is the third month of this book (30+30+5), not the Gregorian one.
  check('1024-03-05', cal.parseDate('1024-03-05', MONTHS).dayOfYear === 65, cal.parseDate('1024-03-05', MONTHS))
  check('凌月5日（无年份）', cal.parseDate('凌月5日', MONTHS).month === 2 && cal.parseDate('凌月5日', MONTHS).year === null)
  check('3月5日（无年份）', cal.parseDate('3月5日', MONTHS).month === 3)
  check('只有年份', cal.parseDate('1024年', MONTHS).year === 1024 && cal.parseDate('1024年', MONTHS).month === null)
  check('看不懂的日期返回 null', cal.parseDate('开篇前不久', MONTHS) === null, cal.parseDate('开篇前不久', MONTHS))
  check('空日期返回 null', cal.parseDate('  ', MONTHS) === null)
  const oddMonth = cal.parseDate('黯月7日', MONTHS)
  check('历法里没有的月份会被标出来', oddMonth.unknownMonth === true && oddMonth.monthText === '黯月', oddMonth)
  const overflow = cal.parseDate('霜月45日', MONTHS)
  check('超出该月天数的日会被标出来', overflow.overflow === true && overflow.month === 1, overflow)
  const oddNamedYear = cal.parseDate('1024年黯月7日', MONTHS)
  check('月份名不认识时年份仍然读得出来', oddNamedYear.year === 1024 && oddNamedYear.unknownMonth === true, oddNamedYear)

  // ── days and ages ───────────────────────────────────────────────────────
  const a = cal.parseDate('1024年霜月1日', MONTHS)
  const b = cal.parseDate('1024年凌月3日', MONTHS)
  check('同年跨月天数正确', cal.daysBetween(a, b, MONTHS) === 32, cal.daysBetween(a, b, MONTHS))
  check('跨年天数按本书的一年算',
    cal.daysBetween(cal.parseDate('1024年凌月1日', MONTHS), cal.parseDate('1025年霜月1日', MONTHS), MONTHS) === 70,
    cal.daysBetween(cal.parseDate('1024年凌月1日', MONTHS), cal.parseDate('1025年霜月1日', MONTHS), MONTHS))
  check('缺年份就没有天数', cal.daysBetween(cal.parseDate('凌月1日', MONTHS), b, MONTHS) === null)
  check('年龄按年相减', cal.ageAt(1000, 1024) === 24 && cal.ageAt('1000', '1024') === 24)
  check('年份缺失时年龄是 null', cal.ageAt('', 1024) === null && cal.ageAt(1000, null) === null)

  // ── the story's "now" ───────────────────────────────────────────────────
  const events = [{ when: '1024年霜月1日', event: '开港' }, { when: '1022年凌月5日', event: '旧盟约' }, { when: '很早以前', event: '传说' }]
  check('最新年份就是「现在」', cal.latestYear(events) === 1024, cal.latestYear(events))
  check('一个年份都读不出来时返回 null', cal.latestYear([{ when: '开篇前' }]) === null)

  // ── festival countdown ──────────────────────────────────────────────────
  const board = cal.festivalBoard([
    { name: '灯节', date: '凌月3日' },
    { name: '开港日', date: '霜月1日' },
    { name: '雾节', date: '哪天都行' },
  ], MONTHS, a)
  check('节日按临近排序', board.map((f) => f.name).join(',') === '开港日,灯节,雾节', board.map((f) => `${f.name}:${f.daysAway}`))
  check('同一天是 0 天', board[0].daysAway === 0)
  check('往后数到月底再绕回来', board[1].daysAway === 32, board[1].daysAway)
  check('读不出来的节日排在最后且没有天数', board[2].daysAway === null && board[2].unknownMonth === false, board[2])

  // ── the one payload the panel asks for ──────────────────────────────────
  const brief = cal.calendarBrief({
    months: MONTHS,
    festivals: [{ name: '灯节', date: '凌月3日' }],
    characters: [
      { id: 'jia', name: '甲', birthYear: '1000年', age: '24' },
      { id: 'yi', name: '乙', birthYear: '', age: '30' },
    ],
    events,
  })
  check('brief 带上月表与一年长度', brief.months.length === 3 && brief.yearDays === 100)
  check('brief 的「现在」默认取年表最新年', brief.at.year === 1024 && brief.atSource === 'timeline', brief.at)
  check('brief 算出年龄并保留设定值', brief.ages.length === 1 && brief.ages[0].age === 24 && brief.ages[0].declared === 24, brief.ages)
  check('brief 里没写出生年的人不进年龄表', brief.ages.length === 1, brief.ages)
  const asked = cal.calendarBrief({ months: MONTHS, festivals: [], characters: [], events, at: '1010年霜月1日' })
  check('指定「现在」时以指定为准', asked.at.year === 1010 && asked.atSource === 'query', asked.at)
  const noEvents = cal.calendarBrief({ months: MONTHS, festivals: [{ name: '灯节', date: '凌月3日' }], characters: [], events: [] })
  check('年表没有年份时不编造「现在」', noEvents.atSource === null && noEvents.festivals[0].daysAway === null, noEvents.at)

  // ── the four rules, against a book that gets four things wrong ──────────
  const ops = await fresh('ops.js', 'c2')
  const { validateBook } = await fresh('validate.js', 'c2')

  const made = await ops.invoke('books', { action: 'create', title: '历法测试' })
  check('book created', made.ok === true, made)
  const id = made.book.id
  const dir = (await ops.invoke('books', { action: 'get', book: id })).dir

  for (const m of MONTHS) {
    const w = await ops.invoke('records', { action: 'write', book: id, section: 'world', group: 'calendar', data: m })
    check(`month ${m.name} written`, w.ok === true, w)
  }
  const fests = [
    { name: '灯节', date: '凌月3日' },
    { name: '亏月节', date: '黯月7日' },
    { name: '长夜节', date: '霜月45日' },
    { name: '雾节', date: '什么时候都行' },
  ]
  for (const item of fests) {
    const w = await ops.invoke('records', { action: 'write', book: id, section: 'world', group: 'festivals', data: item })
    check(`festival ${item.name} written`, w.ok === true, w)
  }
  const timeline = [
    { when: '1024年霜月1日', event: '开港' },
    { when: '1022年凌月5日', event: '旧盟约' },
  ]
  for (const item of timeline) {
    const w = await ops.invoke('records', { action: 'write', book: id, section: 'world', group: 'timeline', data: item })
    check(`event ${item.event} written`, w.ok === true, w)
  }
  // 丁 is forty in the sheet but born in 1000, which is 24 years before 1024;
  // 戊's numbers agree, so he must stay quiet.
  await ops.invoke('records', { action: 'write', book: id, section: 'characters', data: { id: 'ding', name: '丁', role: '配角', age: '40', birthYear: '1000' } })
  await ops.invoke('records', { action: 'write', book: id, section: 'characters', data: { id: 'wu', name: '戊', role: '配角', age: '24', birthYear: '1000' } })

  const report = await validateBook(dir, { title: '历法测试' })
  const byRule = (rule) => report.issues.filter((i) => i.rule === rule)
  const says = (rule, needle) => byRule(rule).some((i) => String(i.message).includes(needle))

  check('festival-date: 一个历法里没有的月份', says('festival-date', '亏月节') && says('festival-date', '黯月'), byRule('festival-date').map((i) => i.message))
  check('festival-date: 日超出该月天数', says('festival-date', '长夜节') && says('festival-date', '只有 30 天'), byRule('festival-date').map((i) => i.message))
  check('festival-date: 日期读不出来', says('festival-date', '雾节'), byRule('festival-date').map((i) => i.message))
  check('festival-date 不冤枉正常节日', !says('festival-date', '灯节'), byRule('festival-date').map((i) => i.message))
  check('event-order 指出倒挂的一年', says('event-order', '旧盟约') && says('event-order', '1022'), byRule('event-order').map((i) => i.message))
  check('age-conflict 拿年表最新年对年龄',
    says('age-conflict', '丁') && says('age-conflict', '24 岁'), byRule('age-conflict').map((i) => i.message))
  check('age-conflict 放过对得上的人', !says('age-conflict', '戊'), byRule('age-conflict').map((i) => i.message))
  check('定义过历法就不报 calendar-assumed', byRule('calendar-assumed').length === 0, byRule('calendar-assumed').map((i) => i.message))
  check('历法规则没有制造 error', (report.counts.error ?? 0) === 0, report.counts)

  // A second book with dates but no month table: the info rule fires once.
  const bare = await ops.invoke('books', { action: 'create', title: '无历法' })
  const bareId = bare.book.id
  const bareDir = (await ops.invoke('books', { action: 'get', book: bareId })).dir
  await ops.invoke('records', { action: 'write', book: bareId, section: 'world', group: 'festivals', data: { name: '灯节', date: '3月5日' } })
  await ops.invoke('records', { action: 'write', book: bareId, section: 'world', group: 'timeline', data: { when: '1024年3月5日', event: '开港' } })
  const bareReport = await validateBook(bareDir, { title: '无历法' })
  const bareRules = bareReport.issues.filter((i) => i.rule === 'calendar-assumed')
  check('没定义月表时 calendar-assumed 只报一次', bareRules.length === 1, bareRules.length)
  check('没有月表也不误伤节日', bareReport.issues.filter((i) => i.rule === 'festival-date').length === 0,
    bareReport.issues.filter((i) => i.rule === 'festival-date').map((i) => i.message))

  // ── the catalogue grew ──────────────────────────────────────────────────
  const { ruleList } = await fresh('validate.js', 'c3')
  const rules = await ruleList()
  check('规则目录现在是 24 条', rules.length === 24, rules.map((r) => r.id))
  check('四条历法规则都在目录里',
    ['festival-date', 'event-order', 'age-conflict', 'calendar-assumed'].every((x) => rules.some((r) => r.id === x)),
    rules.map((r) => r.id))
} catch (err) {
  check(`unexpected throw: ${err?.message}`, false, err?.stack)
} finally {
  if (createdExt) await rm(join(LIB, 'extensions', 'test-calendar.js'), { force: true }).catch(() => {})
  console.log(log.join('\n'))
  const pass = log.filter((l) => l.startsWith('PASS')).length
  const fail = log.filter((l) => l.startsWith('FAIL')).length
  console.log(`\ncalendar: ${pass} passed${fail ? `, ${fail} FAILED` : ''} (${log.length} checks)`)
  await rm(ROOT, { recursive: true, force: true }).catch(() => {})
}
