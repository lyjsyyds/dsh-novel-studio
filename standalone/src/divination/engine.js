import { get_meta, run_cast, run_cross, run_recognize } from './compiled-engine.js'

const data = (value) => JSON.parse(JSON.stringify(value))
const meta = data(get_meta())
const manifests = new Map(meta.manifests.map((entry) => [entry.key, entry]))
const pad = (n) => String(n).padStart(2, '0')
function deviceTime() {
  const time = new Date()
  return [time.getFullYear(), pad(time.getMonth() + 1), pad(time.getDate())].join('-') + 'T'
    + [time.getHours(), time.getMinutes(), time.getSeconds()].map(pad).join(':')
}

function timestamp(value) {
  if (!value) return deviceTime()
  const parsed = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value)
  if (!parsed) throw new Error('请填写有效的起卦时间。')
  const [year, month, day, hour, minute, second = 0] = parsed.slice(1).map((part) => part === undefined ? undefined : Number(part))
  const calendar = new Date(0)
  calendar.setUTCFullYear(year, month - 1, day)
  calendar.setUTCHours(hour, minute, second)
  if (year < 1 || calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day
    || calendar.getUTCHours() !== hour || calendar.getUTCMinutes() !== minute || calendar.getUTCSeconds() !== second) {
    throw new Error('请填写有效的起卦时间。')
  }
  return value.length === 16 ? value + ':00' : value
}

function text(value, max) { return typeof value === 'string' ? value.trim().slice(0, max) : '' }
function numbers(value) {
  if (!Array.isArray(value) || value.length > 12 || !value.every((entry) => Number.isSafeInteger(entry) && Math.abs(entry) <= 100000000)) return []
  return value
}

export function getMeta() { return meta }

export function recognizeInput(input = {}) {
  const system = text(input.locked_shushu, 32)
  const method = text(input.locked_method, 32)
  return { recognition: data(run_recognize(text(input.question, 2000), numbers(input.numbers),
    manifests.has(system) ? system : null, manifests.get(system)?.methods.some((option) => option.key === method) ? method : null)) }
}

export function castInput(input = {}) {
  const question = text(input.question, 2000)
  if (!question) throw new Error('请先输入创作问题。')
  const manifest = manifests.get(input.shushu)
  if (!manifest) throw new Error('请选择卦术。')
  const method = manifest.methods.find(({ key }) => key === input.method)
    || (manifest.isAux && !input.method ? manifest.methods[0] : null)
  if (!method) throw new Error('请选择当前卦术的起卦方式。')
  const values = method.key === 'number' ? numbers(input.numbers) : []
  if (method.requires.includes('numbers') && !values.length) throw new Error('请至少输入一个有效整数。')
  const coins = input.coins
  if (coins != null && (manifest.key !== 'liuyao' || method.key !== 'coin' || !Array.isArray(coins) || coins.length !== 6
    || !coins.every((row) => Array.isArray(row) && row.length === 3 && row.every((v) => v === 2 || v === 3)))) {
    throw new Error('铜钱记录需要六组，每组三枚，填 2 或 3。')
  }
  const effective = { question, category: text(input.category, 80), shushu: manifest.key, method: method.key,
    timestamp: timestamp(input.timestamp), seed: text(input.seed, 128) || crypto.randomUUID(),
    numbers: values, coins: coins ?? null }
  const result = data(run_cast(question, effective.category, effective.shushu, effective.method, effective.timestamp,
    effective.seed, values, effective.coins))
  return { ...result, studioInput: effective }
}

export function crossInput(input = {}) {
  return data(run_cross(text(input.question, 2000), text(input.category, 80), timestamp(input.timestamp), text(input.seed, 128)))
}
