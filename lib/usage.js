/**
 * Token accounting for one book.
 *
 * Every AI round the host runs writes its provider-reported usage here — one
 * `usage.yaml` per book — so "how much has this book spent" is a property of the
 * book rather than of whoever happened to have the panel open. The counters are
 * cumulative and never derived again from history, so a reload, a restart or a
 * second extension calling the same route all see the same running total.
 *
 * Counting is best-effort by design: a provider that reports nothing adds
 * nothing, and a write failure must never fail the model call that earned it.
 */
const V = new URL(import.meta.url).searchParams.get('v') ?? '0'

const { atomicWrite, readYamlFile } = await import(`./library.js?v=${V}`)

const { join } = await import('node:path')

export const USAGE_FILE = 'usage.yaml'
export const USAGE_VERSION = 1

/** The five counters this ledger keeps, in the order the panel shows them. */
export const USAGE_COUNTERS = ['input', 'output', 'cacheRead', 'cacheWrite', 'total']

/**
 * Provider usage objects are not shaped alike — one calls it `inputTokens`,
 * another `prompt_tokens`, a third nests nothing at all. Take the first key
 * that is genuinely there, and treat a hit of 0 as a real value.
 */
function pick(source, keys) {
  for (const key of keys) {
    const value = Number(source?.[key])
    if (Number.isFinite(value) && value >= 0) return Math.round(value)
  }
  return null
}

/**
 * One provider usage object as the counters this ledger keeps.
 *
 * `total` is taken from the provider when it says so, and otherwise summed —
 * note that a provider's own total may *include* its cache counters, so the sum
 * is a fallback, not a correction.
 */
export function usageCounters(usage) {
  const input = pick(usage, ['inputTokens', 'input_tokens', 'promptTokens', 'prompt_tokens']) ?? 0
  const output = pick(usage, ['outputTokens', 'output_tokens', 'completionTokens', 'completion_tokens']) ?? 0
  const cacheRead = pick(usage, ['cacheReadTokens', 'cacheReadInputTokens', 'cache_read_input_tokens']) ?? 0
  const cacheWrite = pick(usage, ['cacheWriteTokens', 'cacheCreationTokens', 'cache_creation_input_tokens']) ?? 0
  const total = pick(usage, ['totalTokens', 'total_tokens']) ?? input + output + cacheRead + cacheWrite
  return { input, output, cacheRead, cacheWrite, total }
}

/** True when a usage object carries no spend at all — nothing to record. */
export function isEmptyUsage(usage) {
  const counters = usageCounters(usage)
  return !Object.values(counters).some((n) => n > 0)
}

const fileOf = (bookDir) => join(bookDir, USAGE_FILE)

function counter(value) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0
}

/**
 * The ledger as it stands. A book that never ran a call reads as all zeros
 * rather than as an error, and a hand-edited file only has its unknown keys
 * ignored.
 */
export async function readUsage(bookDir) {
  const raw = await readYamlFile(fileOf(bookDir), null)
  const data = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const out = {
    version: USAGE_VERSION,
    runs: Number.isFinite(Number(data.runs)) ? Math.max(0, Math.round(Number(data.runs))) : 0,
    since: typeof data.since === 'string' ? data.since : null,
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : null,
  }
  for (const key of USAGE_COUNTERS) out[key] = counter(data[key])
  return out
}

/** Add one round's usage to the ledger and return the new running totals. */
export async function noteUsage(bookDir, usage) {
  const add = usageCounters(usage)
  // A provider that reports nothing must not bump the round count either — the
  // panel would then claim a run it cannot account for.
  if (!USAGE_COUNTERS.some((key) => add[key] > 0)) return readUsage(bookDir)
  const was = await readUsage(bookDir)
  const at = new Date().toISOString()
  const next = {
    version: USAGE_VERSION,
    runs: was.runs + 1,
    since: was.since || at,
    updatedAt: at,
  }
  for (const key of USAGE_COUNTERS) next[key] = was[key] + add[key]
  await atomicWrite(fileOf(bookDir), JSON.stringify(next, null, 2) + '\n')
  return next
}

/** Forget everything this book has spent so far. */
export async function resetUsage(bookDir) {
  const next = { version: USAGE_VERSION, runs: 0, since: null, updatedAt: null }
  for (const key of USAGE_COUNTERS) next[key] = 0
  await atomicWrite(fileOf(bookDir), JSON.stringify(next, null, 2) + '\n')
  return next
}
