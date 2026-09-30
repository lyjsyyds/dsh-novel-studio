/**
 * Reading a passage and filing what is new in it.
 *
 * One model call lists what the passage introduces — a person, a place, a rule —
 * as JSON. That answer is checked against the book's own schema before anyone
 * sees it, and applied only to fields the schema actually declares. Two rules
 * keep the author in charge: the panel reviews the list before anything is
 * written, and applying only ever fills a gap — a line that already has text is
 * left alone rather than overwritten.
 */
const V = new URL(import.meta.url).searchParams.get('v') ?? '0'

const { getSchema } = await import(`./schema.js?v=${V}`)
const { listUnit, writeUnit } = await import(`./records.js?v=${V}`)
const { slugify } = await import(`./library.js?v=${V}`)
const { streamPrepared, resolveRoute, bookSelection, attributionId } = await import(`./ai.js?v=${V}`)

/** Budget for one extraction answer: a list of names and short fields. */
export const EXTRACT_MAX_TOKENS = 2400
/** A passage longer than this is cut before it goes into the prompt. */
export const PASSAGE_MAX_CHARS = 8000
/** Hard ceiling on how many entries one pass may file. */
export const ENTRY_MAX = 60
const FIELD_MAX_CHARS = 600
const NAME_MAX_CHARS = 80
const TAG_MAX_CHARS = 40
const EXISTING_MAX = 60

function refuse(message, code = 'extract-error', status = 400) {
  const err = new Error(message)
  err.code = code
  err.status = status
  return err
}

function text(value, limit = 0) {
  const out = String(value ?? '').replace(/\s+/g, ' ').trim()
  return limit > 0 && out.length > limit ? out.slice(0, limit) : out
}

