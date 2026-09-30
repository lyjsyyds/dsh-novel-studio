// dsh-novel-studio — the AI pane's host half.
//
// Two jobs, and deliberately only two: gather the book's real state into a plain
// context bundle, and drive one model call. All prompt wording lives in
// lib/prompt.js so it can be tested without a model; this file does the I/O.
//
// The llm service arrives as an argument rather than an import. This module is
// re-imported per request by lib/index.js (which is the only file holding a
// Cordis context), so the bridge is handed across on every reload — see
// `setServices` in lib/api.js.

const V = new URL(import.meta.url).searchParams.get('v') ?? '0'

const { getSchema } = await import(`./schema.js?v=${V}`)
const { listUnit, readUnit } = await import(`./records.js?v=${V}`)
const { buildGraph } = await import(`./graph.js?v=${V}`)
const { validateBook } = await import(`./validate.js?v=${V}`)
const { buildPrompt, listTasks } = await import(`./prompt.js?v=${V}`)
const { noteUsage } = await import(`./usage.js?v=${V}`)

/** Tasks extensions contributed, in load order. Never throws — a broken
 *  extension registry must not take the AI pane down with it. */
async function extraTasks() {
  try {
    return (await getSchema())?.extraAiTasks || []
  } catch {
    return []
  }
}

/** Serializable task menu for the panel: built-ins plus extensions. */
export async function aiTasks() {
  return listTasks(await extraTasks())
}

function refuse(message, code = 'ai-error', status = 400) {
  const err = new Error(message)
  err.code = code
  err.status = status
  return err
}

function unitOf(schema, sectionKey, groupKey) {
  const found = schema.unitOf(sectionKey, groupKey ?? sectionKey)
  return found?.unit ?? null
}

/** List one unit, degrading to an empty list rather than failing the whole call. */
async function itemsOf(schema, bookDir, sectionKey, groupKey) {
  const unit = unitOf(schema, sectionKey, groupKey)
  if (!unit) return []
  try {
    return (await listUnit(bookDir, unit)).items ?? []
  } catch {
    return []
  }
}

/**
 * Field order and Chinese labels come from the live section schema, so the
 * prompt says `姓名：林望` and inherits whatever fields an extension added —
 * without this file knowing any section's shape in advance.
 */
function fieldKeys(unit) {
  const keys = (unit?.fields ?? []).map((f) => f?.key ?? f?.name ?? f?.id).filter(Boolean)
  const title = unit?.titleField
  return title && !keys.includes(title) ? [title, ...keys] : keys
}

function fieldLabels(unit) {
  const out = {}
  for (const f of unit?.fields ?? []) {
    const key = f?.key ?? f?.name ?? f?.id
    if (key) out[key] = f?.zh ?? f?.label ?? f?.title ?? key
  }
  if (unit?.titleField && !out[unit.titleField]) out[unit.titleField] = '名称'
  return out
}

// ── selectable pools ────────────────────────────────────────────────────────

/**
 * Every unit the AI pane may quote, as a selectable pool.
 *
 * Derived from the live schema instead of a hand-kept list, so a section added
 * later — built-in or contributed by an extension — shows up in the picker on
 * its own. Only `records` and `doc` units can be quoted entry by entry: chapter
 * bodies are chosen separately, the overview is read-only, and raw material
 * files are not records.
 */
function poolDefs(schema) {
  const out = []
  for (const section of schema?.sections ?? []) {
    if (!section || typeof section.key !== 'string') continue
    if (section.kind === 'groups') {
      for (const group of section.groups ?? []) {
        if (!group || typeof group.key !== 'string') continue
        if (group.kind !== 'records' && group.kind !== 'doc') continue
        out.push({
          key: `${section.key}/${group.key}`,
          section: section.key,
          group: group.key,
          unit: group,
          zh: group.zh ?? group.key,
        })
      }
    } else if (section.kind === 'records' || section.kind === 'doc') {
      out.push({ key: section.key, section: section.key, group: section.key, unit: section, zh: section.zh ?? section.key })
    }
  }
  return out
}

/**
 * Stable id for one entry: the file name for records, the title for doc lists
 * (which have no id of their own). The same function feeds both the catalog and
 * the filtering, so an id the picker shows is the id `pick` matches on.
 */
