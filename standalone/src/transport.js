import { Buffer } from 'buffer'
import { dispatch, setServices } from '../../lib/api.js'
import { native, platform, providerEvents } from './platform.js'
import { readFile, writeFile } from './files.js'
import { extendMemoryContext } from '../../lib/story-memory.js'
import { freeIdentifier, localIdentifier, modelCatalog, modelProfiles, profileSlot, readModelProfiles } from './model-profiles.js'

const modelFile = '/settings/model.json'
let model = null
let available = []
let queue = Promise.resolve()
let modelReads = Promise.resolve()

export function exclusive(task) {
  const finished = queue.then(task)
  queue = finished.catch(() => {})
  return finished
}

export function loadModel() {
  if (platform === 'dsh') return api('GET', '/studio/model')
  const next = modelReads.then(readModel)
  modelReads = next.catch(() => {})
  return next
}

async function readModel() {
  const [saved, manualKey, openRouterKey] = await Promise.all([
    readFile(modelFile, 'utf8').then(JSON.parse).catch(() => null),
    native('secretStatus').catch(() => ({})), native('secretStatus', { scope: 'openrouter' }).catch(() => ({})),
  ])
  const { active, profiles } = readModelProfiles(saved)
  const keys = { manual: manualKey.configured, openrouter: openRouterKey.configured }
  available = Object.entries(profiles).flatMap(([slot, config]) => {
    const preset = modelProfiles[config?.profile]
    const enabled = slot === 'ollama' ? platform === 'windows' : keys[slot]
    return enabled && preset && config.base && config.model ? [{ ...config, provider: preset.provider, scope: preset.scope }] : []
  })
  model = available.find((config) => profileSlot(config.profile) === active) || null
  return { ...profiles[active], active, profiles, keys, configured: Boolean(model) }
}

export async function saveModel({ base, name, value, profile }) {
  const preset = modelProfiles[profile]
  if (!preset || (profile === 'ollama' && platform !== 'windows')) throw new Error('此设备无法使用该模型服务。')
  const address = new URL(base)
  const local = profile === 'ollama'
  if ((!local && address.protocol !== 'https:') || address.username || address.password || address.hash || address.search) {
    throw new Error('请输入 HTTPS API 基础地址。')
  }
  const baseUrl = address.href.replace(/\/$/, '')
  if ((profile === 'openrouter' || local) && baseUrl !== preset.base) throw new Error('请选择此服务的预设地址。')
  const nextKey = local ? '' : value.trim()
  const slot = profileSlot(profile)
  return exclusive(async () => {
    const existing = await loadModel()
    if (!local && !nextKey && (!existing.keys[slot] || existing.profiles[slot]?.base !== baseUrl)) {
      throw new Error('请为此接口填写 API Key。')
    }
    let rows = []
    let discoveryError = ''
    try {
      const result = await native('providerModels', { address: baseUrl + '/models', value: nextKey, scope: preset.scope })
      rows = result.models
    } catch (error) {
      if (local) throw new Error('连接本机 Ollama 失败。请先启动 Ollama 并下载一个模型。')
      if (/\bHTTP (401|403)\b/.test(error.message)) throw new Error('接口未接受此 API Key。' + error.message)
      discoveryError = '无法自动识别模型：' + error.message
    }
    const models = modelCatalog(rows, profile, modelEfforts)
    const selected = name.trim() || models[0]?.id
    if (!selected) throw new Error((discoveryError ? discoveryError + '。' : '') + '请填写模型 ID。')
    if (profile === 'openrouter' && !models.some(({ id }) => id === selected)) throw new Error('请选择列表中的免费模型。')
    if (local && !models.some(({ id }) => id === selected)) throw new Error('未在本机 Ollama 中找到这个模型。')
    if (!models.some(({ id }) => id === selected)) {
      models.unshift({ id: selected, name: selected, efforts: modelEfforts({ id: selected }, profile === 'deepseek') })
    }
    if (nextKey) await native('secretSet', { value: nextKey, scope: preset.scope })
    const config = { base: baseUrl, model: selected, models, profile, deepseek: profile === 'deepseek' }
    await writeFile(modelFile, JSON.stringify({ active: slot, profiles: { ...existing.profiles, [slot]: config } }))
    return { ...await loadModel(), discoveryError }
  })
}

