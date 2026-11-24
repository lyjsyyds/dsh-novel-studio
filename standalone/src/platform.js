import { Capacitor, registerPlugin } from '@capacitor/core'

const android = registerPlugin('NovelNative')
const inDsh = /^https?:$/.test(location.protocol) && location.pathname === '/novel-studio/api/studio/index.html'
export const platform = inDsh ? 'dsh' : Capacitor.getPlatform() === 'android' ? 'android' : window.novelNative ? 'windows' : 'browser'

function browserAction(action, { name, base64, url }) {
  if (action === 'external' && /^https?:$/.test(new URL(url).protocol)) {
    window.open(url, '_blank', 'noopener,noreferrer')
    return {}
  }
  if (action === 'saveFile') {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
    const address = URL.createObjectURL(new Blob([bytes]))
    const link = document.createElement('a')
    link.href = address
    link.download = name
    link.click()
    setTimeout(() => URL.revokeObjectURL(address), 1000)
    return { canceled: false }
  }
  throw new Error('请从独立应用使用此操作。')
}

export async function native(action, payload = {}) {
  if (platform === 'android') return android.invoke({ action, ...payload })
  if (platform === 'windows') return window.novelNative.invoke(action, payload)
  if (platform === 'dsh') return browserAction(action, payload)
  throw new Error('请从 Novel Studio 应用打开工作台。')
}

export async function providerEvents(callback) {
  if (platform === 'android') {
    const listener = await android.addListener('provider', callback)
    return () => listener.remove()
  }
  return window.novelNative.onProvider(callback)
}
