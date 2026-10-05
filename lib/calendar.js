// dsh-novel-studio — 活历法 (the book's own calendar).
//
// A novel with its own eras still has to keep its dates straight: a festival
// that lands in the wrong month, an event dated before the event it follows, a
// character who is sixteen in chapter one and fifteen in chapter nine. None of
// that needs a model — it needs arithmetic — so this module is pure: no disk, no
// provider, no clock. `lib/validate.js`, the HTTP layer and the panel all hand it
// plain data and get plain numbers back, which is also why it can be tested
// without a book on disk.
//
// Vocabulary
//   months     [{ name, days, season }] — the book's month table, in order
//   date       a parsed { year, month, day, dayOfYear } (any field may be null)
//   assumed    true when the book declares no month table at all, in which case
//              arithmetic falls back to the real-world 365-day year and says so

/** Where the month table and the festival list live inside a book. */
export const CALENDAR_FILE = 'world/calendar.yaml'
export const FESTIVAL_FILE = 'world/festivals.yaml'
export const MONTH_KEY = 'months'
export const FESTIVAL_KEY = 'festivals'

/** The real-world month lengths, used only when the book declares none. */
export const GREGORIAN = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

/** How many days a month falls back to when only its name is given. */
export const DEFAULT_MONTH_DAYS = 30

const int = (v) => {
  const s = String(v ?? '').trim()
  if (!s) return null
  const n = Number(s)
  return Number.isInteger(n) ? n : null
}

/**
 * The month table, always usable.
 *
 * `assumed` is the honest part: a book that never declared its months still
 * gets arithmetic, but every consumer is told the answer rests on 365 days and
 * twelve 30/31-day months rather than on the author's own calendar.
 */
export function monthTable(months) {
  const list = []
  for (const [i, raw] of (Array.isArray(months) ? months : []).entries()) {
    const name = String(raw?.name ?? raw?.title ?? '').trim() || `第${i + 1}月`
    const days = int(raw?.days) ?? DEFAULT_MONTH_DAYS
    list.push({
      name,
      days: days > 0 ? days : DEFAULT_MONTH_DAYS,
      season: String(raw?.season ?? '').trim(),
      n: i + 1,
    })
  }
  if (list.length) return { list, assumed: false }
  return { list: GREGORIAN.map((days, i) => ({ name: `${i + 1}月`, days, season: '', n: i + 1 })), assumed: true }
}

/** Days in one year of this calendar. */
export function yearDays(months) {
  return monthTable(months).list.reduce((n, m) => n + m.days, 0)
}

/** Where a month starts and ends (1-based, both inclusive). */
export function monthSpans(months) {
  let from = 1
  return monthTable(months).list.map((m) => {
    const span = { ...m, from, to: from + m.days - 1 }
    from += m.days
    return span
  })
}

/**
 * The number of a month, by number or by name.
 *
 * `凌月` and `3月` and `3` all have to work: a writer types whichever comes to
 * mind, and a festival's date field is free text.
 */
export function monthNumber(value, months) {
  const { list } = monthTable(months)
  const s = String(value ?? '').trim()
  if (!s) return null
  const byNumber = /^第?(\d{1,3})月?$/.exec(s)
  if (byNumber) {
    const n = Number(byNumber[1])
    return n >= 1 && n <= list.length ? n : null
  }
  const byName = list.find((m) => m.name === s || m.name === `${s}月`)
  return byName ? byName.n : null
}

/** Day-of-year (1-based) for a month/day pair, or null when unknowable. */
export function dayOfYear(month, day, months) {
  const { list } = monthTable(months)
  const n = monthNumber(month, months)
  const d = int(day)
  if (n === null || d === null || d < 1 || d > list[n - 1].days) return null
  let doy = 0
  for (let i = 0; i < n - 1; i += 1) doy += list[i].days
  return doy + d
}

/** The month/day pair a day-of-year falls on. */
export function dateOfDayOfYear(n, months) {
  const doy = int(n)
  if (doy === null || doy < 1) return null
  const total = yearDays(months)
  const day = ((doy - 1) % total) + 1
  let from = 1
  for (const m of monthTable(months).list) {
    if (day < from + m.days) return { month: m.n, monthName: m.name, day: day - from + 1 }
    from += m.days
  }
  return null
}

/**
 * Read a date out of free text.
 *
 * Returns null rather than guessing when nothing matches — a validator that
 * invents a year from "开篇前" would report nonsense as fact. Accepted shapes:
 * `星海历1024年3月5日`, `1024年3月`, `1024-03-05`, `凌月5日`, `3月5日`, `1024年`.
 */
export function parseDate(text, months) {
  const raw = String(text ?? '').trim()
  if (!raw) return null

  const cjk = /(\d{1,7})\s*年\s*(\d{1,3})\s*月(?:\s*(\d{1,3})\s*[日号]?)?/.exec(raw)
  const iso = /^(\d{1,7})-(\d{1,3})-(\d{1,3})$/.exec(raw)
  if (cjk || iso) {
    const [, y, m, d] = cjk || iso
    return finish(int(y), int(m), int(d), months)
  }

  // `1024年霜月1日` — a year plus one of the book's own month names. The year
  // still comes out when the month name is not in the table, so a timeline
  // keeps its order even while the calendar is being filled in.
  const namedYear = /^(\d{1,7})\s*年\s*([^\d\s]{1,6})月(?:\s*(\d{1,3})\s*[日号]?)?$/.exec(raw)
  if (namedYear) {
    const [, y, name, d] = namedYear
    const n = monthNumber(name, months)
    if (n === null) {
      return { year: int(y), month: null, day: int(d), dayOfYear: null, unknownMonth: true, monthText: `${name}月` }
    }
    return finish(int(y), n, int(d), months)
  }

  const named = /^([^\d\s]{1,6})月\s*(\d{1,3})\s*[日号]?$/.exec(raw)
  if (named) {
    const n = monthNumber(named[1], months)
    return n === null ? unknownMonth(`${named[1]}月`, int(named[2])) : finish(null, n, int(named[2]), months)
  }

  const short = /^(\d{1,3})\s*月\s*(\d{1,3})\s*[日号]?$/.exec(raw)
  if (short) return finish(null, int(short[1]), int(short[2]), months)

  const yearOnly = /^(\d{1,7})\s*年?$/.exec(raw)
  if (yearOnly) return { year: int(yearOnly[1]), month: null, day: null, dayOfYear: null, unknownMonth: false }

  return null
}