function entryId(unit, item, index, seen) {
  let id = unit?.kind === 'records' && item?.id != null ? String(item.id) : ''
  if (!id) {
    const base = unit?.titleField ? item?.[unit.titleField] : undefined
    id = String(base ?? item?.name ?? item?.title ?? item?.term ?? item?.event ?? '').trim()
  }
  if (!id) id = `#${index + 1}`
  if (seen.has(id)) {
    let n = 2
    while (seen.has(`${id}#${n}`)) n += 1
    id = `${id}#${n}`
  }
  seen.add(id)
  return id
}

/** Display label for the picker, kept short enough to render as a chip. */
function entryLabel(unit, id, item) {
  const base = unit?.titleField ? item?.[unit.titleField] : undefined
  const text = String(base ?? item?.name ?? item?.title ?? item?.term ?? item?.event ?? id ?? '').trim()
  return text.length > 60 ? `${text.slice(0, 60)}…` : text
}

/**
 * Validate `request.pick` — the writer's "read exactly these" map.
 *
 * Absent, null or empty means "everything the book has", which is the pane's
 * default. An object maps pool keys to what to keep: an array of ids (an empty
 * one drops the whole pool), `false` drops it, `true` keeps it whole. An
 * unknown pool key is ignored so a picker built against an older schema can
 * never fail a run; a malformed pick is the caller's mistake and is refused
 * here — inside collectContext, i.e. still before the SSE head goes out.
 */
function normalizePick(pick) {
  if (pick === undefined || pick === null || pick === '') return null
  if (typeof pick !== 'object' || Array.isArray(pick)) {
    throw refuse('pick 必须是对象：{ 分区键: [条目 id, …] }。', 'bad-pick', 400)
  }
  const out = {}
  for (const [key, value] of Object.entries(pick)) {
    if (value === true) {
      out[key] = true
    } else if (value === false || value === null) {
      out[key] = false
    } else if (Array.isArray(value) && !value.some((v) => v !== null && typeof v === 'object')) {
      out[key] = value.map((v) => String(v))
    } else {
      throw refuse(`pick.${key} 必须是 id 数组、true 或 false。`, 'bad-pick', 400)
    }
  }
  return out
}

/** Load every pool, flagging each entry with whether the pick keeps it. */
async function loadPools(schema, bookDir, pick) {
  const pools = []
  for (const def of poolDefs(schema)) {
    const raw = await itemsOf(schema, bookDir, def.section, def.group)
    const seen = new Set()
    const items = raw.map((item, index) => {
      const id = entryId(def.unit, item, index, seen)
      let on = true
      if (pick && Object.prototype.hasOwnProperty.call(pick, def.key)) {
        const want = pick[def.key]
        if (want === false || want === null) on = false
        else if (Array.isArray(want)) on = want.includes(id)
      }
      return { id, label: entryLabel(def.unit, id, item), on, data: item }
    })
    pools.push({
      key: def.key,
      zh: def.zh,
      section: def.section,
      group: def.group,
      titleField: def.unit?.titleField ?? '',
      keys: fieldKeys(def.unit),
      labels: fieldLabels(def.unit),
      items,
    })
  }
  return pools
}

/**
 * Gather everything the prompt may quote.
 *
 * Every section degrades independently: a corrupt character file must not stop
 * a continuation of the chapter the writer is actually in.
 */