/** Names are compared with spaces and punctuation folded away. */
function foldName(value) {
  return text(value, NAME_MAX_CHARS)
    .toLowerCase()
    .replace(/[\s\u3000·・,，.。:：;；!！?？'"“”‘’()（）[\]【】{}<>《》\-—_/\\|]/g, '')
}

function sameName(a, b) {
  const left = foldName(a)
  return !!left && left === foldName(b)
}

/**
 * Every unit an extraction may write into, in schema order.
 *
 * Chapters, materials and drafts are deliberately absent: they are prose and
 * loose files, not records with a title and declared fields.
 */
export function extractTargets(schema = {}) {
  const targets = []
  for (const section of schema.sections || []) {
    const grouped = section.kind === 'groups'
    const units = grouped ? section.groups || [] : section.kind === 'records' || section.kind === 'doc' ? [section] : []
    for (const unit of units) {
      if (!unit || !unit.titleField) continue
      if (unit.kind !== 'records' && unit.kind !== 'doc') continue
      const fields = Array.isArray(unit.fields) ? unit.fields : []
      targets.push({
        section: section.key,
        group: grouped ? unit.key : null,
        key: grouped ? `${section.key}/${unit.key}` : section.key,
        zh: grouped ? `${section.zh || section.key} · ${unit.zh || unit.key}` : section.zh || section.key,
        titleField: unit.titleField,
        fields: fields.map((f) => ({
          k: f.k,
          zh: f.zh || f.k,
          type: f.type || 'text',
          options: optionValues(f.options),
        })),
      })
    }
  }
  return targets
}

/**
 * A select declares its choices as `{v, zh, en}`; a record only ever stores the
 * value, and the panel shows the label, so the prompt offers the value.
 */
function optionValues(options) {
  if (!Array.isArray(options)) return []
  return options
    .map((opt) => (opt && typeof opt === 'object' ? opt.v ?? opt.value ?? opt.zh : opt))
    .filter((value) => value !== undefined && value !== null && String(value).trim() !== '')
    .map((value) => String(value))
}

/**
 * The names each target already holds, so the model extends an existing entry
 * instead of filing a second copy of it under a slightly different name.
 */
async function loadExisting(bookDir, targets, schema) {
  const map = new Map()
  for (const target of targets) {
    const resolved = schema.unitOf(target.section, target.group)
    if (!resolved) {
      map.set(target.key, [])
      continue
    }
    let list = { items: [] }
    try {
      list = await listUnit(bookDir, resolved.unit)
    } catch {
      /* an unreadable unit simply has no names to offer */
    }
    const items = (list.items || [])
      .map((item, index) => ({
        id: String(item?.id ?? index),
        index,
        name: text(item?.[target.titleField], NAME_MAX_CHARS),
        data: item && typeof item === 'object' ? item : {},
      }))
      .filter((entry) => entry.name)
    map.set(target.key, items)
  }
  return map
}

/** The catalogue the model reads: where things may go, and what is in there. */
function buildExtractPrompt({ targets, existing, passage, chapter }) {
  const clean = String(passage ?? '').trim()
  const cut = clean.length > PASSAGE_MAX_CHARS ? clean.slice(0, PASSAGE_MAX_CHARS) : clean

  const catalog = []
  for (const target of targets) {
    const fields = target.fields.length
      ? target.fields
          .map((f) => `${f.k}（${f.zh}${f.type !== 'text' ? '，' + f.type : ''}${f.options.length ? '：' + f.options.join('/') : ''}）`)
          .join('、')
      : `${target.titleField}（名称）`
    const known = existing.get(target.key) || []
    const names = known.slice(0, EXISTING_MAX).map((entry) => entry.name)
    catalog.push(`- ${target.key}｜${target.zh}｜字段：${fields}`)
    catalog.push(`  已有条目：${names.length ? names.join('、') + (known.length > EXISTING_MAX ? ' 等' : '') : '（空）'}`)
  }

  const system = [
    '你是这本书的设定编辑。读一段正文，把里面出现的人、地、物、设定整理成可以记进设定库的条目。',
    '只输出 JSON，不要解释，不要 markdown 代码块。',
  ].join('\n')

  const user = [
    '下面是这本书的设定库结构：区域、可填字段、以及该区域已有的条目名。',
    '',
    catalog.join('\n'),
    '',
    chapter ? `刚写好的正文来自《${chapter}》。` : '下面是刚写好的一段正文。',
    '```',
    cut,
    cut.length < clean.length ? `（正文过长，此处只保留前 ${cut.length} 字）` : '',
    '```',
    '',
    '请只针对这段正文里真实出现的内容提条目，按下面的 JSON 形状回答：',
    '{"entries":[{"target":"区域","name":"条目名","fields":{"字段名":"内容"},"reason":"为什么值得记一句"}]}',
    '',
    '规则：',
    '1. 只填上面列出的字段名；字段没把握就整个省略，不要写「未知」「未提及」。',
    '2. 已有条目要用它原来的名字，并且只填它还空着的字段。',
    '3. 这段正文里没有任何新东西时，回答 {"entries":[]}。',
    '4. 名字要短，用正文里的叫法；同一个东西只提一条。',
  ]
    .filter((line) => line !== '')
    .join('\n')

  return { task: 'extract', system, user, maxTokens: EXTRACT_MAX_TOKENS }
}

/** One field value, coerced to its declared type — or dropped. */
function cleanValue(field, value) {
  if (value === undefined || value === null) return undefined
  const type = String(field?.type || 'text')

  if (type === 'tags' || Array.isArray(value)) {
    const raw = Array.isArray(value) ? value : String(value).split(/[,，、;；|\n]/)
    const out = []
    for (const item of raw) {
      const tag = text(item, TAG_MAX_CHARS)
      if (tag && !out.some((x) => x.toLowerCase() === tag.toLowerCase())) out.push(tag)
    }
    return out.length ? out : undefined
  }

  if (type === 'boolean') {
    if (typeof value === 'boolean') return value
    const seen = text(value).toLowerCase()
    if (['true', 'yes', '是', '1', 'on'].includes(seen)) return true
    if (['false', 'no', '否', '0', 'off'].includes(seen)) return false
    return undefined
  }

  if (type === 'number') {
    const num = Number(String(value).replace(/[^\d.+-]/g, ''))
    return Number.isFinite(num) ? num : undefined
  }

  if (type === 'textarea') {
    const body = String(value).trim()
    return body ? body.slice(0, FIELD_MAX_CHARS) : undefined
  }

  const plain = text(value, FIELD_MAX_CHARS)
  if (!plain) return undefined
  if (type === 'select' && field.options.length) {
    const hit = field.options.find((opt) => String(opt) === plain || String(opt).toLowerCase() === plain.toLowerCase())
    return hit === undefined ? undefined : hit
  }
  return plain
}

function cleanFields(target, raw) {
  const out = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  const declared = new Map(target.fields.map((f) => [f.k, f]))
  for (const key of Object.keys(raw)) {
    const field = declared.get(key)
    if (!field) continue
    const value = cleanValue(field, raw[key])
    if (value !== undefined) out[key] = value
  }
  return out
}

function targetOf(source, targets) {
  const byKey = new Map(targets.map((t) => [t.key, t]))
  const direct = text(source?.target ?? '')
  if (direct && byKey.has(direct)) return byKey.get(direct)
  const section = text(source?.section ?? '')
  const group = text(source?.group ?? '')
  if (!section) return null
  return byKey.get(group && group !== section ? `${section}/${group}` : section) || null
}

function isEmptyValue(value) {
  if (value === undefined || value === null) return true
  if (Array.isArray(value)) return value.length === 0
  return String(value).trim() === ''
}

/**
 * Turn one answer into a reviewable plan: cleaned entries plus what applying
 * would do to each of them, so the panel can show the effect before it happens.
 */
export function parseExtract(raw, targets = [], existing = new Map()) {
  const entries = []
  const dropped = []

  let body = String(raw ?? '').trim()
  if (body.startsWith('```')) {
    body = body.replace(/^```[a-zA-Z]*\s*/, '').replace(/```\s*$/, '').trim()
  }
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start >= 0 && end > start) body = body.slice(start, end + 1)

  let parsed = null
  try {
    parsed = JSON.parse(body)
  } catch {
    throw refuse('模型没有按要求给出 JSON。', 'bad-extract-answer')
  }

  const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.entries) ? parsed.entries : []
  const seen = new Map()

  // One answer may not file an unbounded list: the panel is a review, not a
  // dumping ground, and a model that ignores the limit is told how much it cut.
  const capped = list.slice(0, ENTRY_MAX)
  if (list.length > capped.length) dropped.push({ name: '', reason: 'too-many-entries', count: list.length - capped.length })

  for (const item of capped) {
    if (!item || typeof item !== 'object') continue
    const target = targetOf(item, targets)
    const name = text(item.name, NAME_MAX_CHARS)
    if (!target) {
      dropped.push({ name, reason: 'unknown-target' })
      continue
    }
    if (!name) {
      dropped.push({ name: '', reason: 'missing-name', target: target.key })
      continue
    }
    const fields = cleanFields(target, item.fields)
    const known = existing.get(target.key) || []
    const hit = known.find((entry) => sameName(entry.name, name))

    // A second mention of the same thing in one answer merges into the first
    // instead of producing two rows the panel would file twice.
    const dedupeKey = `${target.key}\u0000${foldName(name)}`
    const prior = seen.get(dedupeKey)
    if (prior) {
      for (const key of Object.keys(fields)) if (prior.fields[key] === undefined) prior.fields[key] = fields[key]
      if (!prior.reason && item.reason) prior.reason = text(item.reason, 200)
      continue
    }

    const data = hit ? hit.data : {}
    const filled = []
    const kept = []
    for (const key of Object.keys(fields)) {
      if (isEmptyValue(data[key])) filled.push(key)
      else if (Array.isArray(fields[key]) && Array.isArray(data[key])) {
        const union = data[key].slice()
        for (const tag of fields[key]) if (!union.some((x) => String(x).toLowerCase() === String(tag).toLowerCase())) union.push(tag)
        if (union.length > data[key].length) {
          fields[key] = union
          filled.push(key)
        } else kept.push(key)
      } else kept.push(key)
    }

    const entry = {
      key: target.key,
      section: target.section,
      group: target.group,
      zh: target.zh,
      titleField: target.titleField,
      name: hit ? hit.name : name,
      fields,
      fieldLabels: Object.fromEntries(target.fields.filter((f) => fields[f.k] !== undefined).map((f) => [f.k, f.zh])),
      exists: !!hit,
      id: hit ? hit.id : '',
      reason: text(item.reason, 200),
      filled,
      kept,
    }
    seen.set(dedupeKey, entry)
    entries.push(entry)
  }

  return {
    entries,
    dropped,
    counts: {
      entries: entries.length,
      fresh: entries.filter((e) => !e.exists).length,
      known: entries.filter((e) => e.exists).length,
      fields: entries.reduce((n, e) => n + Object.keys(e.fields).length, 0),
      dropped: dropped.length,
    },
  }
}

