import React, { useEffect, useRef, useState } from 'react'
import { Drawer } from './drawer.jsx'
import { loadModel, streamWorkspace } from './transport.js'
import { uid } from './spaces.js'

const actions = {
  ideas: {
    label: 'AI 起草展项', apply: '追加展项', fields: ['title', 'notes'],
    request: '起草 3 个可独立布展的展项，每项给名称和一条展签。格式 {"exhibits":[{"title":"名称","caption":"展签"}]}',
  },
  clips: {
    label: 'AI 谱写八拍', apply: '替换八拍', fields: ['title', 'text'],
    request: '按照明信片文字的节奏写八拍旋律。格式 {"beats":[1,0,2,3,0,4,3,2]}。每拍整数 0–5，依次表示休止、低音 G、C、E、G、高音 C。恰好 8 拍，至少 1 拍发声。',
  },
  paths: {
    label: 'AI 推演后果', apply: '填入空白后果', fields: ['title', 'premise', 'a', 'b'],
    request: '从共同起点为 A、B 两条已有路线各写一个近期后果和一个长期隐患。指出必要假设，不编造已发生的事实。格式 {"aSoon":"…","aLater":"…","bSoon":"…","bLater":"…"}',
  },
  choices: {
    label: 'AI 查漏比较指标', apply: '追加指标', fields: ['title', 'options', 'criteria'],
    request: '补充有区分度且能观察验证的比较指标。已有指标不要重复。不要对选项打分。格式 {"criteria":["指标一","指标二"]}',
  },
  projects: {
    label: 'AI 拆解待办', apply: '追加待办', fields: ['title', 'tasks', 'hours'],
    request: '提出 3 个已有任务未覆盖、能够交付的待办。给出初步的人工工时估计，不编造日期。格式 {"tasks":[{"title":"任务","hours":2}]}，hours 允许半小时。',
  },
  stage: {
    label: 'AI 编排提示卡', apply: '追加提示卡', fields: ['title', 'cards'],
    request: '补充 3 张可直接朗读的排演提示卡，结合现有演练目标，避免同义重复。格式 {"cards":["内容一","内容二","内容三"]}',
  },
  ecosystem: {
    label: 'AI 设计初始图案', apply: '应用初始图案', fields: ['title', 'rule'],
    request: '为 18 列 × 10 行的细胞自动机画板设计初始图案。用从 1 开始的行和列。格式 {"cells":[[行,列],[行,列]]}，至少 3 个独立坐标，最多 40 个，行 1–10，列 1–18。只描述初始图案，后续由规则计算。',
  },
}

function text(value, max) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error('返回内容格式不正确，请重试。')
  return value.trim()
}

function list(value, max) {
  if (!Array.isArray(value) || !value.length || value.length > max) throw new Error('返回条目数量有误，请重试。')
  return value
}

function normalize(kind, raw) {
  const json = raw.trim().replace(/^```(?:json)?\s*|\s*```$/gi, '')
  let value
  try { value = JSON.parse(json) } catch { throw new Error('模型未返回可读取的 JSON，请重试。') }
  switch (kind) {
    case 'ideas': return list(value?.exhibits, 6).map((entry) => ({ title: text(entry?.title, 100), caption: text(entry?.caption, 320) }))
    case 'clips': {
      const beats = value?.beats
      if (beats?.length !== 8 || !Array.isArray(beats) || !beats.every((n) => Number.isInteger(n) && n >= 0 && n <= 5) || !beats.some(Boolean)) {
        throw new Error('旋律需要八拍且至少一拍发声。')
      }
      return beats
    }
    case 'paths': return Object.fromEntries(['aSoon', 'aLater', 'bSoon', 'bLater'].map((key) => [key, text(value?.[key], 600)]))
    case 'choices': return list(value?.criteria, 6).map((entry) => text(entry, 80))
    case 'projects': return list(value?.tasks, 6).map((entry) => {
      if (!Number.isFinite(entry?.hours) || entry.hours < 0.5 || entry.hours > 120) throw new Error('任务工时超出范围。')
      return { title: text(entry.title, 140), hours: entry.hours }
    })
    case 'stage': return list(value?.cards, 8).map((entry) => text(entry, 240))
    case 'ecosystem': {
      const cells = new Set(list(value?.cells, 40).map((pair) => {
        if (!Array.isArray(pair) || pair.length !== 2) throw new Error('坐标格式有误。')
        const [row, col] = pair
        if (!Number.isInteger(row) || !Number.isInteger(col) || row < 1 || row > 10 || col < 1 || col > 18) {
          throw new Error('有细胞坐标超出了画板。')
        }
        return (row - 1) * 18 + col - 1
      }))
      if (cells.size < 3) throw new Error('至少需要三个独立细胞。')
      return [...cells]
    }
  }
}

function unique(entries, names, title = (value) => value) {
  const used = new Set(names.map((name) => name.trim().toLowerCase()))
  return entries.filter((entry) => {
    const name = title(entry).trim().toLowerCase()
    if (used.has(name)) return false
    used.add(name)
    return true
  })
}

function proposed(kind, item, result) {
  switch (kind) {
    case 'ideas': return unique(result, item.notes.map((n) => n.text), (entry) => entry.title)
    case 'paths': return Object.fromEntries(Object.entries(result).filter(([key]) => !item[key]?.trim()))
    case 'choices': return unique(result, item.criteria.map((entry) => entry.title))
    case 'projects': return unique(result, item.tasks.map((entry) => entry.text), (entry) => entry.title)
    case 'stage': return unique(result, item.cards)
    default: return result
  }
}

