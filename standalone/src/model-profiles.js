export const modelProfiles = {
  deepseek: { name: 'DeepSeek', base: 'https://api.deepseek.com', scope: 'default', provider: 'standalone' },
  compatible: { name: '自定义 OpenAI 兼容', base: '', scope: 'default', provider: 'standalone' },
  openrouter: { name: 'OpenRouter 免费模型', base: 'https://openrouter.ai/api/v1', scope: 'openrouter', provider: 'standalone-openrouter',
    keyPage: 'https://openrouter.ai/settings/keys' },
  ollama: { name: '本机 Ollama', base: 'http://127.0.0.1:11434/v1', scope: 'local', provider: 'standalone-ollama',
    keyPage: 'https://ollama.com/download' },
}

export const freeRouter = { id: 'openrouter/free', name: '免费模型（自动选择）', efforts: [] }
export const freeIdentifier = (id) => id === freeRouter.id || /^[\w.-]+\/[\w.-]+:free$/i.test(id)
export const localIdentifier = (id) => typeof id === 'string' && id.length > 0 && !/(?:^|[:-])cloud(?:$|[-:])/i.test(id)
export const profileSlot = (profile) => ['deepseek', 'compatible'].includes(profile) ? 'manual' : profile
const zeroPrice = (price) => price === 0 || (typeof price === 'string' && price.trim() !== '' && Number(price) === 0)

export function modelCatalog(rows, profile, getEfforts) {
  const unique = new Map()
  if (profile === 'openrouter') unique.set(freeRouter.id, freeRouter)
  for (const item of rows) {
    if (typeof item?.id !== 'string' || !item.id.trim() || unique.has(item.id)) continue
    const output = item.architecture?.output_modalities
    if (profile === 'openrouter' && (!freeIdentifier(item.id) || !zeroPrice(item.pricing?.prompt)
      || !zeroPrice(item.pricing?.completion) || !Array.isArray(output) || !output.includes('text'))) continue
    if (profile === 'ollama' && !localIdentifier(item.id)) continue
    unique.set(item.id, { id: item.id, name: item.name || item.id, efforts: getEfforts(item, profile === 'deepseek') })
  }
  return [...unique.values()]
}

export function readModelProfiles(saved) {
  if (saved?.profiles && typeof saved.profiles === 'object') return { active: saved.active, profiles: saved.profiles }
  if (!saved?.base || !saved?.model) return { active: null, profiles: {} }
  return { active: 'manual', profiles: { manual: { ...saved, profile: saved.deepseek ? 'deepseek' : 'compatible' } } }
}