/** A month name the book's own table does not have. */
function unknownMonth(name, day) {
  return { year: null, month: null, day: int(day), dayOfYear: null, unknownMonth: true, monthText: String(name) }
}

function finish(year, month, day, months) {
  const { list } = monthTable(months)
  const n = month === null ? null : (month >= 1 && month <= list.length ? month : null)
  const overflow = n !== null && day !== null && day > list[n - 1].days
  return {
    year,
    month: n,
    monthName: n === null ? null : list[n - 1].name,
    day,
    dayOfYear: n === null || day === null ? null : dayOfYear(n, day, months),
    unknownMonth: month !== null && n === null,
    monthText: month !== null && n === null ? `${month}月` : null,
    overflow,
  }
}

/** Whole days from one date to another; null when either lacks a year. */
export function daysBetween(a, b, months) {
  if (!a || !b || a.year === null || b.year === null || a.dayOfYear === null || b.dayOfYear === null) return null
  return (b.year - a.year) * yearDays(months) + (b.dayOfYear - a.dayOfYear)
}

/**
 * Age in whole years.
 *
 * Year subtraction only: without a birthday rule there is nothing else to do,
 * and pretending otherwise would be worse than a round number.
 */
export function ageAt(birthYear, atYear) {
  const b = int(birthYear)
  const a = int(atYear)
  if (b === null || a === null) return null
  return a - b
}

/**
 * The year the story has reached: the latest year the book itself states.
 *
 * The timeline's own events are the only dates a book is guaranteed to have
 * written down, so the newest of them is what "now" means here. A book with no
 * dated events gets null and the panel asks for a year instead of inventing one.
 */
export function latestYear(events) {
  let best = null
  for (const e of Array.isArray(events) ? events : []) {
    const parsed = parseDate(e?.when, null)
    if (parsed && parsed.year !== null && (best === null || parsed.year > best)) best = parsed.year
  }
  return best
}

/** Every festival with its day-of-year and how far off it is from `at`. */
export function festivalBoard(festivals, months, at) {
  const total = yearDays(months)
  const out = []
  for (const [i, raw] of (Array.isArray(festivals) ? festivals : []).entries()) {
    const name = String(raw?.name ?? raw?.title ?? '').trim() || `节日 ${i + 1}`
    const text = String(raw?.date ?? raw?.when ?? '').trim()
    const parsed = parseDate(text, months)
    const doy = parsed ? parsed.dayOfYear : null
    let daysAway = null
    if (doy !== null && at && at.dayOfYear !== null) {
      daysAway = doy - at.dayOfYear
      if (daysAway < 0) daysAway += total
    }
    out.push({
      name,
      date: text,
      month: parsed ? parsed.month : null,
      monthName: parsed ? parsed.monthName : null,
      day: parsed ? parsed.day : null,
      dayOfYear: doy,
      daysAway,
      unknownMonth: Boolean(parsed && parsed.unknownMonth),
      overflow: Boolean(parsed && parsed.overflow),
      note: String(raw?.note ?? '').trim(),
    })
  }
  out.sort((a, b) => {
    if (a.daysAway === null && b.daysAway === null) return a.name.localeCompare(b.name)
    if (a.daysAway === null) return 1
    if (b.daysAway === null) return -1
    return a.daysAway - b.daysAway
  })
  return out
}

/**
 * Everything the panel and the assistant need to answer "when is this, and how
 * old is everyone" in one payload.
 *
 * `at` is a date or a bare year typed by the writer; when it is absent the
 * story's own latest year is used, and `atSource` says which of the two
 * happened so the panel never presents a default as the author's decision.
 */
export function calendarBrief({ months, festivals, characters, events, at } = {}) {
  const table = monthTable(months)
  const total = yearDays(months)
  const storyYear = latestYear(events)
  let atDate = parseDate(at, months)
  let atSource = atDate ? 'query' : null
  if (!atDate && storyYear !== null) {
    atDate = { year: storyYear, month: 1, day: 1, dayOfYear: 1 }
    atSource = 'timeline'
  }
  if (atDate && atDate.dayOfYear === null) {
    atDate = { ...atDate, month: atDate.month ?? 1, day: atDate.day ?? 1, dayOfYear: 1 }
  }

  const ages = []
  for (const c of Array.isArray(characters) ? characters : []) {
    const birth = parseDate(c?.birthYear, months)
    const birthYear = birth && birth.year !== null ? birth.year : int(c?.birthYear)
    if (birthYear === null) continue
    ages.push({
      name: String(c?.name ?? c?.id ?? '').trim(),
      id: String(c?.id ?? ''),
      birthYear,
      age: atDate ? ageAt(birthYear, atDate.year) : null,
      declared: int(c?.age),
    })
  }

  return {
    months: monthSpans(months),
    yearDays: total,
    assumed: table.assumed,
    at: atDate,
    atSource,
    storyYear,
    festivals: festivalBoard(festivals, months, atDate),
    ages,
  }
}
