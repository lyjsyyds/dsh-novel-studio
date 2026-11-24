const { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } = require('electron')
const fs = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { pathToFileURL } = require('node:url')

const limit = 64 * 1024 * 1024
const data = process.env.NOVEL_STUDIO_TEST_DATA
  || (process.env.PORTABLE_EXECUTABLE_DIR
    ? path.resolve(process.env.PORTABLE_EXECUTABLE_DIR, '..', 'Data')
    : path.join(app.getPath('userData'), 'Data'))
const entry = path.join(__dirname, '..', 'web-dist', 'index.html')
const localUrl = pathToFileURL(entry).href
const rendererUrl = process.env.NOVEL_STUDIO_DEV_URL || localUrl
const streams = new Map()
let window
let allowClose = false
let closingTimer

function allowedFile(virtual) {
  if (typeof virtual !== 'string' || !/^\/(?:library|settings|transfer)(?:\/|$)/.test(virtual)
    || /[\\:\x00-\x1f]/.test(virtual)
    || virtual.split('/').slice(1).some((part) => !part || /[. ]$/.test(part)
      || /[<>|?*"]|^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) {
    throw Object.assign(new Error('文件位置无效。'), { code: 'EINVAL' })
  }
  return path.join(data, ...virtual.split('/').filter(Boolean))
}

async function fileAt(virtual) {
  const full = allowedFile(virtual)
  const parts = path.relative(data, full).split(path.sep)
  let current = data
  for (const part of parts) {
    current = path.join(current, part)
    const info = await fs.lstat(current).catch((error) => {
      if (error.code === 'ENOENT') return null
      throw error
    })
    if (info?.isSymbolicLink()) throw Object.assign(new Error('应用数据中不能包含符号链接。'), { code: 'EINVAL' })
    if (!info) break
  }
  return full
}

async function atomicWrite(target, bytes) {
  const temporary = target + '.tmp-' + randomUUID()
  try {
    await fs.writeFile(temporary, bytes, { flag: 'wx' })
    await fs.rename(temporary, target)
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {})
  }
}

async function fileOperation(request) {
  try {
    const target = await fileAt(request.path)
    switch (request.op) {
      case 'list': {
        const entries = await fs.readdir(target, { withFileTypes: true })
        return { entries: entries.filter((entry) => entry.isFile() || entry.isDirectory())
          .map((entry) => ({ name: entry.name, directory: entry.isDirectory() })) }
      }
      case 'stat': {
        const info = await fs.stat(target)
        return { directory: info.isDirectory(), size: info.size, mtimeMs: info.mtimeMs }
      }
      case 'read': {
        if ((await fs.stat(target)).size > limit) throw new Error('文件超过 64 MB。')
        return { base64: (await fs.readFile(target)).toString('base64') }
      }
      case 'write': {
        const bytes = Buffer.from(String(request.base64 || ''), 'base64')
        if (bytes.byteLength > limit) throw new Error('文件超过 64 MB。')
        await atomicWrite(target, bytes)
        break
      }
      case 'mkdir': await fs.mkdir(target, { recursive: request.recursive }); break
      case 'rename': await fs.rename(target, await fileAt(request.to)); break
      case 'copy': await fs.copyFile(target, await fileAt(request.to)); break
      case 'remove': {
        if (!request.path.slice(1).includes('/')) throw new Error('不能删除应用数据根目录。')
        await fs.rm(target, { recursive: Boolean(request.recursive), force: Boolean(request.force) })
        break
      }
      default: throw new Error('未知文件操作。')
    }
    return {}
  } catch (error) {
    return { code: error.code || 'EIO', message: error.message }
  }
}

function secretFile(scope) {
  if (scope === 'openrouter') return path.join(data, 'settings', 'openrouter-key.bin')
  if (scope == null || scope === 'default') return path.join(data, 'settings', 'model-key.bin')
  throw new Error('未知的密钥配置。')
}

async function modelSecret(scope) {
  const bytes = await fs.readFile(secretFile(scope)).catch((error) => {
    if (error.code === 'ENOENT') return null
    throw error
  })
  return bytes ? safeStorage.decryptString(bytes) : ''
}

function remoteUrl(address, scope, endpoint) {
  const url = new URL(address)
  if (scope === 'local') {
    if (url.href !== 'http://127.0.0.1:11434/v1/' + endpoint) throw new Error('本机模型需连接本机 Ollama。')
    return url
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('模型接口需使用 HTTPS。')
  if (scope === 'openrouter' && url.href !== 'https://openrouter.ai/api/v1/' + endpoint) throw new Error('免费模型需使用 OpenRouter 官方端点。')
  return url
}

async function runProvider({ id, address, body, scope }, sender) {
  const controller = new AbortController()
  streams.set(id, controller)
  const emit = (payload) => {
    if (!sender.isDestroyed()) sender.send('novel:provider', { id, ...payload })
  }
  try {
    const url = remoteUrl(address, scope, 'chat/completions')
    if (scope === 'openrouter' && body.model !== 'openrouter/free' && !/^[\w.-]+\/[\w.-]+:free$/i.test(body.model)) throw new Error('此入口仅调用免费模型。')
    if (scope === 'local' && /(?:^|[:-])cloud(?:$|[-:])/i.test(body.model)) throw new Error('请选择已下载的本机模型。')
    const key = scope === 'local' ? '' : await modelSecret(scope)
    const response = await fetch(url, {
      method: 'POST',
      redirect: 'error',
      headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: 'Bearer ' + key } : {}) },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(response.status === 429 ? '当前服务额度用完或调用过快。请稍后重试。' : '模型接口返回 HTTP ' + response.status)
    if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) {
      throw new Error('模型接口没有返回 SSE 流。')
    }
    const decoder = new TextDecoder()
    for await (const bytes of response.body) emit({ chunk: decoder.decode(bytes, { stream: true }) })
    emit({ chunk: decoder.decode(), done: true })
  } catch (error) {
    emit({ error: controller.signal.aborted ? '已取消' : error.message })
  } finally {
    streams.delete(id)
  }
}