export async function collectContext(bookDir, book = {}, request = {}) {
  const schema = await getSchema()

  // Judged first: a malformed pick is a caller error, and everything that can
  // fail must fail before the stream opens.
  const pick = normalizePick(request.pick)
  const pools = await loadPools(schema, bookDir, pick)

  // The five legacy context fields read from their pool, so a pick narrows them
  // exactly like every other pool and hand-built prompt contexts stay valid.
  const poolOf = (key) => pools.find((p) => p.key === key)
  const chosen = (key) => (poolOf(key)?.items ?? []).filter((i) => i.on).map((i) => i.data)

  const characters = chosen('characters')
  const rules = chosen('world/rules')
  const glossary = chosen('world/glossary')
  const arcs = chosen('outline/tree')
  const beats = chosen('outline/beats')
  const chapterItems = await itemsOf(schema, bookDir, 'chapters')

  const chapters = chapterItems.map((c) => ({ id: c.id, title: c.title, words: c.words ?? 0 }))

  // "续写" with no chapter named means the chapter the writer is most likely in:
  // the last one. Every other task only reads a chapter when one is named.
  const named = String(request.chapter ?? '').trim()
  const wanted = named || (request.task === 'continue' ? chapters[chapters.length - 1]?.id ?? '' : '')

  let chapter = null
  if (wanted) {
    const unit = unitOf(schema, 'chapters', 'chapters')
    if (unit) {
      try {
        const read = await readUnit(bookDir, unit, wanted)
        chapter = { id: read.id, title: read.data?.title, body: String(read.data?.body ?? '') }
      } catch {
        chapter = null
      }
    }
    if (!chapter && named) throw refuse(`no such chapter: ${named}`, 'unknown-chapter')
  }

  let edges = []
  try {
    const graph = await buildGraph(bookDir)
    const labelOf = new Map((graph.nodes ?? []).map((n) => [n.id, n.label ?? n.id]))
    edges = (graph.edges ?? []).map((e) => ({
      from: e.from,
      to: e.to,
      fromLabel: labelOf.get(e.from) ?? e.from,
      toLabel: labelOf.get(e.to) ?? e.to,
      type: e.type,
      strength: e.strength,
      source: e.source,
    }))
    // When the writer narrowed the selection, a relation only stays if both of
    // its ends survived — a pick is a promise about what the model reads.
    if (pick) {
      const allowed = new Set()
      for (const pool of pools) {
        for (const item of pool.items) {
          if (!item.on) continue
          allowed.add(item.id)
          if (item.label) allowed.add(item.label)
        }
      }
      edges = edges.filter((e) => (allowed.has(e.from) || allowed.has(e.fromLabel)) && (allowed.has(e.to) || allowed.has(e.toLabel)))
    }
  } catch {
    edges = []
  }

  let issues = []
  try {
    const report = await validateBook(bookDir, book)
    issues = report?.issues ?? []
  } catch {
    issues = []
  }

  const characterUnit = unitOf(schema, 'characters', 'characters')

  return {
    book: {
      id: book.id,
      title: book.title ?? '',
      author: book.author ?? '',
      genre: book.genre ?? '',
      logline: book.logline ?? '',
    },
    labels: { characters: fieldLabels(characterUnit) },
    keys: { characters: fieldKeys(characterUnit) },
    characters,
    rules,
    glossary,
    arcs,
    beats,
    chapters,
    chapter,
    edges,
    issues,
    // Every selectable pool as it stands after the pick, so prompt.js can
    // render the ones it has no dedicated section for (地点/势力/事件/…).
    pools,
  }
}

/**
 * Pick the model route: the request may override either half, and the caller's
 * default fills whatever is left. Reasoning effort is only inherited when the
 * route is genuinely the same one — an effort id is model-specific, so carrying
 * it onto a different model would be a guess, not a default.
 */
export function resolveRoute(request = {}, selection = null) {
  const fallback = typeof selection === 'function' ? selection() : selection
  const provider = String(request.provider ?? '').trim() || String(fallback?.provider ?? '').trim()
  const model = String(request.model ?? '').trim() || String(fallback?.model ?? '').trim()
  if (!provider || !model) {
    throw refuse('还没有选定模型：请先在「设置 → 模型」里选一个，或在请求里指明 provider 与 model。', 'no-model')
  }
  const route = { provider, model }
  const same = provider === String(fallback?.provider ?? '') && model === String(fallback?.model ?? '')
  const effort = String(request.reasoningEffort ?? '').trim() || (same ? String(fallback?.reasoningEffort ?? '').trim() : '')
  if (effort) route.reasoningEffort = effort
  return route
}

/**
 * A stored per-book model route, normalised — or null when the book has none.
 *
 * Every book carries its own choice, so this is read from the book record
 * rather than from the deployment: `null` means "whatever the deployment
 * default is", and a half-filled record (provider without model) is treated as
 * unset instead of as a broken route the model call would fail on.
 */
export function normalizeModel(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const provider = String(value.provider ?? '').trim()
  const model = String(value.model ?? '').trim()
  if (!provider || !model) return null
  const out = { provider, model }
  const effort = String(value.reasoningEffort ?? '').trim()
  if (effort) out.reasoningEffort = effort
  return out
}

/**
 * The default a book's AI run resolves against: the book's own model when it
 * has one, the deployment default filling in the rest.
 *
 * Books are independent — this never writes back, and one book's choice cannot
 * leak into another's or into the harness-wide selection. Effort is inherited
 * from the default only when the route is genuinely the same one, because an
 * effort id belongs to a specific model.
 */
