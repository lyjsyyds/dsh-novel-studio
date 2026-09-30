// The AI layer, driven by a fake llm service: no network, no model, no cost.
//
// The point of this suite is the *seam* — what we read out of the book, what we
// hand to `llm.stream`, and how a provider failure surfaces. The wording of the
// prompt itself is covered by tests/prompt.smoke.mjs.
//
// Run: node tests/ai.smoke.mjs

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const LIB = resolve(HERE, '..', 'lib')
const EXT_DIR = join(LIB, 'extensions')
// Not `_`-prefixed: the loader deliberately skips those, and this one must load.
const EXT_NAME = 'ai-seam.smoke.js'
let createdExt = false

const ROOT = await mkdtemp(join(tmpdir(), 'novel-ai-'))
process.env.DSH_NOVEL_ROOT = ROOT

let passed = 0
const failures = []

function check(name, condition, extra) {
  if (condition) {
    passed += 1
    return
  }
  failures.push(extra === undefined ? name : `${name} — ${JSON.stringify(extra)}`)
}

async function rejectsWith(name, fn, code) {
  try {
    await fn()
    check(name, false, 'did not reject')
  } catch (err) {
    check(name, err && err.code === code, { code: err && err.code, message: String(err && err.message) })
  }
}

const fresh = (mod, tag) => import(`${pathToFileURL(resolve(LIB, mod)).href}?v=${tag}`)

/** A stand-in for `ctx.llm`: scripted chunks, and a record of what it was asked. */
function fakeLlm(chunks, seen) {
  return {
    stream(options) {
      if (seen) seen.push(options)
      return (async function* () {
        for (const chunk of chunks) yield chunk
      })()
    },
  }
}

const TEXT = (text) => ({ type: 'text-delta', index: 0, text })

const tag = `a${Date.now()}`
const { invoke } = await fresh('ops.js', tag)
const { readBook } = await fresh('library.js', tag)
const ai = await fresh('ai.js', tag)

// ── a small but complete book ─────────────────────────────────────────────
let bookId = ''
let dir = ''
let book = {}
let created = false