async function pickLegacy() {
  const { filePaths, canceled } = await dialog.showOpenDialog(window, {
    title: '选择 DSH 书库', properties: ['openDirectory'],
  })
  if (canceled) return { canceled: true }
  const root = filePaths[0]
  const entries = []
  let bytes = 0
  async function walk(dir, prefix) {
    for (const item of await fs.readdir(dir, { withFileTypes: true })) {
      if (item.isSymbolicLink() || item.name.endsWith('.tmp') || /\.tmp-\d+-/.test(item.name)) continue
      const relative = prefix + item.name
      if (item.isDirectory()) {
        if (!prefix && !['.novel-shared', '.trash'].includes(item.name)) {
          if (!(await fs.stat(path.join(dir, item.name, 'book.yaml')).catch(() => null))?.isFile()) continue
        }
        await walk(path.join(dir, item.name), relative + '/')
      } else if (item.isFile() && prefix) {
        const file = path.join(dir, item.name)
        bytes += (await fs.stat(file)).size
        if (bytes > limit || entries.length >= 20000) throw new Error('当前书库超过一次可导入的大小。')
        entries.push([relative, (await fs.readFile(file)).toString('base64')])
      }
    }
  }
  await walk(root, '')
  return { entries, source: path.basename(root) }
}

async function invoke(action, payload, sender) {
  switch (action) {
    case 'closeReady':
      if (!closingTimer) return {}
      clearTimeout(closingTimer)
      closingTimer = null
      if (payload.ok === true) { allowClose = true; window.close() }
      return {}
    case 'files': return fileOperation(payload)
    case 'secretStatus': return { configured: Boolean(await modelSecret(payload.scope)) }
    case 'secretSet':
      if (payload.value) await atomicWrite(secretFile(payload.scope), safeStorage.encryptString(payload.value))
      else await fs.rm(secretFile(payload.scope), { force: true })
      return {}
    case 'providerStart': void runProvider(payload, sender); return {}
    case 'providerCancel': streams.get(payload.id)?.abort(); return {}
    case 'providerModels': {
      const address = remoteUrl(payload.address, payload.scope, 'models')
      const key = payload.scope === 'local' ? '' : payload.value || await modelSecret(payload.scope)
      const response = await fetch(address, {
        redirect: 'error',
        headers: key ? { Authorization: 'Bearer ' + key } : {},
        signal: AbortSignal.timeout(18000),
      })
      if (!response.ok) throw new Error('模型列表返回 HTTP ' + response.status)
      const result = await response.json()
      if (!Array.isArray(result.data)) throw new Error('接口没有返回模型列表。')
      const models = payload.scope === 'openrouter' ? result.data.filter((item) => typeof item?.id === 'string' && item.id.endsWith(':free')) : result.data
      return { models: models.slice(0, 1000) }
    }
    case 'legacyPick': return pickLegacy()
    case 'openFile': {
      const result = await dialog.showOpenDialog(window, {
        title: '打开备份或手稿', properties: ['openFile'],
        filters: [{ name: '书库备份与手稿', extensions: ['zip', 'json', 'md', 'txt'] }],
      })
      if (result.canceled) return { canceled: true }
      const target = result.filePaths[0]
      if ((await fs.stat(target)).size > limit) throw new Error('文件超过 64 MB。')
      return { name: path.basename(target), base64: (await fs.readFile(target)).toString('base64') }
    }
    case 'saveFile': {
      const result = await dialog.showSaveDialog(window, { defaultPath: path.basename(payload.name) })
      if (result.canceled) return { canceled: true }
      await atomicWrite(result.filePath, Buffer.from(payload.base64, 'base64'))
      return { name: path.basename(result.filePath) }
    }
    case 'external': {
      const url = new URL(payload.url)
      if (['http:', 'https:'].includes(url.protocol)) await shell.openExternal(url.href)
      return {}
    }
    default: throw new Error('未知操作。')
  }
}

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => {
    if (window?.isMinimized()) window.restore()
    window?.focus()
  })
  app.whenReady().then(async () => {
    for (const directory of ['settings', 'library', 'transfer']) {
      await fs.mkdir(path.join(data, directory), { recursive: true })
    }
    ipcMain.handle('novel:invoke', (event, action, payload) => {
      if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame
        || event.senderFrame.url.split('#')[0] !== rendererUrl) throw new Error('无效的应用入口。')
      return invoke(action, payload, event.sender)
    })
    window = new BrowserWindow({
      width: 1440, height: 920, minWidth: 620, minHeight: 480, autoHideMenuBar: true,
      backgroundColor: '#F9F7F1',
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false },
    })
    window.webContents.on('will-navigate', (event) => event.preventDefault())
    window.on('close', (event) => {
      if (allowClose || window.webContents.isDestroyed()) return
      event.preventDefault()
      if (!closingTimer) {
        window.webContents.send('novel:closing')
        closingTimer = setTimeout(() => {
          closingTimer = null
          dialog.showErrorBox('Novel Studio', '等待正文保存超时。请检查正文页的保存状态。')
        }, 10000)
      }
    })
    window.webContents.setWindowOpenHandler(({ url }) => {
      void invoke('external', { url }).catch(() => {})
      return { action: 'deny' }
    })
    await window.loadURL(rendererUrl)
  }).catch((error) => { dialog.showErrorBox('Novel Studio', error.message); app.quit() })
  app.on('window-all-closed', () => app.quit())
}