function modelEfforts(item, deepseek) {
  const declared = item.reasoning_efforts ?? item.supported_reasoning_efforts
    ?? item.capabilities?.reasoning_efforts ?? item.reasoning?.efforts
  if (Array.isArray(declared)) {
    return [...new Set(declared.map((value) => typeof value === 'string' ? value : value?.id)
      .filter((value) => typeof value === 'string' && /^[a-z][a-z0-9_-]{0,24}$/i.test(value)))]
  }
  return deepseek && /^deepseek-(?:v4-(?:flash|pro)|flash)(?:$|[-:])/i.test(item.id)
    ? ['none', 'low', 'high', 'max'] : []
}

export function clearModel(profile) {
  return exclusive(async () => {
    await native('secretSet', { value: '', scope: modelProfiles[profile].scope })
    return loadModel()
  })
}

export async function testModel(signal) {
  if (!model) throw new Error('请先保存要测试的模型。')
  let hasText = false
  for await (const event of stream({ provider: model.provider, model: model.model, maxTokens: 256,
    messages: [{ role: 'user', content: '请回复“连接成功”。' }], signal })) {
    if (event.type === 'text-delta' && event.text.trim()) hasText = true
  }
  if (signal?.aborted) throw new Error('连接测试超时或已取消。')
  if (!hasText) throw new Error('服务已响应，但模型没有返回正文。')
}

export async function* streamWorkspace({ system, input, reasoningEffort, signal }) {
  if (platform === 'dsh') {
    const result = await api('POST', '/studio/ai', { system, input, reasoningEffort }, { signal })
    yield { type: 'model', model: result.model }
    yield { type: 'text-delta', text: result.text }
    return
  }
  const active = model
  if (!active) throw new Error('请在「AI 模型设置」保存一个可用模型。')
  yield* stream({ system, messages: [{ role: 'user', content: input }], provider: active.provider,
    model: active.model, reasoningEffort, signal, maxTokens: 1800 })
}

async function* stream({ messages, system, maxTokens, model: name, provider, reasoningEffort, signal }) {
  const config = available.find((item) => item.provider === provider)
  if (!config) throw new Error('本轮模型服务未配置。请更换模型，或在 AI 模型设置中启用服务。')
  const chosen = name || config.model
  if ((config.profile === 'openrouter' && !freeIdentifier(chosen)) || (config.profile === 'ollama' && !localIdentifier(chosen))) {
    throw new Error('请为本次写作选择免费或本机模型。')
  }
  if (chosen !== config.model && !config.models?.some(({ id }) => id === chosen)) {
    throw new Error('当前服务的模型列表里没有 ' + chosen + '。请更换模型或重新识别。')
  }
  if (signal?.aborted) return
  const id = globalThis.crypto.randomUUID()
  const events = []
  let receiver
  const wake = () => receiver?.()
  const detach = await providerEvents((event) => {
    if (event.id === id) {
      events.push(event)
      wake()
    }
  })
  const abort = () => { void native('providerCancel', { id }).catch(() => {}); wake() }
  signal?.addEventListener('abort', abort, { once: true })
  const body = {
    model: chosen,
    messages: [
      ...(system ? [{ role: 'system', content: system }] : []),
      ...messages.map(({ role, content }) => ({
        role, content: Array.isArray(content) ? content.map((part) => part.text || '').join('') : content,
      })),
    ],
    stream: true,
    max_tokens: maxTokens,
    ...(config.deepseek || config.profile === 'openrouter' ? { stream_options: { include_usage: true } } : {}),
    ...(config.models?.find(({ id }) => id === chosen)?.efforts?.includes(reasoningEffort)
      ? config.profile === 'openrouter' ? { reasoning: { effort: reasoningEffort } } : { reasoning_effort: reasoningEffort } : {}),
  }
  let buffer = ''
  let finished = false
  let reportedModel = ''
  try {
    if (signal?.aborted) return
    await native('providerStart', { id, address: config.base + '/chat/completions', scope: config.scope, body })
    while (!signal?.aborted) {
      if (!events.length) await new Promise((resolve) => { receiver = resolve })
      if (signal?.aborted) return
      const event = events.shift()
      if (!event) continue
      if (event.error) throw new Error(event.error)
      buffer += event.chunk || ''
      let newline = buffer.indexOf('\n')
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        newline = buffer.indexOf('\n')
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (data === '[DONE]') { finished = true; continue }
        const packet = JSON.parse(data)
        if (packet.error) throw new Error(packet.error.message || '模型返回异常。')
        if (typeof packet.model === 'string' && packet.model.trim() && packet.model !== reportedModel) {
          reportedModel = packet.model
          yield { type: 'model', model: reportedModel }
        }
        const choice = packet.choices?.[0]
        if (choice?.delta?.content) yield { type: 'text-delta', text: choice.delta.content }
        if (choice?.finish_reason) finished = true
        if (packet.usage) yield { type: 'usage', usage: packet.usage }
      }
      if (event.done) {
        if (!finished) throw new Error('模型响应提前中断。')
        yield { type: 'finish', reason: { kind: 'stop' } }
        return
      }
    }
  } finally {
    detach()
    signal?.removeEventListener('abort', abort)
    void native('providerCancel', { id }).catch(() => {})
  }
}

