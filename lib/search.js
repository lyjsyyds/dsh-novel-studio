// dsh-novel-studio — whole-book search.
//
// Read-only, and deliberately not indexed: a book is small enough to scan on
// every query, and a stale index would be worse than a slow one. The point is
// to answer "this name/word — where has it been used at all": prose, every
// record field, every doc list, and file names.
//
// A query is whitespace-split into terms and a hit must contain *all* of them
// in one field (or one chapter body), which makes `林望 镖` mean "the chapter
// where both appear" instead of "everything mentioning either".

const V = new URL(import.meta.url).searchParams.get('v') ?? '0'

const { listUnit } = await import(`./records.js?v=${V}`)
const { getSchema } = await import(`./schema.js?v=${V}`)
const { readChapters } = await import(`./export.js?v=${V}`)

export const DEFAULT_LIMIT = 60
export const MAX_LIMIT = 200
export const SNIPPET_RADIUS = 60

function bad(message, status = 400) {
  const err = new Error(message)
  err.status = status
  return err
}

/** Section kinds a query can walk. `overview` has no files of its own. */
const SEARCHABLE = new Set(['records', 'doc', 'chapters', 'files', 'raw'])

export function parseQuery(raw) {
  const text = String(raw ?? '').trim()
  const terms = text.toLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) throw bad('需要一个搜索词：?q=林望', 400)
  return { text, terms }
}

/** Every string inside a field value — arrays and scalars alike. */
function stringsOf(value) {
  if (value === null || value === undefined) return []
  if (Array.isArray(value)) return value.flatMap(stringsOf)
  if (typeof value === 'string') return value.trim() ? [value] : []
  if (typeof value === 'number' || typeof value === 'boolean') return [String(value)]
  if (typeof value === 'object') return Object.values(value).flatMap(stringsOf)
  return []
}

function hitAll(haystack, terms) {
  const low = haystack.toLowerCase()
  for (const t of terms) if (!low.includes(t)) return -1
  return low.indexOf(terms[0])
}

/** Text around an offset, with an ellipsis only when something was cut. */
export function snippetAround(text, at, radius = SNIPPET_RADIUS) {
  if (typeof at !== 'number' || at < 0) return String(text ?? '').slice(0, radius * 2).trim()
  const from = Math.max(0, at - radius)
  const to = Math.min(text.length, at + radius)
  const head = from > 0 ? '…' : ''
  const tail = to < text.length ? '…' : ''
  return `${head}${text.slice(from, to).trim()}${tail}`
}

function lineOf(text, at) {
  if (typeof at !== 'number' || at < 0) return undefined
  let line = 1
  for (let i = 0; i < at && i < text.length; i += 1) if (text[i] === '\n') line += 1
  return line
}

function titleOf(item, unit) {
  const field = unit.titleField ?? 'name'
  const value = item && typeof item === 'object' ? item[field] : undefined
  const text = stringsOf(value)[0]
  return text || String(item?.id ?? '')
}

/**
 * Search one book.
 *
 * @param bookDir absolute path of the book
 * @param query   raw query string
 * @param options { limit?, section? } — `section` restricts to one section key
 * @returns {Promise<{query, terms, hits, total, truncated, scanned}>}
 */
export async function searchBook(bookDir, query, options = {}) {
  const { text, terms } = parseQuery(query)
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(options.limit) || DEFAULT_LIMIT))
  const only = options.section ? String(options.section) : null
  const schema = await getSchema()

  const hits = []
  let total = 0
  let scannedUnits = 0
  let scannedEntries = 0

  const push = (hit) => {
    total += 1
    if (hits.length < limit) hits.push(hit)
  }

  // Prose first: a chapter body is where a name usually matters most.
  const chapters = schema.byKey.get('chapters')
  if (chapters && (!only || only === 'chapters')) {
    scannedUnits += 1
    const prose = await readChapters(bookDir)
    for (const c of prose) {
      scannedEntries += 1
      const body = String(c.body ?? '')
      const base = { section: 'chapters', group: null, key: 'chapters', kind: 'chapters', id: c.id, title: c.title }
      const at = hitAll(body, terms)
      if (at >= 0) {
        push({ ...base, field: 'body', line: lineOf(body, at), snippet: snippetAround(body, at) })
        continue
      }
      const titleAt = hitAll(String(c.title ?? ''), terms)
      if (titleAt >= 0) push({ ...base, field: 'title', snippet: snippetAround(String(c.title), titleAt, 30) })
    }
  }

  // Then every declared unit, in the order the schema lists them.
  for (const section of schema.sections) {
    if (!SEARCHABLE.has(section.kind) && section.kind !== 'groups') continue
    const units = section.kind === 'groups' ? (section.groups || []) : [section]
    for (const unit of units) {
      if (!unit || !SEARCHABLE.has(unit.kind)) continue
      if (only && only !== section.key) continue
      // The prose has already been walked above; do not list it twice.
      if (unit.kind === 'chapters') continue
      scannedUnits += 1
      let items = []
      let extra = null
      try {
        const got = await listUnit(bookDir, unit)
        items = got.items || []
        extra = got.extra || null
      } catch {
        continue // an unreadable unit is a validate problem, not a search error
      }
      const key = section.kind === 'groups' ? `${section.key}/${unit.key}` : section.key
      const group = section.kind === 'groups' ? unit.key : null

      if (unit.kind === 'raw') {
        const raw = String(extra?.text ?? '')
        scannedEntries += 1
        const at = hitAll(raw, terms)
        if (at >= 0) {
          push({
            section: section.key, group, key, kind: 'raw', id: unit.path, title: unit.path,
            field: 'text', line: lineOf(raw, at), snippet: snippetAround(raw, at),
          })
        }
        continue
      }

      for (const item of items) {
        scannedEntries += 1
        const base = { section: section.key, group, key, kind: unit.kind, id: String(item?.id ?? ''), title: titleOf(item, unit) }

        if (unit.kind === 'files') {
          const at = hitAll(base.id, terms)
          if (at >= 0) push({ ...base, field: 'file', snippet: base.id })
          continue
        }

        const fields = item && typeof item === 'object' ? Object.entries(item) : []
        for (const [field, value] of fields) {
          if (field === 'id') continue
          for (const candidate of stringsOf(value)) {
            const at = hitAll(candidate, terms)
            if (at < 0) continue
            push({
              ...base,
              field,
              ...(unit.kind === 'chapters' ? { line: lineOf(candidate, at) } : {}),
              snippet: snippetAround(candidate, at),
            })
            break // one hit per field per entry keeps the list readable
          }
        }
      }
    }
  }

  return {
    query: text,
    terms,
    hits,
    total,
    truncated: total > hits.length,
    limit,
    scanned: { units: scannedUnits, entries: scannedEntries },
  }
}
