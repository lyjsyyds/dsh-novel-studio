import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { buildCallOptions, normalizeModel } from './ai.js'
import { saveDraft } from './chapters.js'
import { atomicWrite, readBook, resolveRoot } from './library.js'
import { readUnit, writeUnit } from './records.js'
import { getSchema } from './schema.js'

const jsonType = /^application\/json(?:;|$)/i
const workspaceKeys = ['ideas', 'clips', 'paths', 'choices', 'projects', 'stage', 'ecosystem']
const digest = (value) => createHash('sha256').update(value).digest('hex')
const mime = { html: 'text/html', js: 'text/javascript', css: 'text/css', svg: 'image/svg+xml' }
let writes = Promise.resolve()

function serialized(task) {
  const result = writes.then(task)
  writes = result.catch(() => {})
  return result
}

async function readStored(file) {
  return readFile(file, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') return '{}'
    throw error
  })
}

async function serveAsset(res, path, api) {
  if (path !== 'index.html' && !/^assets\/[\w-]+\.(?:js|css|svg)$/.test(path)) return api.json(res, { ok: false, error: 'not-found' }, 404)
  const extension = path.split('.').at(-1)
  try {
    const contents = await readFile(new URL('./studio/' + path, import.meta.url))
    res.writeHead(200, {
      'content-type': mime[extension] + '; charset=utf-8',
      'cache-control': extension === 'html' ? 'no-cache' : 'public, max-age=31536000, immutable',
      'cross-origin-resource-policy': 'same-origin',
      'x-content-type-options': 'nosniff',
      ...(extension === 'html' ? { 'content-security-policy': "frame-ancestors 'self'" } : {}),
    })
    res.end(contents)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    return api.json(res, { ok: false, error: '工作台资源缺失，请安装完整的 DSH 插件包。' }, 404)
  }
}

function hostModel(services) {
  return normalizeModel(services.selection?.())
}

async function workspaceAi(req, res, api) {
  const services = api.getServices()
  const route = hostModel(services)
  if (!route || typeof services.llm?.stream !== 'function') return api.json(res, { ok: false, error: '请先在 DSH 中选择可用模型。' }, 409)
  const { system, input, reasoningEffort } = await api.readJsonBody(req, 32 * 1024)
  if (typeof system !== 'string' || !system.startsWith('工作区任务 [') || system.length > 2000 ||
    typeof input !== 'string' || input.length > 15000) return api.json(res, { ok: false, error: '工作区 AI 请求格式错误。' }, 400)
  const { efforts } = await api.readEfforts(services.llm, route.provider, route.model)
  if (efforts.some(({ id }) => id === reasoningEffort)) route.reasoningEffort = reasoningEffort
  const controller = new AbortController()
  const close = () => controller.abort()
  const timeout = setTimeout(close, 85000)
  res.on('close', close)
  try {
    let text = ''
    let reported = ''
    const options = buildCallOptions({ prompt: { system, user: input, maxTokens: 1800 }, route, signal: controller.signal })
    for await (const event of services.llm.stream(options)) {
      if (event.type === 'model' && typeof event.model === 'string') reported = event.model
      if (event.type === 'text-delta') text += event.text || ''
      if (text.length > 16000) throw new Error('模型回复过长，请缩小范围重试。')
      if (event.type === 'finish' && ['error', 'aborted'].includes(event.reason?.kind)) {
        throw new Error(event.reason.failure?.message || 'DSH 模型调用已中断。')
      }
    }
    if (res.destroyed) return
    if (controller.signal.aborted) throw new Error('DSH 模型响应超时。')
    return api.json(res, { ok: true, text, model: reported || route.model })
  } catch (error) {
    if (!res.destroyed) return api.json(res, { ok: false, error: error.message }, 502)
  } finally {
    clearTimeout(timeout)
    res.off('close', close)
  }
}