/**
 * Read a passage with the book's own model route and return the plan.
 *
 * The call goes through `streamPrepared`, so an extraction is billed to the
 * same per-book ledger as any other AI round and appears in the running total.
 */
export async function recognizeExtract({ llm, selection, bookDir, book = {}, chapter = '', passage = '', signal }) {
  const clean = String(passage ?? '').trim()
  if (!clean) throw refuse('没有可识别的正文。', 'missing-argument')
  if (!llm || typeof llm.stream !== 'function') throw refuse('这个部署里没有可用的 llm 服务。', 'no-llm', 503)

  const schema = await getSchema()
  const targets = extractTargets(schema)
  if (!targets.length) throw refuse('这本书没有可以补充的区域。', 'no-targets')

  const existing = await loadExisting(bookDir, targets, schema)
  const route = resolveRoute({}, bookSelection(book, selection))
  const prompt = buildExtractPrompt({ targets, existing, passage: clean, chapter })

  let answer = ''
  let usage = null
  for await (const event of streamPrepared({
    prepared: { prompt, route, history: [], bookDir, sessionId: attributionId(book, bookDir) },
    llm,
    signal,
  })) {
    if (event?.type === 'delta') answer += event.text
    else if (event?.type === 'done') usage = event.usage ?? null
  }

  const plan = parseExtract(answer, targets, existing)
  plan.chapter = text(chapter, 200)
  plan.words = clean.match(/[\u4e00-\u9fff]|[A-Za-z0-9]+/g)?.length ?? 0
  plan.text = answer
  return { route, usage, plan, text: answer }
}