try {
  const made = await invoke('books', {
    action: 'create',
    title: '星海拾遗',
    meta: { author: '测试作者', genre: '科幻', logline: '一个捡废品的少年捡到了一段还在运行的记忆。' },
  })
  if (!made.ok) throw new Error(`could not create the test book: ${JSON.stringify(made)}`)
  created = true
  bookId = made.book.id

  const detail = await invoke('books', { action: 'get', book: bookId })
  dir = detail.dir
  book = detail.book

  const writes = [
    ['characters', undefined, { name: '林望', role: '主角', personality: '沉默但固执', habits: '咬笔帽' }],
    ['characters', undefined, { name: '老周', role: '配角' }],
    ['world', 'rules', { rule: '记忆一旦读取就无法复制。' }],
    ['world', 'glossary', { term: '拾荒者', definition: '在轨道垃圾带收集残骸的人。' }],
    ['world', 'items', { name: '记忆芯片', type: '道具', owner: '林望' }],
    ['world', 'locations', { name: '拾荒港', type: '城市', summary: '轨道垃圾带的中转站' }],
    ['world', 'timeline', { when: '开篇前', event: '记忆潮', description: '一场抹去记忆的灾变。' }],
    ['outline', 'tree', { title: '第一卷 坠落', summary: '林望捡到记忆芯片。' }],
    ['outline', 'beats', { title: '开场', summary: '垃圾带里的发现' }],
  ]
  for (const [section, group, data] of writes) {
    const res = await invoke('records', { action: 'write', book: bookId, section, ...(group ? { group } : {}), data })
    if (!res.ok) throw new Error(`seed write failed (${section}/${group ?? '-'}): ${JSON.stringify(res)}`)
  }

  await invoke('records', { action: 'write', book: bookId, section: 'chapters', data: { title: '第一章', body: '夜里，船离港了。' } })
  await invoke('records', { action: 'write', book: bookId, section: 'chapters', data: { title: '第二章', body: '他把芯片举到灯下，看见了别人的童年。' } })

  // ── collectContext ──────────────────────────────────────────────────────
  const ctx = await ai.collectContext(dir, book, { task: 'continue' })

  check('the book identity is carried', ctx.book.id === bookId && ctx.book.title === '星海拾遗', ctx.book)
  check('the logline is carried', String(ctx.book.logline).includes('记忆'))
  check('characters are read', ctx.characters.length === 2, ctx.characters.length)
  check('a character keeps its id', ctx.characters.some((c) => c.id === '林望'))
  check('character field keys are exposed', Array.isArray(ctx.keys.characters) && ctx.keys.characters.includes('name'), ctx.keys.characters)
  check('character field labels are exposed', typeof ctx.labels.characters?.name === 'string' && ctx.labels.characters.name.length > 0, ctx.labels.characters)
  check('world rules are read', ctx.rules.length === 1 && ctx.rules[0].rule.includes('无法复制'), ctx.rules)
  check('the glossary is read', ctx.glossary.length === 1 && ctx.glossary[0].term === '拾荒者')
  check('outline arcs are read', ctx.arcs.length === 1 && ctx.arcs[0].title === '第一卷 坠落', ctx.arcs)
  check('outline beats are read', ctx.beats.length === 1 && ctx.beats[0].title === '开场', ctx.beats)
  check('chapters are listed with word counts', ctx.chapters.length === 2 && ctx.chapters[0].words > 0, ctx.chapters)
  check('the chapter list is in reading order', ctx.chapters.map((c) => c.id).join() === '第一章,第二章', ctx.chapters.map((c) => c.id))
  check('continue defaults to the LAST chapter', ctx.chapter?.id === '第二章', ctx.chapter?.id)
  check('the defaulted chapter carries its prose', String(ctx.chapter?.body).includes('灯下'))
  check('relations are read from the graph', ctx.edges.length >= 1, ctx.edges)
  check('a field-derived relation is labelled on both ends', ctx.edges.some((e) => e.fromLabel === '林望' && e.toLabel === '记忆芯片'), ctx.edges)
  check('validator findings are read', Array.isArray(ctx.issues), typeof ctx.issues)
  check('the task keyword is not leaking into the context', ctx.task === undefined)

  const named = await ai.collectContext(dir, book, { task: 'continue', chapter: '第一章' })
  check('an explicitly named chapter is honoured', named.chapter?.id === '第一章')

  await rejectsWith('an unknown chapter is refused', () => ai.collectContext(dir, book, { task: 'continue', chapter: '第九十九章' }), 'unknown-chapter')

  const polished = await ai.collectContext(dir, book, { task: 'polish', text: '他走过去。' })
  check('polish does not pick a chapter by itself', polished.chapter === null || polished.chapter === undefined, polished.chapter)

  // ── the picker: which existing entries feed the model ───────────────────
  {
    const poolKeys = ctx.pools.map((p) => p.key)
    check(
      'every selectable pool is enumerated',
      ['characters', 'world/locations', 'world/timeline', 'world/rules', 'outline/beats'].every((k) => poolKeys.includes(k)),
      poolKeys,
    )
    check('chapters are not a selectable pool', !poolKeys.includes('chapters'), poolKeys)
    const locPool = ctx.pools.find((p) => p.key === 'world/locations')
    check('a pool carries its Chinese heading', locPool?.zh === '地点', locPool?.zh)
    check('a pool carries field labels for rendering', locPool?.labels?.name === '名称', locPool?.labels)
    check('a records entry keeps its file id', locPool?.items?.[0]?.id === '拾荒港', locPool?.items?.[0])
    check('every entry starts selected', locPool?.items?.every((i) => i.on === true), locPool?.items)
    check('a pool entry carries what it will render', locPool?.items?.[0]?.data?.summary === '轨道垃圾带的中转站', locPool?.items?.[0]?.data)
    const tlPool = ctx.pools.find((p) => p.key === 'world/timeline')
    check('a doc entry gets a title-based id', tlPool?.items?.[0]?.id === '记忆潮', tlPool?.items?.[0])
    check('a doc entry carries a label', tlPool?.items?.[0]?.label === '记忆潮', tlPool?.items?.[0])

    const only = await ai.collectContext(dir, book, { task: 'continue', pick: { characters: ['老周'] } })
    check('a pick keeps only the named entries', only.characters.length === 1 && only.characters[0].id === '老周', only.characters)
    check('a pick leaves untouched pools whole', only.rules.length === 1 && only.glossary.length === 1, { r: only.rules.length, g: only.glossary.length })
    check('a pick marks the rest of the pool off', only.pools.find((p) => p.key === 'characters').items.filter((i) => i.on).length === 1)

    const noItems = await ai.collectContext(dir, book, { task: 'continue', pick: { 'world/items': [] } })
    check('an emptied pool keeps nothing on', (noItems.pools.find((p) => p.key === 'world/items')?.items ?? []).every((i) => i.on === false))
    check('a relation to a dropped entry goes with it', !noItems.edges.some((e) => e.toLabel === '记忆芯片'), noItems.edges)
    check('the only relation in this book leaned on that entry', noItems.edges.length === 0, noItems.edges)

    const dropped = await ai.collectContext(dir, book, { task: 'continue', pick: { characters: false } })
    check('pick=false drops the whole pool', dropped.characters.length === 0, dropped.characters)
    const stale = await ai.collectContext(dir, book, { task: 'continue', pick: { 'nope/ghost': ['x'] } })
    check('an unknown pool key is ignored', stale.characters.length === 2, stale.characters.length)

    await rejectsWith('a non-object pick is refused', () => ai.collectContext(dir, book, { task: 'continue', pick: 'nope' }), 'bad-pick')
    await rejectsWith('an array pick is refused', () => ai.collectContext(dir, book, { task: 'continue', pick: ['a'] }), 'bad-pick')
    await rejectsWith('a non-array pool value is refused', () => ai.collectContext(dir, book, { task: 'continue', pick: { characters: '林望' } }), 'bad-pick')
    const badPickStatus = await (async () => {
      try {
        await ai.collectContext(dir, book, { task: 'continue', pick: 7 })
      } catch (err) {
        return err.status
      }
      return 0
    })()
    check('a malformed pick is a 400, judged before any stream', badPickStatus === 400, badPickStatus)

    const seedRoute = { provider: 'p', model: 'm' }
    const prepAll = await ai.prepareTask({ llm: fakeLlm([]), selection: seedRoute, bookDir: dir, book, request: { task: 'continue' } })
    check('an unselected pool still reaches the prompt', prepAll.prompt.user.includes('拾荒港') && prepAll.prompt.user.includes('地点（1 条）'), prepAll.prompt.user.includes('拾荒港'))
    check('the prompt stats count the pools', prepAll.prompt.stats.pools >= 1, prepAll.prompt.stats)
    const prepNone = await ai.prepareTask({ llm: fakeLlm([]), selection: seedRoute, bookDir: dir, book, request: { task: 'continue', pick: { 'world/locations': [] } } })
    check('an emptied pool leaves the prompt', !prepNone.prompt.user.includes('- 拾荒港') && !prepNone.prompt.user.includes('地点（1 条）'))
    const prepOne = await ai.prepareTask({ llm: fakeLlm([]), selection: seedRoute, bookDir: dir, book, request: { task: 'continue', pick: { characters: ['老周'] } } })
    check(
      'the prompt follows the pick',
      prepOne.prompt.user.includes('人物（1 位）') && prepOne.prompt.user.includes('- 老周') && !prepOne.prompt.user.includes('- 林望'),
      prepOne.prompt.user.slice(0, 200),
    )
  }

  // ── resolveRoute ────────────────────────────────────────────────────────
  const selection = { provider: 'deepseek-account', model: 'deepseek-flash', reasoningEffort: 'low' }

  const explicit = ai.resolveRoute({ provider: 'p', model: 'm' }, selection)
  check('an explicit route wins', explicit.provider === 'p' && explicit.model === 'm', explicit)
  check('an explicit route does not inherit an unrelated effort', explicit.reasoningEffort === undefined, explicit)

  const fell = ai.resolveRoute({}, selection)
  check('a missing route falls back to the default selection', fell.provider === 'deepseek-account' && fell.model === 'deepseek-flash', fell)
  check('the default effort is inherited when the model is the same', fell.reasoningEffort === 'low', fell)

  const viaThunk = ai.resolveRoute({}, () => selection)
  check('the selection may be a thunk', viaThunk.model === 'deepseek-flash', viaThunk)

  const partial = ai.resolveRoute({ model: 'other' }, selection)
  check('a partial override still fills in the provider', partial.provider === 'deepseek-account' && partial.model === 'other', partial)
  check('an effort is NOT carried onto a different model', partial.reasoningEffort === undefined, partial)

  const forced = ai.resolveRoute({ reasoningEffort: 'high' }, selection)
  check('an explicit effort always wins', forced.reasoningEffort === 'high', forced)

  await rejectsWith('no route at all is refused', () => ai.resolveRoute({}, null), 'no-model')
  await rejectsWith('an empty selection is refused', () => ai.resolveRoute({}, () => null), 'no-model')

  // ── buildCallOptions ────────────────────────────────────────────────────
  const prompt = { system: 'SYSTEM', user: 'USER', maxTokens: 123, task: 'continue' }
  const signal = new AbortController().signal
  const opts = ai.buildCallOptions({ prompt, route: fell, signal })

  check('options carry the provider and model', opts.provider === 'deepseek-account' && opts.model === 'deepseek-flash', opts)
  check('options carry the system prompt', opts.system === 'SYSTEM')
  check('options carry maxTokens', opts.maxTokens === 123)
  check('options carry exactly one user message', opts.messages.length === 1 && opts.messages[0].role === 'user', opts.messages)
  check('the message body is a text block', opts.messages[0].content[0].type === 'text' && opts.messages[0].content[0].text === 'USER', opts.messages[0])
  check('the abort signal is forwarded', opts.signal === signal)
  check('no reasoningEffort key when there is no effort', !('reasoningEffort' in ai.buildCallOptions({ prompt, route: explicit })), Object.keys(ai.buildCallOptions({ prompt, route: explicit })))
  check('reasoningEffort is present when the route has one', ai.buildCallOptions({ prompt, route: fell }).reasoningEffort === 'low')
  check('no signal key when there is no signal', !('signal' in ai.buildCallOptions({ prompt, route: fell })))

  // ── attribution: the cost meter files a call by its sessionId ────────────
  // The id becomes the HTTP header x-deepseek-harness-session-id, so only a
  // Latin-1 name may ride along; anything else files under the shared row.
  check('an ASCII book name becomes its own conversation', ai.attributionId({ id: 'My Book' }, '/books/My Book') === 'novel-studio:My Book')
  check('a CJK book name falls back to the shared conversation', ai.attributionId({ id: '星海拾遗' }, 'C:/books/星海拾遗') === 'novel-studio')
  check('the folder name is the fallback', ai.attributionId({}, 'C:\\books\\My Book\\') === 'novel-studio:My Book')
  check('a book with nothing to name still files somewhere', ai.attributionId({}, '') === 'novel-studio')
  check('no sessionId key when the call is not filed', !('sessionId' in ai.buildCallOptions({ prompt, route: explicit })))
  check('a filed call carries its conversation', ai.buildCallOptions({ prompt, route: fell, sessionId: 'novel-studio:x' }).sessionId === 'novel-studio:x')

  let filedOptions = null
  const filingLlm = {
    stream: (options) =>
      (async function* () {
        filedOptions = options
        yield { type: 'text-delta', text: '好' }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })(),
  }
  for await (const _event of ai.streamPrepared({
    prepared: { prompt, route: fell, history: [], bookDir: '', sessionId: 'novel-studio:test' },
    llm: filingLlm,
  })) { /* drain */ }
  check('the stream hands the conversation to the llm service', filedOptions?.sessionId === 'novel-studio:test', filedOptions?.sessionId)

  // ── history: prior turns, validated and capped before the stream ─────────
  check('no history means none', Array.isArray(ai.normalizeHistory(undefined)) && ai.normalizeHistory(undefined).length === 0)
  check('null history means none', ai.normalizeHistory(null).length === 0)
  const keptTurns = ai.normalizeHistory([
    { role: 'user', content: '接着写' },
    { role: 'assistant', content: '好的。' },
  ])
  check('well-formed turns pass through', keptTurns.length === 2 && keptTurns[0].role === 'user' && keptTurns[1].content === '好的。', keptTurns)
  await rejectsWith('history must be an array', () => ai.normalizeHistory('oops'), 'bad-history')
  await rejectsWith('a non-object turn is refused', () => ai.normalizeHistory(['x']), 'bad-history')
  await rejectsWith('only user and assistant may speak', () => ai.normalizeHistory([{ role: 'system', content: 'x' }]), 'bad-history')
  await rejectsWith('empty content is refused', () => ai.normalizeHistory([{ role: 'user', content: '   ' }]), 'bad-history')
  const overflow = ai.normalizeHistory(Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `t${i}` })))
  check('only the latest 12 turns are kept', overflow.length === 12 && overflow[0].content === 't8', { n: overflow.length, first: overflow[0]?.content })
  const overlong = ai.normalizeHistory([{ role: 'assistant', content: 'x'.repeat(9000) }])
  check('an overlong turn is clipped with an ellipsis', overlong[0].content.length <= 4001 && overlong[0].content.endsWith('…'), overlong[0].content.length)

  const histOpts = ai.buildCallOptions({
    prompt,
    route: fell,
    history: [{ role: 'user', content: '上一轮我问' }, { role: 'assistant', content: '上一轮我答' }],
  })
  check('history rides ahead of the fresh prompt', histOpts.messages.length === 3
    && histOpts.messages[0].role === 'user' && histOpts.messages[0].content[0].text === '上一轮我问'
    && histOpts.messages[1].role === 'assistant' && histOpts.messages[1].content[0].text === '上一轮我答'
    && histOpts.messages[2].content[0].text === 'USER', histOpts.messages.map((m) => m.role))

  // A handed-back answer must name the route that produced it: the llm service
  // replays an assistant turn from `source`, and without one the call dies with
  // "Cannot read properties of undefined (reading 'replayState')".
  check('a handed-back answer carries the route it came from',
    histOpts.messages[1].source?.provider === fell.provider && histOpts.messages[1].source?.model === fell.model,
    histOpts.messages[1].source)
  check('a handed-back question carries no source', histOpts.messages[0].source === undefined, histOpts.messages[0].source)
  check('the fresh prompt is a plain turn', histOpts.messages[2].source === undefined, histOpts.messages[2].source)

  // ── prepareTask ─────────────────────────────────────────────────────────
  await rejectsWith('a deployment with no llm is refused', () => ai.prepareTask({ llm: null, selection, bookDir: dir, book, request: { task: 'continue' } }), 'no-llm')
  await rejectsWith('an llm without stream is refused', () => ai.prepareTask({ llm: {}, selection, bookDir: dir, book, request: { task: 'continue' } }), 'no-llm')
  // The status decides what the HTTP layer says, so it is part of the contract:
  // a refused request is the caller's to fix (400), a missing service is not (503).
  const statusOf = async (fn) => {
    try {
      await fn()
      return 0
    } catch (err) {
      return err.status
    }
  }
  check('a request-level refusal is a 400', (await statusOf(() => ai.prepareTask({ llm: null, selection, bookDir: dir, book, request: { task: 'polish' } }))) === 400)
  check('a missing llm service is a 503', (await statusOf(() => ai.prepareTask({ llm: null, selection, bookDir: dir, book, request: { task: 'continue' } }))) === 503)
  await rejectsWith('an unknown task never reaches the model', () => ai.prepareTask({ llm: fakeLlm([]), selection, bookDir: dir, book, request: { task: 'nope' } }), 'unknown-task')
  // The request is judged before the deployment: a caller's mistake must not be
  // reported as a missing service.
  await rejectsWith('a malformed request outranks a missing service', () => ai.prepareTask({ llm: null, selection, bookDir: dir, book, request: { task: 'polish' } }), 'missing-argument')
  await rejectsWith('an unset model outranks a missing service', () => ai.prepareTask({ llm: null, selection: null, bookDir: dir, book, request: { task: 'continue' } }), 'no-model')

  const prepared = await ai.prepareTask({ llm: fakeLlm([]), selection, bookDir: dir, book, request: { task: 'continue' } })
  check('prepareTask returns context, prompt and route', Boolean(prepared.context && prepared.prompt && prepared.route), Object.keys(prepared))
  check('prepareTask resolved a real route', prepared.route.model === 'deepseek-flash')
  check('prepareTask built a grounded prompt', prepared.prompt.user.includes('星海拾遗'))

  // History is validated before anything else — including the llm check, so a
  // malformed thread is the caller's 400 even on a deployment with no model.
  await rejectsWith('a malformed history is refused', () => ai.prepareTask({ llm: null, selection, bookDir: dir, book, request: { task: 'continue', history: 'nope' } }), 'bad-history')
  check('a bad history is a 400, not a missing service', (await statusOf(() => ai.prepareTask({ llm: null, selection, bookDir: dir, book, request: { task: 'continue', history: [{ role: 'user' }] } }))) === 400)
  const withHist = await ai.prepareTask({ llm: fakeLlm([]), selection, bookDir: dir, book, request: { task: 'continue', history: [{ role: 'user', content: '接着写' }] } })
  check('prepareTask returns the normalized history', withHist.history?.length === 1 && withHist.history[0].content === '接着写', withHist.history)

  // ── streaming ───────────────────────────────────────────────────────────
  const seen = []
  const llm = fakeLlm([{ type: 'block-start' }, TEXT('他'), TEXT('抬起头。'), { type: 'usage', usage: { input: 10, output: 2 } }, { type: 'finish', reason: { kind: 'stop' } }], seen)
  const events = []
  for await (const event of ai.streamTask({ llm, selection, bookDir: dir, book, request: { task: 'continue' } })) events.push(event)

  check('the stream starts with a start event', events[0]?.type === 'start', events.map((e) => e.type))
  check('the stream ends with a done event', events[events.length - 1]?.type === 'done', events.map((e) => e.type))
  check('deltas are emitted in order', events.filter((e) => e.type === 'delta').map((e) => e.text).join('') === '他抬起头。', events.filter((e) => e.type === 'delta'))
  check('the done event carries the whole answer', events.at(-1)?.text === '他抬起头。', events.at(-1))
  check('the done event carries usage', events.at(-1)?.usage?.input === 10, events.at(-1)?.usage)
  check('the done event carries the finish reason', events.at(-1)?.finish?.kind === 'stop', events.at(-1)?.finish)
  check('the done event carries the route', events.at(-1)?.route?.model === 'deepseek-flash')
  check('the start event carries the prompt stats', typeof events[0]?.stats?.user === 'number', events[0]?.stats)
  check('exactly one done event', events.filter((e) => e.type === 'done').length === 1)
  check('non-text chunks are not turned into deltas', events.filter((e) => e.type === 'delta').length === 2, events)

  check('the model was called exactly once', seen.length === 1, seen.length)
  check('the call used the resolved provider and model', seen[0]?.provider === 'deepseek-account' && seen[0]?.model === 'deepseek-flash', { p: seen[0]?.provider, m: seen[0]?.model })
  check('the call carried the assembled prompt', String(seen[0]?.messages?.[0]?.content?.[0]?.text).includes('第一章'), String(seen[0]?.messages?.[0]?.content?.[0]?.text).slice(0, 80))
  check('the call carried a system prompt', String(seen[0]?.system).includes('续写'))
  check('the call carried a token budget', typeof seen[0]?.maxTokens === 'number' && seen[0].maxTokens > 0, seen[0]?.maxTokens)
  check('the call is filed under the novel studio', String(seen[0]?.sessionId).startsWith('novel-studio'), seen[0]?.sessionId)

  const budgeted = []
  for await (const _ of ai.streamTask({ llm: fakeLlm([TEXT('x')], budgeted), selection, bookDir: dir, book, request: { task: 'continue', maxTokens: 77 } })) { /* drain */ }
  check('a request budget reaches the provider', budgeted[0]?.maxTokens === 77, budgeted[0]?.maxTokens)

  const histSeen = []
  for await (const _ of ai.streamTask({
    llm: fakeLlm([TEXT('接')], histSeen),
    selection,
    bookDir: dir,
    book,
    request: { task: 'continue', history: [{ role: 'user', content: '上一轮我问' }, { role: 'assistant', content: '上一轮我答' }] },
  })) { /* drain */ }
  check('the provider receives the history', histSeen[0]?.messages?.length === 3, histSeen[0]?.messages?.length)
  check('history arrives oldest first, prompt last', histSeen[0]?.messages?.map((m) => m.role).join() === 'user,assistant,user'
    && histSeen[0].messages[0].content[0].text === '上一轮我问'
    && String(histSeen[0].messages[2].content[0].text).includes('第一章'), histSeen[0]?.messages?.map((m) => m.role))

  // ── provider failures ───────────────────────────────────────────────────
  const failed = fakeLlm([TEXT('半'), { type: 'finish', reason: { kind: 'error', failure: { message: '余额不足' } } }])
  let failedEvents = []
  await rejectsWith(
    'a provider error is surfaced, not swallowed',
    async () => {
      for await (const event of ai.streamTask({ llm: failed, selection, bookDir: dir, book, request: { task: 'continue' } })) failedEvents.push(event)
    },
    'llm-error',
  )
  check('text already streamed is still delivered before the failure', failedEvents.some((e) => e.type === 'delta' && e.text === '半'), failedEvents)

  const aborted = fakeLlm([{ type: 'finish', reason: { kind: 'aborted', failure: { message: '已中止' } } }])
  await rejectsWith(
    'an abort is reported as an abort',
    async () => {
      for await (const _ of ai.streamTask({ llm: aborted, selection, bookDir: dir, book, request: { task: 'continue' } })) { /* drain */ }
    },
    'aborted',
  )

  const silent = fakeLlm([{ type: 'finish', reason: { kind: 'error' } }])
  await rejectsWith(
    'an error with no message still fails',
    async () => {
      for await (const _ of ai.streamTask({ llm: silent, selection, bookDir: dir, book, request: { task: 'continue' } })) { /* drain */ }
    },
    'llm-error',
  )

  const streamed = fakeLlm([TEXT('甲'), TEXT('乙')], seen.splice(0))
  const compact = await ai.runTask({ llm: streamed, selection, bookDir: dir, book, request: { task: 'continue' } })
  check('runTask returns the joined answer', compact.text === '甲乙', compact.text)
  check('runTask returns the metadata too', compact.task === 'continue' && compact.route?.model === 'deepseek-flash', compact.task)

  // ── contextPreview ──────────────────────────────────────────────────────
  const preview = await ai.contextPreview(dir, book, { task: 'continue' })
  check('the preview counts characters', preview.characters.length === 2, preview.characters)
  check('the preview counts rules and chapters', preview.rules === 1 && preview.chapters === 2, preview)
  check('the preview names the chapter it would send', preview.chapter?.id === '第二章', preview.chapter)
  check('the preview reports the chapter word count', preview.chapter?.words > 0, preview.chapter)
  check('the preview is serializable', JSON.stringify(preview).length > 0)
  const catKeys = (preview.catalog || []).map((p) => p.key)
  check('the preview carries the picker catalogue', catKeys.includes('characters') && catKeys.includes('world/locations') && catKeys.includes('world/timeline'), catKeys)
  const catLoc = (preview.catalog || []).find((p) => p.key === 'world/locations')
  check('a catalogue pool names itself', catLoc?.zh === '地点', catLoc?.zh)
  check('a catalogue entry carries id, label and on', catLoc?.items?.[0]?.id === '拾荒港' && catLoc.items[0].label === '拾荒港' && catLoc.items[0].on === true, catLoc?.items?.[0])
  check('a catalogue pool counts what is selected', catLoc?.picked === 1, catLoc)
  check('an empty pool stays out of the catalogue', !catKeys.includes('world/factions'), catKeys)

  const pickedPreview = await ai.contextPreview(dir, book, { task: 'continue', pick: { characters: ['老周'] } })
  check('the preview honours the pick', pickedPreview.characters.length === 1 && pickedPreview.characters[0] === '老周', pickedPreview.characters)
  const catChars = (pickedPreview.catalog || []).find((p) => p.key === 'characters')
  check('an unchecked entry is still listed, marked off', catChars?.items?.filter((i) => i.on).length === 1 && catChars.items.some((i) => i.on === false), catChars?.items)
  check('the catalogue count follows the pick', catChars?.picked === 1, catChars?.picked)

  // ── the task menu is exposed for the panel ──────────────────────────────
  const tasks = await ai.aiTasks()
  check('the AI layer exposes the task menu', tasks.length === 4 && tasks[0].key === 'continue', tasks.map((t) => t.key))
  check('the menu is serializable', typeof JSON.stringify(tasks) === 'string')
  check('no built-in task claims an extension', tasks.every((t) => t.extension === undefined), tasks.map((t) => t.extension))

  // ── the novel_ai tool: the same engine, from the chat side ──────────────
  {
    const toolsMod = await fresh('tools.js', tag)
    const apiMod = await fresh('api.js', tag)
    const defs = await toolsMod.buildTools()
    const novelAi = defs.find((d) => d.name === 'novel_ai')
    check('the tool set advertises novel_ai', Boolean(novelAi), defs.map((d) => d.name))
    check('TOOL_NAMES lists novel_ai', toolsMod.TOOL_NAMES.includes('novel_ai'), toolsMod.TOOL_NAMES)

    const listed = await novelAi.execute({ action: 'list' })
    check('novel_ai lists the task menu', listed.ok === true && listed.tasks?.length === 4 && listed.tasks[0].key === 'continue', listed)
    const badAction = await novelAi.execute({ action: 'summarize' })
    check('an unknown action is a refusal value', badAction.ok === false && badAction.code === 'unknown-action', badAction)
    const noBook = await novelAi.execute({ action: 'context' })
    check('a missing book is refused', noBook.ok === false && noBook.code === 'missing-argument', noBook)

    const preview = await novelAi.execute({ action: 'context', book: made.book.id, pick: { characters: ['老周'] } })
    check('the context action previews without a model', preview.ok === true && preview.context?.characters?.length === 1, preview.context?.characters)

    // The tool reads llm/selection from api.js's live services object — the
    // same handle index.js wires — so a fake llm can stand in right there.
    const runSeen = []
    apiMod.setServices({ llm: fakeLlm([TEXT('接着写。')], runSeen), selection: () => selection })
    try {
      const ran = await novelAi.execute({ action: 'run', book: made.book.id, task: 'continue', history: [{ role: 'user', content: '上一轮我问' }] })
      check('the run action returns the answer', ran.ok === true && ran.text === '接着写。', ran)
      check('the run carried history to the model', runSeen[0]?.messages?.length === 2
        && runSeen[0].messages[0].content[0].text === '上一轮我问', runSeen[0]?.messages?.length)
      const badHist = await novelAi.execute({ action: 'run', book: made.book.id, history: [{ role: 'user' }] })
      check('a malformed history surfaces as a refusal value', badHist.ok === false && badHist.code === 'bad-history', badHist)

      apiMod.setServices({ llm: null, selection: () => selection })
      const noLlm = await novelAi.execute({ action: 'run', book: made.book.id })
      check('no deployment llm is named, not thrown', noLlm.ok === false && noLlm.code === 'no-llm', noLlm)
    } finally {
      apiMod.setServices({ llm: null, selection: () => null })
    }
  }

  // ── the extension seam ──────────────────────────────────────────────────
  console.log('\nextension ai task')
  {
    const src = [
      `export const id = 'test-ai'`,
      `export const zh = '测试 AI 任务'`,
      `export const ai = [`,
      `  {`,
      `    key: 'timeline', zh: '年表推演', en: 'Timeline',`,
      `    hint: '把已写的情节按时间排一遍',`,
      `    maxTokens: 900,`,
      `    system: '你是年表编辑。',`,
      `    frame: (request, context) => '按时间排一遍。' + (request.instruction || ''),`,
      `  },`,
      `  { key: 'polish', zh: '影子任务', frame: () => 'shadow' },`,
      `  { key: 'no-frame', zh: '没有 frame' },`,
      `]`,
      ``,
    ].join('\n')
    await writeFile(join(EXT_DIR, EXT_NAME), src, 'utf8')
    createdExt = true

    const ai2 = await fresh('ai.js', 'e2')

    const menu = await ai2.aiTasks()
    const keys = menu.map((t) => t.key)
    check('the extension task appears', keys.includes('timeline'), keys)
    check('the extension task is listed last', keys[keys.length - 1] === 'timeline', keys)
    check('a task without a frame is dropped', !keys.includes('no-frame'), keys)
    check('a shadowing task is dropped', keys.filter((k) => k === 'polish').length === 1, keys)
    check('the built-in polish still wins', menu.find((t) => t.key === 'polish').zh === '润色', menu.find((t) => t.key === 'polish'))
    check('the menu names the contributing extension', menu.find((t) => t.key === 'timeline').extension === 'test-ai', menu.find((t) => t.key === 'timeline'))
    check('the extension task keeps its own maxTokens', menu.find((t) => t.key === 'timeline').maxTokens === 900)
    check('the extension task defaults to needs=none', menu.find((t) => t.key === 'timeline').needs === 'none')

    // It must be runnable, not just listed.
    const preparedExt = await ai2.prepareTask({ llm: fakeLlm([]), selection, bookDir: dir, book, request: { task: 'timeline' } })
    check('an extension task builds a prompt', preparedExt.prompt.task === 'timeline', preparedExt.prompt.task)
    check('an extension task brings its own system', preparedExt.prompt.system.includes('你是年表编辑。'), preparedExt.prompt.system.slice(0, 80))
    check('an extension task is grounded in the book', preparedExt.prompt.user.includes('星海拾遗'))
    check('an extension task still honours maxTokens', preparedExt.prompt.maxTokens === 900, preparedExt.prompt.maxTokens)
    check('the grounding persona is always present', preparedExt.prompt.system.includes('设定高于即兴发挥'))

    const report = await (await fresh('schema.js', 'e2')).getSchema()
    check('the extension report counts ai tasks', report.extensions.find((e) => e.file === EXT_NAME)?.ai === 3, report.extensions.find((e) => e.file === EXT_NAME))
  }

  // ── a requested answer length ───────────────────────────────────────────
  console.log('\nrequested length')
  {
    const plain = await ai.prepareTask({ llm: fakeLlm([]), selection, bookDir: dir, book, request: { task: 'continue', chapter: '第二章' } })
    check('no length asked for reads as zero', plain.prompt.words === 0, plain.prompt.words)
    check('no length asked for stays out of the prompt', !plain.prompt.user.includes('篇幅要求'), plain.prompt.user.slice(-120))
    check('no length asked for keeps the task budget', plain.prompt.maxTokens === 1600, plain.prompt.maxTokens)

    const asked = await ai.prepareTask({ llm: fakeLlm([]), selection, bookDir: dir, book, request: { task: 'continue', chapter: '第二章', words: 800 } })
    check('the requested length is echoed back', asked.prompt.words === 800, asked.prompt.words)
    check('the requested length is voiced in the prompt', asked.prompt.user.includes('800 字左右'), asked.prompt.user.slice(-120))
    check('the requested length lifts the budget', asked.prompt.maxTokens === 1600, asked.prompt.maxTokens)

    const big = await ai.prepareTask({ llm: fakeLlm([]), selection, bookDir: dir, book, request: { task: 'continue', chapter: '第二章', words: 3000 } })
    check('a long request raises the budget above the default', big.prompt.maxTokens === 6000, big.prompt.maxTokens)

    const capped = await ai.prepareTask({ llm: fakeLlm([]), selection, bookDir: dir, book, request: { task: 'continue', chapter: '第二章', words: 20000 } })
    check('the budget is still capped at 8000', capped.prompt.maxTokens === 8000, capped.prompt.maxTokens)

    const explicit = await ai.prepareTask({ llm: fakeLlm([]), selection, bookDir: dir, book, request: { task: 'continue', chapter: '第二章', words: 3000, maxTokens: 200 } })
    check('an explicit maxTokens beats the derived one', explicit.prompt.maxTokens === 200, explicit.prompt.maxTokens)

    const numeric = await ai.prepareTask({ llm: fakeLlm([]), selection, bookDir: dir, book, request: { task: 'continue', chapter: '第二章', words: '800' } })
    check('a numeric string is understood', numeric.prompt.words === 800, numeric.prompt.words)

    const empty = await ai.prepareTask({ llm: fakeLlm([]), selection, bookDir: dir, book, request: { task: 'continue', chapter: '第二章', words: '' } })
    check('an empty length means no requirement', empty.prompt.words === 0 && empty.prompt.maxTokens === 1600, empty.prompt)

    await rejectsWith('a length that is not a number is refused', () => ai.prepareTask({ llm: fakeLlm([]), selection, bookDir: dir, book, request: { task: 'continue', chapter: '第二章', words: '很多' } }), 'missing-argument')
    await rejectsWith('a negative length is refused', () => ai.prepareTask({ llm: fakeLlm([]), selection, bookDir: dir, book, request: { task: 'continue', chapter: '第二章', words: -5 } }), 'missing-argument')
    await rejectsWith('a fractional length is refused', () => ai.prepareTask({ llm: fakeLlm([]), selection, bookDir: dir, book, request: { task: 'continue', chapter: '第二章', words: 1.5 } }), 'missing-argument')
    await rejectsWith('an absurd length is refused', () => ai.prepareTask({ llm: fakeLlm([]), selection, bookDir: dir, book, request: { task: 'continue', chapter: '第二章', words: 20001 } }), 'missing-argument')

    // The stream announces the length it settled on, so the panel never has to
    // guess whether its number made it into the call.
    const seenStart = []
    for await (const event of ai.streamTask({
      llm: fakeLlm([TEXT('好'), { type: 'finish', reason: { kind: 'stop' } }]),
      selection,
      bookDir: dir,
      book,
      request: { task: 'continue', chapter: '第二章', words: 500 },
    })) {
      if (event.type === 'start') seenStart.push(event)
    }
    check('the start event announces the requested length', seenStart[0]?.words === 500, seenStart[0])
  }

  // ── the token ledger ────────────────────────────────────────────────────
  console.log('\ntoken ledger')
  {
    const usage = await fresh('usage.js', tag)
    const zeros = await usage.readUsage(dir)
    check('a book that never ran reads as zeros', zeros.runs === 0 && zeros.total === 0, zeros)
    check('the zero ledger names its version', zeros.version === 1, zeros.version)

    const snake = usage.usageCounters({ prompt_tokens: 10, completion_tokens: 5 })
    check('snake_case spellings are understood', snake.input === 10 && snake.output === 5, snake)
    check('a missing total is summed', snake.total === 15, snake.total)
    const camel = usage.usageCounters({ inputTokens: 3, outputTokens: 4, cacheReadTokens: 5, cacheWriteTokens: 6 })
    check('camelCase spellings are understood', camel.input === 3 && camel.output === 4 && camel.cacheRead === 5 && camel.cacheWrite === 6, camel)
    check('the sum includes the cache counters', camel.total === 18, camel.total)
    const believed = usage.usageCounters({ inputTokens: 229, outputTokens: 647, cacheReadTokens: 1792, totalTokens: 2668 })
    check('a provider total is believed, not recomputed', believed.total === 2668, believed.total)
    check('nonsense is read as nothing', usage.usageCounters({ inputTokens: 'lots' }).total === 0, usage.usageCounters({ inputTokens: 'lots' }))

    const first = await usage.noteUsage(dir, { inputTokens: 100, outputTokens: 50, totalTokens: 150 })
    check('a round is recorded', first.runs === 1 && first.input === 100 && first.output === 50 && first.total === 150, first)
    check('the ledger dates itself', typeof first.since === 'string' && typeof first.updatedAt === 'string', first)
    check('the first round is also the starting point', first.since === first.updatedAt, first)

    const second = await usage.noteUsage(dir, { promptTokens: 1, completionTokens: 1 })
    check('a second round adds up', second.runs === 2 && second.input === 101 && second.output === 51 && second.total === 152, second)
    check('the starting point does not move', second.since === first.since, { was: first.since, now: second.since })

    const reread = await usage.readUsage(dir)
    check('the ledger survives a re-read', reread.runs === 2 && reread.total === 152, reread)

    const nothing = await usage.noteUsage(dir, {})
    check('a round that reported nothing is not counted', nothing.runs === 2, nothing)

    const cleared = await usage.resetUsage(dir)
    check('reset zeroes every counter', cleared.runs === 0 && cleared.total === 0 && cleared.input === 0 && cleared.since === null, cleared)

    // The seam that matters: a real round through the AI layer writes the ledger
    // itself, so the total does not depend on any client having been open.
    await ai.runTask({
      llm: fakeLlm([TEXT('夜里'), { type: 'usage', usage: { inputTokens: 7, outputTokens: 3, totalTokens: 10 } }, { type: 'finish', reason: { kind: 'stop' } }]),
      selection,
      bookDir: dir,
      book,
      request: { task: 'continue', chapter: '第二章' },
    })
    const counted = await usage.readUsage(dir)
    check('a round counts itself', counted.runs === 1 && counted.input === 7 && counted.output === 3 && counted.total === 10, counted)

    await ai.runTask({
      llm: fakeLlm([TEXT('船'), { type: 'finish', reason: { kind: 'stop' } }]),
      selection,
      bookDir: dir,
      book,
      request: { task: 'continue', chapter: '第二章' },
    })
    const unreported = await usage.readUsage(dir)
    check('a provider that reports nothing adds no round', unreported.runs === 1, unreported)

    // Tokens spent on a round that ends badly are still spent.
    await ai.runTask({
      llm: fakeLlm([TEXT('半'), { type: 'usage', usage: { inputTokens: 2, outputTokens: 1 } }, { type: 'finish', reason: { kind: 'error', failure: { message: '网络断了' } } }]),
      selection,
      bookDir: dir,
      book,
      request: { task: 'continue', chapter: '第二章' },
    }).catch(() => {})
    const afterFailure = await usage.readUsage(dir)
    check('a failed round is still counted', afterFailure.runs === 2 && afterFailure.input === 9, afterFailure)

    await usage.resetUsage(dir)
  }
} finally {
  if (createdExt) await rm(join(EXT_DIR, EXT_NAME), { force: true })
  if (created) {
    try {
      await invoke('books', { action: 'delete', book: bookId })
    } catch {
      /* the temp root goes away anyway */
    }
  }
  await rm(ROOT, { recursive: true, force: true })
}

// ── report ────────────────────────────────────────────────────────────────
if (failures.length) {
  console.error(`\n${failures.length} FAILED:`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  console.error(`\nai.smoke: ${passed} passed, ${failures.length} failed`)
  process.exit(1)
}
console.log(`ai.smoke: ${passed} passed, 0 failed`)