export function bookSelection(book, defaultSelection) {
  const base = typeof defaultSelection === 'function' ? defaultSelection() : defaultSelection
  const own = normalizeModel(book?.aiModel)
  if (!own) return base || null
  // The default contributes everything except the route itself and its effort:
  // an effort id belongs to one model, so carrying it onto a different model
  // would be a guess rather than a default. It is kept only when the book names
  // the very same route the deployment default already points at.
  const merged = { ...(base || {}), provider: own.provider, model: own.model }
  delete merged.reasoningEffort
  const same = String(base?.provider ?? '') === own.provider && String(base?.model ?? '') === own.model
  if (own.reasoningEffort) merged.reasoningEffort = own.reasoningEffort
  else if (same && base?.reasoningEffort) merged.reasoningEffort = base.reasoningEffort
  return merged
}

/**
 * Prior turns handed back for a multi-turn run, oldest first.
 *
 * The panel re-sends the whole thread on every run, so this is validated
 * before the stream opens (a malformed turn is the caller's mistake → 400),
 * capped in count (the oldest turns drop off first) and clipped per turn —
 * an old answer must never let the request grow without bound.
 */
const HISTORY_MAX_TURNS = 12
const HISTORY_MAX_CHARS = 4000

export function normalizeHistory(history) {
  if (history == null || history === '') return []
  if (!Array.isArray(history)) {
    throw refuse('history 必须是数组：[{ role: "user" | "assistant", content: "…" }]。', 'bad-history', 400)
  }
  return history.slice(-HISTORY_MAX_TURNS).map((turn, i) => {
    if (!turn || typeof turn !== 'object' || Array.isArray(turn)) {
      throw refuse(`history[${i}] 必须是 { role, content } 对象。`, 'bad-history', 400)
    }
    const role = turn.role
    if (role !== 'user' && role !== 'assistant') {
      throw refuse(`history[${i}].role 只能是 user 或 assistant。`, 'bad-history', 400)
    }
    const content = typeof turn.content === 'string' ? turn.content.trim() : ''
    if (!content) {
      throw refuse(`history[${i}].content 必须是非空字符串。`, 'bad-history', 400)
    }
    return { role, content: content.length > HISTORY_MAX_CHARS ? `${content.slice(0, HISTORY_MAX_CHARS)}…` : content }
  })
}

/**
 * The conversation a model call is filed under.
 *
 * The cost meter keys its ledger on `GenerateOptions.sessionId`, and the
 * DeepSeek transport turns that id into the request header
 * `x-deepseek-harness-session-id`. A header value must be Latin-1, so a
 * non-ASCII name would fail every call with "transport failed" — while a call
 * without a sessionId still lands in the day's totals but gets no conversation
 * row, which is why the novel pane's spend was invisible in the cost panel.
 * So: one row per book when its name can actually be sent, one shared row
 * (`novel-studio`) otherwise. These calls are hand-built — no agent loop owns
 * them — so the id is ours to choose.
 */
export function attributionId(book = {}, bookDir = '') {
  const name =
    String(book?.id ?? '').trim() ||
    String(bookDir ?? '')
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .pop() ||
    ''
  const safe = name.replace(/[^\x20-\x7e]/g, '').trim().slice(0, 48)
  return safe ? `novel-studio:${safe}` : 'novel-studio'
}

/**
 * Assemble the request the llm service expects.
 *
 * Verified against the live contract: `GenerateOptions` takes `provider`,
 * `model`, `messages`, `system`, `maxTokens` and `signal`; a request message is
 * `{ role, content }` with text blocks, and `agentDefaultModel.currentSelection`
 * already returns exactly the provider/model/reasoningEffort triple a route needs.
 *
 * A multi-turn run puts the saved turns *before* the fresh prompt: the fresh
 * prompt carries the full current setting, so history adds what the model saw
 * last time instead of replacing it.
 */
export function buildCallOptions({ prompt, route, history = [], signal, sessionId }) {
  const messages = history.map((turn) => {
    const message = { role: turn.role, content: [{ type: 'text', text: turn.content }] }
    // The llm service replays an assistant turn from its `source` record, so a
    // handed-back answer has to name the route that produced it; without one the
    // adapter reads `undefined.replayState` and the whole call dies.
    if (turn.role === 'assistant') message.source = { provider: route.provider, model: route.model }
    return message
  })
  messages.push({ role: 'user', content: [{ type: 'text', text: prompt.user }] })
  const options = {
    provider: route.provider,
    model: route.model,
    messages,
    system: prompt.system,
    maxTokens: prompt.maxTokens,
  }
  if (route.reasoningEffort) options.reasoningEffort = route.reasoningEffort
  if (signal) options.signal = signal
  // Filing, not routing: the llm service passes this through untouched, and the
  // cost meter's `llm/stream` observer uses it to give the call a conversation.
  if (sessionId) options.sessionId = sessionId
  return options
}