/** Provider usage objects differ; add every number either side reported. */
function addUsage(total, next) {
  if (!next || typeof next !== 'object') return total
  const out = total && typeof total === 'object' ? { ...total } : {}
  for (const [key, value] of Object.entries(next)) {
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = (Number(out[key]) || 0) + value
  }
  return out
}

/**
 * Merge per-chapter plans into one review list.
 *
 * A name met in two chapters is one row: a field the first chapter left out is
 * filled by the later one, while a field that already has a value is never
 * replaced — the same rule applying follows. `exists` keeps the first answer,
 * because nothing has been written yet while the list is being built.
 */
export function mergeExtractPlans(parts = []) {
  const rows = []
  const byId = new Map()
  const chapters = []
  const dropped = []

  for (const part of Array.isArray(parts) ? parts : []) {
    const plan = part && part.plan
    if (!plan) continue
    const label = text(part.chapter, 200)
    if (label) chapters.push(label)
    if (Array.isArray(plan.dropped)) dropped.push(...plan.dropped)

    for (const entry of plan.entries || []) {
      const id = `${entry.key}\u0000${entry.name}`
      const seen = byId.get(id)
      if (!seen) {
        const row = { ...entry, fields: { ...(entry.fields || {}) }, from: label ? [label] : [] }
        byId.set(id, row)
        rows.push(row)
        continue
      }
      for (const [field, value] of Object.entries(entry.fields || {})) {
        const cur = seen.fields[field]
        const blank = cur === undefined || cur === null || cur === '' || (Array.isArray(cur) && !cur.length)
        if (blank) seen.fields[field] = value
      }
      if (label && !seen.from.includes(label)) seen.from.push(label)
    }
  }

  return {
    entries: rows,
    dropped,
    chapters,
    counts: {
      entries: rows.length,
      fresh: rows.filter((e) => !e.exists).length,
      known: rows.filter((e) => e.exists).length,
      fields: rows.reduce((n, e) => n + Object.keys(e.fields).length, 0),
      dropped: dropped.length,
    },
  }
}

/**
 * Read several chapters and return them as one plan.
 *
 * One call per chapter rather than one pass over the whole book: the author
 * picks the scope, and each chapter is billed and capped on its own. A chapter
 * with no text is skipped and named on the plan instead of failing the batch.
 */
export async function recognizeChapters({ llm, selection, bookDir, book = {}, chapters = [], signal }) {
  const list = (Array.isArray(chapters) ? chapters : []).map((one) => ({
    id: text(one && one.id, 200),
    passage: String((one && (one.passage ?? one.text)) ?? '').trim(),
  }))
  if (!list.length) throw refuse('没有要识别的章节。', 'missing-argument')

  const parts = []
  const calls = []
  const empty = []
  let route = null
  let usage = null

  for (const one of list) {
    if (!one.passage) {
      empty.push(one.id)
      continue
    }
    const got = await recognizeExtract({
      llm,
      selection,
      bookDir,
      book,
      chapter: one.id,
      passage: one.passage,
      signal,
    })
    route = got.route
    usage = addUsage(usage, got.usage)
    parts.push({ chapter: one.id, plan: got.plan })
    calls.push({ chapter: one.id, entries: (got.plan.entries || []).length, words: got.plan.words || 0 })
  }

  if (!parts.length) throw refuse('选中的章节都没有正文。', 'missing-argument')

  const plan = mergeExtractPlans(parts)
  plan.chapters = parts.map((p) => p.chapter)
  plan.empty = empty
  plan.calls = calls.length
  return { route, usage, plan, calls }
}