export async function serveStudio(req, res, { method, rest }, api) {
  const path = rest.slice('/studio/'.length)
  if (method === 'GET' && (path === 'index.html' || path.startsWith('assets/'))) return serveAsset(res, path, api)
  if (req.headers['sec-fetch-site'] === 'cross-site' ||
    (method !== 'GET' && !jsonType.test(req.headers['content-type'] || ''))) {
    return api.json(res, { ok: false, error: 'invalid-request' }, 403)
  }
  const root = resolveRoot()
  try {
    if (path === 'model' && method === 'GET') {
      const services = api.getServices()
      const selected = hostModel(services)
      if (!selected || typeof services.llm?.stream !== 'function') return api.json(res, { ok: true, configured: false })
      const catalog = await Promise.resolve().then(() => services.catalog?.()).catch(() => null)
      const selectedModel = catalog?.providers?.find(({ id }) => id === selected.provider)?.models?.find(({ id }) => id === selected.model)
      const { efforts } = await api.readEfforts(services.llm, selected.provider, selected.model)
      return api.json(res, { ok: true, configured: true, model: selected.model,
        models: [{ id: selected.model, name: selectedModel?.name || selected.model, efforts: efforts.map(({ id }) => id) }] })
    }
    if (path === 'ai' && method === 'POST') return await workspaceAi(req, res, api)
    if (path === 'spaces' && ['GET', 'PUT'].includes(method)) {
      const file = join(root, '.creative-spaces.json')
      if (method === 'GET') {
        const raw = await readStored(file)
        return api.json(res, { ok: true, value: JSON.parse(raw), revision: digest(raw) })
      }
      const { value, revision } = await api.readJsonBody(req, 4 * 1024 * 1024)
      if (!value || typeof value !== 'object' || Array.isArray(value) ||
        Object.keys(value).some((key) => !workspaceKeys.includes(key) || !Array.isArray(value[key]))) {
        return api.json(res, { ok: false, error: '工作区数据格式错误。' }, 400)
      }
      return await serialized(async () => {
        if (digest(await readStored(file)) !== revision) return api.json(res, { ok: false, error: '另一个窗口已保存工作区，请重新打开后再编辑。' }, 409)
        const raw = JSON.stringify(value)
        await atomicWrite(file, raw)
        return api.json(res, { ok: true, revision: digest(raw) })
      })
    }
    const session = /^session\/([^/]+)$/.exec(path)
    if (session && ['GET', 'PUT'].includes(method)) {
      const book = await readBook(root, decodeURIComponent(session[1]))
      const file = join(book.dir, '.studio-session.json')
      if (method === 'GET') return api.json(res, { ok: true, value: JSON.parse(await readStored(file)) })
      const { chapter, offset, scroll, note } = await api.readJsonBody(req, 32 * 1024)
      if (typeof chapter !== 'string' || !Number.isFinite(offset) || !Number.isFinite(scroll) || typeof note !== 'string') {
        return api.json(res, { ok: false, error: 'invalid-session' }, 400)
      }
      await atomicWrite(file, JSON.stringify({ chapter, offset, scroll, note }))
      return api.json(res, { ok: true })
    }
    if (path === 'chapter' && method === 'PUT') {
      const { bookId, chapter, original, proposed, takeSnapshot } = await api.readJsonBody(req, 4 * 1024 * 1024)
      if ([bookId, chapter, original, proposed].some((value) => typeof value !== 'string')) {
        return api.json(res, { ok: false, error: 'invalid-chapter-edit' }, 400)
      }
      const book = await readBook(root, bookId)
      const { unit } = (await getSchema()).unitOf('chapters', 'chapters')
      return await serialized(async () => {
        const { data } = await readUnit(book.dir, unit, chapter)
        if (data.body !== original) return api.json(res, { ok: false, error: '原稿已经变化。请重新打开对照。' }, 409)
        if (original === proposed) return api.json(res, { ok: true, value: data })
        if (takeSnapshot === true) await saveDraft(book.dir, chapter, { note: '应用修订前' })
        await writeUnit(book.dir, unit, chapter, { body: proposed })
        return api.json(res, { ok: true, value: (await readUnit(book.dir, unit, chapter)).data })
      })
    }
    return api.json(res, { ok: false, error: 'not-found' }, 404)
  } catch (error) {
    return api.json(res, { ok: false, error: error.message }, error.status || 500)
  }
}
