import { useCallback, useEffect, useRef, useState } from 'react'
import { atomicWrite } from '../../lib/library.js'
import { readFile } from './files.js'
import { api, exclusive } from './transport.js'
import { platform } from './platform.js'

const path = '/library/.creative-spaces.json'
export const uid = () => crypto.randomUUID()
export const spaceNames = { ideas: '策展漫游馆', clips: '声音明信片', paths: '分岔宇宙', choices: '取舍实验室', projects: '行动沙盘', stage: '即兴排演厅', ecosystem: '规则生态舱' }

export function createItem(kind, title, seed = {}) {
  const defaults = {
    ideas: { notes: [] }, clips: { text: '', source: '', tags: '' },
    paths: { premise: '', a: '', b: '', decision: '' },
    choices: { options: ['方案 A', '方案 B'], criteria: [{ id: uid(), title: '可行性', weight: 1, scores: [3, 3] }] },
    projects: { tasks: [] }, stage: { cards: [], runs: [] },
    ecosystem: { cells: [27, 46, 63, 64, 65], generation: 0, rule: 'life' },
  }
  return { ...defaults[kind], ...seed, id: uid(), title }
}

export function useSpaces(notify) {
  const [data, setData] = useState(null)
  const [status, setStatus] = useState('')
  const current = useRef(null)
  const saved = useRef(null)
  const timer = useRef(null)
  const revision = useRef(null)
  const load = useCallback(async () => {
    const response = platform === 'dsh' ? await api('GET', '/studio/spaces') : null
    const value = response ? response.value : await readFile(path, 'utf8').then(JSON.parse).catch((e) => {
      if (e.code === 'ENOENT') return {}
      throw e
    })
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(spaceNames).some((key) => value[key] !== undefined && !Array.isArray(value[key]))) throw new Error('无法读取创作空间数据。')
    current.current = saved.current = value
    revision.current = response?.revision
    setData(value)
    setStatus('')
  }, [])
  const flush = useCallback(() => exclusive(async () => {
    const next = current.current
    if (!next || next === saved.current) return true
    if (platform === 'dsh') {
      const response = await api('PUT', '/studio/spaces', { value: next, revision: revision.current })
      revision.current = response.revision
    } else await atomicWrite(path, JSON.stringify(next))
    saved.current = next
    if (next === current.current) setStatus('已保存')
    return true
  }).catch((e) => { setStatus('保存失败'); notify(e); return false }), [notify])
  function change(kind, transform) {
    if (!current.current) throw new Error('创作空间尚未载入。')
    const next = { ...current.current, [kind]: transform(current.current[kind] || []) }
    current.current = next
    setData(next)
    setStatus('待保存')
    clearTimeout(timer.current)
    timer.current = setTimeout(flush, 300)
  }
  useEffect(() => {
    const hide = () => { if (document.hidden) void flush() }
    document.addEventListener('visibilitychange', hide)
    return () => { clearTimeout(timer.current); document.removeEventListener('visibilitychange', hide) }
  }, [flush])
  return { data, change, load, flush, status }
}