function uniqueId(base, taken) {
  const slug = slugify(base) || 'entry'
  if (!taken.has(slug)) return slug
  for (let n = 2; n < 1000; n += 1) {
    const next = `${slug}-${n}`
    if (!taken.has(next)) return next
  }
  return `${slug}-${Date.now()}`
}

/**
 * Write the entries the author kept, one at a time.
 *
 * Entries are re-validated here rather than trusted from the request: the panel
 * may only send back a subset, but nothing may send back a field the schema does
 * not declare. Applying fills empty fields only — an author's sentence is never
 * replaced by a model's.
 */
export async function applyExtract({ bookDir, entries, schema = null }) {
  if (!Array.isArray(entries)) throw refuse('entries 需要是数组。', 'bad-request')
  const active = schema || (await getSchema())
  const targets = extractTargets(active)
  const byKey = new Map(targets.map((t) => [t.key, t]))
  const existing = await loadExisting(bookDir, targets, active)

  const written = []
  const updated = []
  const skipped = []

  for (const raw of entries.slice(0, ENTRY_MAX)) {
    if (!raw || typeof raw !== 'object') continue
    const target = byKey.get(text(raw.key ?? raw.target ?? ''))
    const name = text(raw.name, NAME_MAX_CHARS)
    if (!target) {
      skipped.push({ name, reason: 'unknown-target' })
      continue
    }
    if (!name) {
      skipped.push({ name: '', reason: 'missing-name', key: target.key })
      continue
    }
    const resolved = active.unitOf(target.section, target.group)
    if (!resolved) {
      skipped.push({ name, reason: 'unknown-target', key: target.key })
      continue
    }
    const known = existing.get(target.key) || []
    const hit = known.find((entry) => sameName(entry.name, name))
    const fields = cleanFields(target, raw.fields)
    const unit = resolved.unit

    try {
      if (hit) {
        const patch = {}
        const filled = []
        const kept = []
        for (const key of Object.keys(fields)) {
          if (isEmptyValue(hit.data[key])) {
            patch[key] = fields[key]
            filled.push(key)
          } else if (Array.isArray(fields[key]) && Array.isArray(hit.data[key])) {
            const union = hit.data[key].slice()
            for (const tag of fields[key]) {
              if (!union.some((x) => String(x).toLowerCase() === String(tag).toLowerCase())) union.push(tag)
            }
            if (union.length > hit.data[key].length) {
              patch[key] = union
              filled.push(key)
            } else kept.push(key)
          } else kept.push(key)
        }
        if (!Object.keys(patch).length) {
          skipped.push({ name: hit.name, reason: 'nothing-to-add', key: target.key, kept })
          continue
        }
        await writeUnit(bookDir, unit, unit.kind === 'doc' ? String(hit.index) : hit.id, patch)
        const row = { key: target.key, zh: target.zh, name: hit.name, id: hit.id, created: false, filled, kept }
        updated.push(row)
        // Keep the in-memory view current so a later row for the same entry
        // appends to what this one just wrote instead of fighting it.
        hit.data = { ...hit.data, ...patch }
      } else {
        if (!Object.keys(fields).length && !target.titleField) {
          skipped.push({ name, reason: 'no-fields', key: target.key })
          continue
        }
        const payload = { [target.titleField]: name, ...fields }
        let id = ''
        if (unit.kind === 'doc') {
          const after = await writeUnit(bookDir, unit, 'new', payload)
          const list = Array.isArray(after?.items) ? after.items : []
          id = String(list.length - 1)
        } else {
          const taken = new Set(known.map((entry) => entry.id))
          id = uniqueId(name, taken)
          await writeUnit(bookDir, unit, id, payload)
        }
        const row = { key: target.key, zh: target.zh, name, id, created: true, filled: Object.keys(fields), kept: [] }
        written.push(row)
        known.push({ id, index: known.length, name, data: payload })
      }
    } catch (err) {
      skipped.push({ name, reason: 'write-failed', key: target.key, message: String((err && err.message) || err) })
    }
  }

  return { written, updated, skipped }
}