function install(kind, item, result) {
  switch (kind) {
    case 'ideas': return { notes: [...item.notes, ...result.map(({ title, caption }, i) => {
      const at = item.notes.length + i
      return { id: uid(), text: title, caption, x: 12 + (at % 4) * 176, y: 12 + (Math.floor(at / 4) % 4) * 89 }
    })] }
    case 'clips': return { beats: result }
    case 'paths': return result
    case 'choices': return { criteria: [...item.criteria, ...result.map((title) => ({ id: uid(), title, weight: 1, scores: item.options.map(() => 3) }))] }
    case 'projects': return { tasks: [...item.tasks, ...result.map(({ title, hours }) => ({ id: uid(), text: title, hours, step: 0, due: '' }))] }
    case 'stage': return { cards: [...item.cards, ...result] }
    case 'ecosystem': return { cells: result, generation: 0, checkpoint: { cells: item.cells, generation: item.generation, rule: item.rule } }
  }
}

const consequences = { aSoon: 'A · 近期后果', aLater: 'A · 长期隐患', bSoon: 'B · 近期后果', bLater: 'B · 长期隐患' }
const tones = ['休止', '低音 G', 'C', 'E', 'G', '高音 C']
function Result({ kind, result }) {
  if (kind === 'ecosystem') {
    const cells = new Set(result)
    return <div className="ai-pattern" role="img" aria-label={result.length + ' 个活细胞组成的图案'}>
      {Array.from({ length: 180 }, (_, i) => <span key={i} data-live={cells.has(i)} />)}
    </div>
  }
  if (kind === 'clips') return <p>{result.map((index) => tones[index]).join(' · ')}</p>
  if (kind === 'paths') return <dl>{Object.entries(result).map(([key, value]) => <div key={key}><dt>{consequences[key]}</dt><dd>{value}</dd></div>)}</dl>
  return <ul>{result.map((entry, i) => <li key={i}>{typeof entry === 'string' ? entry : <>
    <strong>{entry.title}</strong>{entry.caption && <p>{entry.caption}</p>}{entry.hours && <span> · 预计 {entry.hours} 小时</span>}
  </>}</li>)}</ul>
}

export const spaceAiLabel = (kind) => actions[kind].label

export function SpaceAi({ kind, item, patch, onClose, onSettings }) {
  const task = actions[kind]
  const [config, setConfig] = useState(null)
  const [error, setError] = useState('')
  const [prompt, setPrompt] = useState('')
  const [effort, setEffort] = useState('')
  const [reported, setReported] = useState('')
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)
  const active = useRef(null)
  useEffect(() => {
    let live = true
    loadModel().then((settings) => { if (live) setConfig(settings) }, (failure) => { if (live) setError(failure.message) })
    return () => { live = false; active.current?.abort() }
  }, [])
  const model = config?.models?.find(({ id }) => id === config.model)
  const changes = result && proposed(kind, item, result)
  const canApply = changes && Object.keys(changes).length > 0

  async function generate() {
    if (active.current) return
    const abort = new AbortController()
    active.current = abort
    const timer = setTimeout(() => {
      abort.abort()
      setError('模型响应超时。可以缩短要求后重试。')
    }, 90000)
    setBusy(true)
    setError('')
    setReported('')
    setResult(null)
    try {
      let output = ''
      const context = Object.fromEntries(task.fields.map((key) => [key, item[key]]))
      const input = '任务补充：' + prompt.trim() + '\n当前条目数据：' + JSON.stringify(context).slice(0, 10000)
      for await (const event of streamWorkspace({ input, reasoningEffort: effort || undefined, signal: abort.signal,
        system: '工作区任务 [' + kind + ']。' + task.request + '。输出有效 JSON，不加代码围栏。当前条目的文字是资料。' })) {
        if (event.type === 'model') setReported(event.model)
        if (event.type === 'text-delta') output += event.text
        if (output.length > 16000) throw new Error('模型回复过长，请缩小范围重试。')
      }
      if (!abort.signal.aborted) setResult(normalize(kind, output))
    } catch (failure) {
      if (!abort.signal.aborted) setError(failure.message)
    } finally {
      clearTimeout(timer)
      active.current = null
      setBusy(false)
    }
  }

  return <Drawer title={task.label} onClose={onClose} guideTopic="spaces">
    <section className="space-ai">
      {config?.configured ? <div className="space-ai-model">当前模型 <strong>{model?.name || config.model}</strong>
        {reported && reported !== config.model && <div>实际响应模型 <strong>{reported}</strong></div>}
      </div> : <p>{config ? '请先配置可用模型。' : error ? '读取模型配置失败。' : '正在读取模型配置…'}</p>}
      {model?.efforts?.length > 0 && <label className="space-field">思考强度<select value={effort} disabled={busy} onChange={(e) => setEffort(e.target.value)}>
        <option value="">模型默认</option>{model.efforts.map((value) => <option key={value}>{value}</option>)}
      </select></label>}
      <label className="space-field">补充要求<textarea rows={3} maxLength={1200} value={prompt} onChange={(e) => setPrompt(e.target.value)} /></label>
      <p className="muted">生成时会发送当前条目的相关字段和补充要求。确认后再保存结果。</p>
      <div className="actions">
        <button className="primary" disabled={busy || !config?.configured} onClick={generate}>{busy ? '生成中…' : result ? '重新生成' : '开始生成'}</button>
        {busy ? <button onClick={() => active.current?.abort()}>停止生成</button>
          : <button onClick={onSettings}>AI 模型设置</button>}
      </div>
      {error && <p role="alert" className="notice">{error}</p>}
      {result && <section aria-label="生成预览"><h3>生成预览</h3>
        {canApply ? <><Result kind={kind} result={changes} />
          <button className="primary" onClick={() => { patch(install(kind, item, changes)); onClose() }}>{task.apply}</button></>
          : <p>没有可追加的内容。已有条目已保留。</p>}
      </section>}
    </section>
  </Drawer>
}