setServices({
  extendContext: extendMemoryContext,
  llm: {
    stream,
    resolveModelInfo: (provider, name) => ({ reasoning: { efforts: available.find((item) => item.provider === provider)
      ?.models?.find(({ id }) => id === name)?.efforts || [] } }),
  },
  selection: () => model ? { provider: model.provider, model: model.model } : null,
  catalog: () => ({ providers: available.map((config) => ({ id: config.provider, name: modelProfiles[config.profile].name,
    defaultModel: config.model, models: config.models || [{ id: config.model, name: config.model }] })) }),
})

function route(path, { method = 'GET', body, signal } = {}) {
  const url = new URL(path, 'https://studio.local')
  const rest = url.pathname.slice('/novel-studio/api'.length) || '/'
  const run = () => new Promise((resolve, reject) => {
    const [forward, controller] = (() => {
      let controller
      const readable = new ReadableStream({ start(value) { controller = value } })
      return [readable, controller]
    })()
    const onClose = new Set()
    const abort = () => {
      onClose.forEach((notify) => notify())
    }
    if (signal?.aborted) { reject(new DOMException('已取消', 'AbortError')); return }
    signal?.addEventListener('abort', abort, { once: true })
    const req = {
      url: url.pathname + url.search,
      on: (_, notify) => { onClose.add(notify); if (signal?.aborted) notify() },
      off: (_, notify) => onClose.delete(notify),
      async *[Symbol.asyncIterator]() { if (body) yield Buffer.from(body) },
    }
    function emit(bytes) {
      controller.enqueue(typeof bytes === 'string' ? new TextEncoder().encode(bytes) : new Uint8Array(bytes))
    }
    const res = {
      writableEnded: false,
      writeHead: (status, headers) => resolve(new Response(forward, { status, headers })),
      write: emit,
      end(bytes) {
        this.writableEnded = true
        if (bytes) emit(bytes)
        controller.close()
      },
    }
    // Stay in the write queue until dispatch, including all on-disk changes,
    // completes. Response headers can reach the editor while streaming.
    const execute = () => dispatch(req, res, { method, rest })
    const serialized = !['GET', 'HEAD'].includes(method) && !/\/(?:ai|extract|reader)$/.test(rest)
    ;(serialized ? exclusive(execute) : execute()).catch((error) => {
      reject(error)
      if (!res.writableEnded) controller.error(error)
    }).finally(() => signal?.removeEventListener('abort', abort))
  })
  return run()
}

export const fetchLocal = (path, options) => platform === 'dsh' ? fetch(path, options) : route(path, options)

export async function api(method, path, value, { signal } = {}) {
  const res = await fetchLocal('/novel-studio/api' + path, {
    method, signal, headers: value === undefined ? undefined : { 'content-type': 'application/json' },
    body: value === undefined ? undefined : JSON.stringify(value),
  })
  const data = await res.json()
  if (!res.ok || data.ok === false) throw new Error(data.error || data.message || '请求失败。')
  return data
}