/**
 * Drive one model call, yielding text as it arrives.
 *
 * Yields `{type:'start'}`, then `{type:'delta'}` per token batch, then exactly
 * one `{type:'done'}`. A provider failure surfaces as a thrown error carrying
 * `code` so the HTTP layer can name it instead of reporting a bare 500.
 */
/**
 * Everything that can fail *before* a single token is streamed.
 *
 * Kept separate from the stream so the HTTP layer can answer a bad request with
 * ordinary JSON: once SSE headers are out, an unknown chapter or an unset model
 * can only be reported as a truncated answer.
 */
export async function prepareTask({ llm, selection, bookDir, book, request = {} }) {
  // The request is judged before the deployment is: a missing argument is the
  // caller's mistake whether or not this host happens to have a model wired up.
  const history = normalizeHistory(request.history)
  const context = await collectContext(bookDir, book, request)
  const prompt = buildPrompt(request, context, await extraTasks())
  const route = resolveRoute(request, bookSelection(book, selection))
  // Checked last, and answered 503 rather than 400: the caller's request was
  // fine, this deployment simply has no model to serve it.
  if (!llm || typeof llm.stream !== 'function') {
    throw refuse('这个部署里没有可用的 llm 服务。', 'no-llm', 503)
  }
  return { context, prompt, route, history, bookDir, sessionId: attributionId(book, bookDir) }
}

/** Drive one prepared call, yielding text as it arrives. */
export async function* streamPrepared({ prepared, llm, signal }) {
  const { prompt, route, history = [], sessionId } = prepared
  const options = buildCallOptions({ prompt, route, history, signal, sessionId })

  yield { type: 'start', task: prompt.task, route, stats: prompt.stats, words: prompt.words ?? 0 }

  let text = ''
  let usage = null
  let finish = null
  for await (const chunk of llm.stream(options)) {
    if (chunk?.type === 'text-delta') {
      if (chunk.text) {
        text += chunk.text
        yield { type: 'delta', text: chunk.text }
      }
    } else if (chunk?.type === 'usage') {
      usage = chunk.usage ?? null
    } else if (chunk?.type === 'finish') {
      finish = chunk.reason ?? null
    }
  }

  // Tokens already spent are spent even when the round ends badly, so the ledger
  // is written before the failure is raised. It is book-keeping, not the call:
  // it must never turn a working round into a failed one.
  if (usage && prepared.bookDir) {
    try {
      await noteUsage(prepared.bookDir, usage)
    } catch {
      /* an unwritable ledger is not a reason to lose the answer */
    }
  }

  if (finish && (finish.kind === 'error' || finish.kind === 'aborted')) {
    const detail = finish.failure?.message ?? `模型调用结束：${finish.kind}`
    throw refuse(detail, finish.kind === 'aborted' ? 'aborted' : 'llm-error')
  }

  yield { type: 'done', task: prompt.task, text, usage, finish, route }
}

/** Prepare and stream in one call. */
export async function* streamTask(args) {
  const prepared = await prepareTask(args)
  yield* streamPrepared({ prepared, llm: args.llm, signal: args.signal })
}

/** One-shot convenience wrapper: collect the whole answer as a string. */
export async function runTask(args) {
  let text = ''
  let meta = null
  for await (const event of streamTask(args)) {
    if (event.type === 'delta') text += event.text
    else if (event.type === 'done') meta = event
  }
  return { text, ...(meta ?? {}) }
}

/** The context `buildPrompt` will see, for the panel's "what will the AI read" preview. */
export async function contextPreview(bookDir, book, request = {}) {
  const context = await collectContext(bookDir, book, request)
  return {
    characters: context.characters.map((c) => c.id ?? c.name).filter(Boolean),
    rules: context.rules.length,
    glossary: context.glossary.length,
    arcs: context.arcs.length,
    beats: context.beats.length,
    chapters: context.chapters.length,
    edges: context.edges.length,
    issues: context.issues.length,
    chapter: context.chapter ? { id: context.chapter.id, title: context.chapter.title, words: context.chapter.body.length } : null,
    // Full catalogue for the picker: every pool, even the ones the pick emptied
    // out, so an unchecked entry stays visible and can be re-checked.
    catalog: (context.pools ?? [])
      .filter((p) => (p.items ?? []).length)
      .map((p) => ({
        key: p.key,
        zh: p.zh,
        section: p.section,
        picked: p.items.filter((i) => i.on).length,
        items: p.items.map((i) => ({ id: i.id, label: i.label, on: i.on })),
      })),
  }
}
