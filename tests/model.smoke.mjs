// The per-book model route: stored on the book, resolved per book, and never
// leaking into the deployment default or into another book.
//
// Offline — a fake llm stands in, so nothing is called and nothing is billed.
//
// Run: node tests/model.smoke.mjs

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const LIB = resolve(HERE, '..', 'lib')

const ROOT = await mkdtemp(join(tmpdir(), 'novel-model-'))
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

const tag = `m${Date.now()}`
const { invoke } = await fresh('ops.js', tag)
const { readBook, updateBook } = await fresh('library.js', tag)
const ai = await fresh('ai.js', tag)

// The deployment default every book inherits until it chooses its own.
const DEFAULT = { provider: 'harness', model: 'default-model', reasoningEffort: 'low' }

let bookA = ''
let bookB = ''
let recA = {}
let recB = {}
let created = false

try {
  // ── normalizeModel ──────────────────────────────────────────────────────
  check('nothing reads as unset', ai.normalizeModel(null) === null && ai.normalizeModel(undefined) === null)
  check('a non-object reads as unset', ai.normalizeModel('deepseek') === null && ai.normalizeModel(7) === null)
  check('an array reads as unset', ai.normalizeModel([{ provider: 'a', model: 'b' }]) === null)
  check('a provider without a model reads as unset', ai.normalizeModel({ provider: 'a' }) === null)
  check('a model without a provider reads as unset', ai.normalizeModel({ model: 'b' }) === null)
  check('blank strings read as unset', ai.normalizeModel({ provider: '  ', model: '  ' }) === null)
  const full = ai.normalizeModel({ provider: ' ollama ', model: ' qwen3 ' })
  check('a full route is trimmed', full.provider === 'ollama' && full.model === 'qwen3', full)
  check('an unspecified effort stays off the route', full.reasoningEffort === undefined, full)
  check('an effort is carried when given', ai.normalizeModel({ provider: 'a', model: 'b', reasoningEffort: 'high' }).reasoningEffort === 'high')
  check('numbers are coerced to strings', ai.normalizeModel({ provider: 1, model: 2 }).model === '2', ai.normalizeModel({ provider: 1, model: 2 }))

  // ── bookSelection ───────────────────────────────────────────────────────
  check('no book model leaves the default alone', ai.bookSelection({}, DEFAULT) === DEFAULT)
  check('no default and no book model is null', ai.bookSelection({}, null) === null)
  const own = ai.bookSelection({ aiModel: { provider: 'ollama', model: 'qwen3' } }, DEFAULT)
  check('a book model wins over the default', own.provider === 'ollama' && own.model === 'qwen3', own)
  check('a different route drops the default effort', own.reasoningEffort === undefined, own)
  const same = ai.bookSelection({ aiModel: { provider: 'harness', model: 'default-model' } }, DEFAULT)
  check('the same route keeps the default effort', same.reasoningEffort === 'low', same)
  const ownEffort = ai.bookSelection({ aiModel: { provider: 'harness', model: 'default-model', reasoningEffort: 'high' } }, DEFAULT)
  check('a book effort beats the default effort', ownEffort.reasoningEffort === 'high', ownEffort)
  const half = ai.bookSelection({ aiModel: { provider: 'ollama' } }, DEFAULT)
  check('a half-filled book record falls back to the default', half.provider === 'harness' && half.model === 'default-model', half)
  const thunk = ai.bookSelection({ aiModel: { provider: 'ollama', model: 'qwen3' } }, () => DEFAULT)
  check('the default may be a thunk', thunk.model === 'qwen3', thunk)

  // ── resolveRoute on the merged selection ────────────────────────────────
  const merged = ai.bookSelection({ aiModel: { provider: 'ollama', model: 'qwen3' } }, DEFAULT)
  const viaBook = ai.resolveRoute({}, merged)
  check('resolveRoute takes the book route', viaBook.provider === 'ollama' && viaBook.model === 'qwen3', viaBook)
  const reqWins = ai.resolveRoute({ model: 'explicit' }, merged)
  check('a request still overrides the book route', reqWins.model === 'explicit' && reqWins.provider === 'ollama', reqWins)
  await rejectsWith('no book route and no default is refused', () => ai.resolveRoute({}, ai.bookSelection({}, null)), 'no-model')

  // ── the catalogue the host reports ──────────────────────────────────────
  // The host half shapes it, so the panel offers what this deployment can run.
  // Field names are not pinned in the llm contract, so all spellings are read.
  const { shapeCatalog } = await fresh('index.js', tag)
  const shaped = await shapeCatalog(
    [
      { id: 'deepseek-account', name: 'DeepSeek' },
      { key: 'ollama' },
      { provider: 'openai', label: 'OpenAI' },
      { noname: true },
      null,
    ],
    async (id) => (id === 'deepseek-account' ? [{ id: 'deepseek-flash', name: 'Flash' }, { model: 'deepseek-pro' }, { nope: 1 }] : []),
  )
  check('providers are read in all three spellings', shaped.providers.map((p) => p.id).join() === 'deepseek-account,ollama,openai', shaped.providers)
  check('a provider label comes from name or label', shaped.providers[0].name === 'DeepSeek' && shaped.providers[2].name === 'OpenAI', shaped.providers)
  check('a provider without a label falls back to its id', shaped.providers[1].name === 'ollama', shaped.providers[1])
  check('models are read in all three spellings', shaped.providers[0].models.map((m) => m.id).join() === 'deepseek-flash,deepseek-pro', shaped.providers[0].models)
  check('a model without a label falls back to its id', shaped.providers[0].models[1].name === 'deepseek-pro', shaped.providers[0].models)
  check('an unidentifiable provider is dropped', shaped.providers.length === 3, shaped.providers.map((p) => p.id))
  check('a provider with nothing to list still appears', shaped.providers[1].models.length === 0, shaped.providers[1])
  const broken = await shapeCatalog([{ id: 'p' }], async () => {
    throw new Error('boom')
  })
  check('a listing failure is swallowed, not fatal', broken.providers.length === 1 && broken.providers[0].models.length === 0, broken)
  const emptyCatalog = await shapeCatalog(null, null)
  check('nothing reported is an empty catalogue', emptyCatalog.providers.length === 0, emptyCatalog)

  // ── two books, two routes ───────────────────────────────────────────────
  const madeA = await invoke('books', { action: 'create', title: 'model-a', meta: { author: 'test' } })
  const madeB = await invoke('books', { action: 'create', title: 'model-b', meta: { author: 'test' } })
  if (!madeA.ok || !madeB.ok) throw new Error(`could not create the test books: ${JSON.stringify([madeA, madeB])}`)
  created = true
  bookA = madeA.book.id
  bookB = madeB.book.id
  const detailA = await invoke('books', { action: 'get', book: bookA })
  const detailB = await invoke('books', { action: 'get', book: bookB })
  recA = detailA.book
  recB = detailB.book
  await invoke('records', { action: 'write', book: bookA, section: 'chapters', data: { title: '第一章', body: '夜里，船离港了。' } })
  await invoke('records', { action: 'write', book: bookB, section: 'chapters', data: { title: '第一章', body: '浪把灯打灭了。' } })

  // What the /library/:book/model POST writes.
  await updateBook(ROOT, bookA, { aiModel: { provider: 'ollama', model: 'qwen3', reasoningEffort: 'high' } })
  await updateBook(ROOT, bookB, { aiModel: { provider: 'other', model: 'other-model' } })

  const afterA = await readBook(ROOT, bookA)
  const afterB = await readBook(ROOT, bookB)
  check('the book route round-trips through book.yaml', afterA.aiModel?.provider === 'ollama' && afterA.aiModel?.model === 'qwen3', afterA.aiModel)
  check('the effort round-trips too', afterA.aiModel?.reasoningEffort === 'high', afterA.aiModel)
  check('the second book keeps its own route', afterB.aiModel?.model === 'other-model', afterB.aiModel)
  check('one book writes nothing into the other', afterA.aiModel?.model !== afterB.aiModel?.model)

  await updateBook(ROOT, bookB, { aiModel: null })
  const clearedB = await readBook(ROOT, bookB)
  check('clearing writes an unset route', ai.normalizeModel(clearedB.aiModel) === null, clearedB.aiModel)
  const untouchedA = await readBook(ROOT, bookA)
  check('clearing one book leaves the other alone', untouchedA.aiModel?.model === 'qwen3', untouchedA.aiModel)

  // ── the route actually reaches the call ─────────────────────────────────
  const bookNow = await readBook(ROOT, bookA)
  const seen = []
  const prep = await ai.prepareTask({
    llm: fakeLlm([TEXT('接着写。')], seen),
    selection: () => DEFAULT,
    bookDir: bookNow.dir,
    book: bookNow,
    request: { task: 'continue' },
  })
  check('prepareTask resolves the book route', prep.route.provider === 'ollama' && prep.route.model === 'qwen3', prep.route)
  check('the book effort is used', prep.route.reasoningEffort === 'high', prep.route)

  const events = []
  for await (const event of ai.streamTask({
    llm: fakeLlm([TEXT('接着写。')], seen),
    selection: () => DEFAULT,
    bookDir: bookNow.dir,
    book: bookNow,
    request: { task: 'continue' },
  })) {
    events.push(event)
  }
  check('the call carried the book provider', seen[0]?.provider === 'ollama', seen[0])
  check('the call carried the book model', seen[0]?.model === 'qwen3', seen[0])
  check('the call carried the book effort', seen[0]?.reasoningEffort === 'high', seen[0])
  check('the run still streamed to the end', events.some((e) => e.type === 'done'), events.map((e) => e.type))

  // A book that has not chosen inherits the deployment default, unchanged.
  const bare = await readBook(ROOT, bookB)
  const bareSeen = []
  for await (const _ of ai.streamTask({
    llm: fakeLlm([TEXT('x')], bareSeen),
    selection: () => DEFAULT,
    bookDir: bare.dir,
    book: bare,
    request: { task: 'continue' },
  })) {
    /* drain */
  }
  check('an unset book runs on the default provider', bareSeen[0]?.provider === 'harness', bareSeen[0])
  check('an unset book runs on the default model', bareSeen[0]?.model === 'default-model', bareSeen[0])
  check('an unset book keeps the default effort', bareSeen[0]?.reasoningEffort === 'low', bareSeen[0])

  // A request-level override still outranks the book, as before.
  const reqSeen = []
  for await (const _ of ai.streamTask({
    llm: fakeLlm([TEXT('x')], reqSeen),
    selection: () => DEFAULT,
    bookDir: bookNow.dir,
    book: bookNow,
    request: { task: 'continue', provider: 'pinned', model: 'pinned-model' },
  })) {
    /* drain */
  }
  check('a request override outranks the book route', reqSeen[0]?.provider === 'pinned' && reqSeen[0]?.model === 'pinned-model', reqSeen[0])
} finally {
  if (created) {
    try {
      await invoke('books', { action: 'delete', book: bookA })
    } catch {
      /* already gone */
    }
    try {
      await invoke('books', { action: 'delete', book: bookB })
    } catch {
      /* already gone */
    }
  }
  await rm(ROOT, { recursive: true, force: true })
}

for (const line of failures) console.log(`FAIL  ${line}`)
console.log(`\nmodel.smoke: ${passed} passed, ${failures.length} failed`)
if (failures.length) process.exitCode = 1
