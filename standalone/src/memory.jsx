import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, BookOpen, Pin, Plus, Sparkles, X } from 'lucide-react'
import { memoryCategories } from '../../lib/story-memory.js'
import { api } from './transport.js'
import { generateMemory, memoryWorkspace, planMemories, readMemories, writeMemory } from './continuity.js'

const states = { empty: '未填写', ready: '已确认', stale: '待核对' }
const enc = encodeURIComponent

export function MemoryPicker({ memory, ahead, review, onChange, onRefresh }) {
  const [open, setOpen] = useState(false)
  const selected = memory?.items.filter((entry) => entry.selected).map(({ key }) => key) || []
  return <div className="recap-picker">
    <div className="actions">
      <button type="button" onClick={() => setOpen(!open)}>本轮前情{memory ? ' · ' + selected.length + ' 条' : ''}</button>
      <button type="button" onClick={onRefresh}>重新读取</button>
      {memory && <small>{memory.used.toLocaleString('zh-CN')} / {memory.budget.toLocaleString('zh-CN')} 字符</small>}
    </div>
    {open && <>
      {review && <label className="check-label"><input type="checkbox" checked={ahead}
        onChange={(event) => onChange({ ahead: event.target.checked })} />允许选择后续章节</label>}
      <div className="actions">
        <button type="button" disabled={!memory} onClick={() => onChange({ ahead })}>恢复自动选择</button>
        <button type="button" disabled={!memory} onClick={() => onChange({ ahead, keys: [] })}>清空本轮引用</button>
      </div>
      {!memory && <p className="muted">前情正在读取。若未加载，请重新读取。</p>}
      {!!memory && !memory.items.length && <p className="muted">这里还没有已填写的前情。可在「前情记忆」里补充。</p>}
      <details className="recap-sent">
        <summary>实际发送的前情</summary><pre>{memory?.text || '本轮未选前情。'}</pre>
      </details>
      <div className="recap-items">
        {memory?.items.map((entry) => <details key={entry.key}>
          <summary>
            <label onClick={(event) => event.stopPropagation()}>
              <input type="checkbox" checked={entry.selected} disabled={!entry.allowed} onChange={(event) => {
                const chosen = memory.items.filter(({ selected, trimmed }) => selected || trimmed).map(({ key }) => key)
                onChange({ ahead, keys: event.target.checked ? [...chosen, entry.key] : chosen.filter((key) => key !== entry.key) })
              }} />
              <span>{entry.title} · {entry.kind === 'chapter' ? '章' : '场景'}</span>
            </label>
            <small>{entry.trimmed ? '超出预算' : entry.state === 'stale' ? '待核对' : !entry.allowed ? '超出当前章节范围' : entry.pinned ? '已固定' : ''}</small>
          </summary>
          <pre>{entry.text}</pre>
        </details>)}
      </div>
    </>}
  </div>
}

export function CharacterMemory({ book, person, onOpenChapter }) {
  const [items, setItems] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    readMemories(book.id).then((entries) => {
      if (active) setItems(entries.filter(({ state }) => state === 'ready'))
    }).catch((failure) => { if (active) setError(failure.message) })
    return () => { active = false }
  }, [book.id])
  const matches = (items || []).flatMap((item) => item.changes.filter((change) => change.people?.includes(person))
    .map((change, index) => ({ ...change, title: item.title, chapter: item.chapter, key: item.key + ':' + index })))
  return <section className="ns-dossier-sec character-memory">
    <h3>已确认的人物变化</h3>
    {error && <p className="notice">{error}</p>}
    {!matches.length && <p className="muted">{items ? '暂无关联到此人的前情变化。' : '正在读取变化…'}</p>}
    <ul className="context-list">{matches.map(({ key, text, category, chapter, title }) => <li key={key}>
      <button className="text-button" disabled={!chapter} onClick={() => onOpenChapter(chapter)}>{title}</button>
      <p>{category} · {text}</p>
    </li>)}</ul>
  </section>
}

function MemoryEditor({ book, entry, candidate, people, onSave, onPlan, busy }) {
  const [summary, setSummary] = useState(entry.summary)
  const [changes, setChanges] = useState(entry.changes)
  const [pinned, setPinned] = useState(entry.pinned)
  const [mode, setMode] = useState(entry.sourceMode)
  const [source, setSource] = useState(null)
  const [range, setRange] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const authors = new Map(people.map((item) => [item.id, item.name || item.id]))
  function changeAt(index, value) {
    setChanges((items) => items.map((item, i) => i === index ? { ...item, ...value } : item))
  }
  async function readSource() {
    setLoading(true)
    try {
      const { data } = await api('GET', '/library/' + enc(book.id) + '/unit/chapters/' + enc(entry.chapter))
      setSource(data.body || '')
      setRange(null)
    } catch (failure) { setError(failure.message) }
    finally { setLoading(false) }
  }
  function takeCandidate() {
    setSummary(candidate.summary)
    setChanges(candidate.changes)
    setMode(candidate.sourceMode)
    setError('')
  }
  async function save(event) {
    event.preventDefault()
    setError('')
    try {
      await onSave({
        summary, changes, pinned, sourceMode: mode, version: entry.version,
        sourceRevision: candidate && candidate.sourceMode === mode
          ? candidate.sourceRevision : entry.sources[mode],
      })
    } catch (failure) { setError(failure.message) }
  }
  return <form className="memory-editor" onSubmit={save}>
    <header className="memory-header">
      <div><h2>{entry.title}</h2><small>{entry.kind === 'chapter' ? '章节' : '场景'} · {states[entry.state]}</small></div>
      <label className="check-label"><input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} /><Pin size={15} />固定引用</label>
    </header>
    {entry.state === 'stale' && <p className="muted">来源已变化或前情尚未核对。确认保存后会重新进入自动引用。</p>}
    {candidate && <div className="memory-candidate">
      <strong>AI 候选</strong><p>{candidate.summary}</p>
      <button type="button" onClick={takeCandidate}>载入候选到编辑区</button>
    </div>}
    <label className="memory-field">前情摘要<textarea value={summary} rows={5} maxLength={1800}
      onChange={(e) => setSummary(e.target.value)} /></label>
    <div className="memory-subheading"><h3>关键变化</h3>
      <button type="button" disabled={changes.length >= 24}
        onClick={() => setChanges((items) => [...items, { category: '人物', text: '', people: [] }])}><Plus size={15} /> 新增变化</button></div>
    <div className="memory-changes">
      {changes.map((item, index) => <div key={index} className="change-row">
        <div className="actions">
          <select aria-label={'变化分类 ' + (index + 1)} value={item.category}
            onChange={(e) => changeAt(index, { category: e.target.value })}>
            {memoryCategories.map((category) => <option key={category}>{category}</option>)}
          </select>
          <button type="button" className="icon-button" aria-label={'删除变化 ' + (index + 1)}
            onClick={() => setChanges(changes.filter((_, i) => i !== index))}><X size={17} /></button>
        </div>
        <textarea rows={2} maxLength={420} aria-label={'变化内容 ' + (index + 1)}
          value={item.text} onChange={(e) => changeAt(index, { text: e.target.value })} />
        {people.length > 0 && <div className="actions">
          <select aria-label={'关联人物 ' + (index + 1)} value="" onChange={(e) => {
            if (e.target.value) changeAt(index, { people: [...new Set([...(item.people || []), e.target.value])] })
          }}><option value="">关联人物</option>
            {people.map(({ id, name }) => <option key={id} value={id}>{name || id}</option>)}
          </select>
          {(item.people || []).map((id) => <button type="button" key={id}
            onClick={() => changeAt(index, { people: item.people.filter((other) => other !== id) })}>{authors.get(id) || id} ×</button>)}
        </div>}
      </div>)}
    </div>
    <div className="actions memory-actions">
      <button className="primary" type="submit" disabled={busy || (!summary.trim() && !changes.some(({ text }) => text.trim()) && entry.state === 'empty')}>确认并保存</button>
      <button type="button" disabled={busy} onClick={() => onPlan([{ key: entry.key }])}><Sparkles size={16} />{entry.kind === 'chapter' ? '从章节生成' : '从场景卡生成'}</button>
      {entry.kind === 'scene' && entry.chapter && <button type="button" disabled={loading || busy}
        onClick={readSource}>从所属章节选段</button>}
    </div>
    {source !== null && <div className="source-picker">
      <label className="memory-field">在正文中选中一个场景片段
        <textarea readOnly rows={6} value={source} onSelect={(e) => setRange([e.target.selectionStart, e.target.selectionEnd])} />
      </label>
      <button type="button" disabled={busy || !range || range[1] <= range[0]} onClick={() =>
        onPlan([{ key: entry.key, selection: { chapter: entry.chapter, original: source, start: range[0], end: range[1] } }])}>从所选片段生成</button>
    </div>}
    {error && <p className="notice" role="alert">{error}</p>}
  </form>
}

export function MemoryPane({ book, initialKey, onOpen, compact = false, active = true }) {
  const [items, setItems] = useState(null)
  const [people, setPeople] = useState([])
  const [volumes, setVolumes] = useState([])
  const [key, setKey] = useState(initialKey || '')
  const [editing, setEditing] = useState(Boolean(initialKey))
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [volume, setVolume] = useState('')
  const [checked, setChecked] = useState([])
  const [saves, setSaves] = useState({})
  const [candidates, setCandidates] = useState({})
  const [plan, setPlan] = useState(null)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const controller = useRef(null)
  const refresh = useCallback(async () => {
    const { items: list, people: cast, board, volumes: storyVolumes } = await memoryWorkspace(book.id, !compact)
    setItems(list)
    setPeople(cast)
    setVolumes((board ? storyVolumes : []).filter(({ title }) => title).map((item, index) => ({
      key: String(index), title: item.title,
      ids: new Set(board.chapters.filter((chapter) => chapter.volume === item.title).map(({ id }) => id)),
    })))
  }, [book.id, compact])
  useEffect(() => {
    if (active) void refresh().catch((failure) => setError(failure.message))
  }, [refresh, active])
  useEffect(() => {
    return () => controller.current?.abort()
  }, [])

  const initial = items?.find((item) => item.key === initialKey)
  const scopedChapter = initialKey?.startsWith('chapter:') ? initialKey.slice(8) : initial?.chapter
  const visible = (items || []).filter((item) => {
    const volumeIds = volumes.find((entry) => entry.key === volume)?.ids
    return (!compact || !initialKey || item.key === initialKey || (scopedChapter && item.chapter === scopedChapter))
      && (filter === 'all' || filter === item.kind || filter === item.state)
      && (!volumeIds || volumeIds.has(item.chapter))
      && (!query.trim() || [item.title, item.summary].join('\n').toLowerCase().includes(query.trim().toLowerCase()))
  })
  const entry = (items || []).find((item) => item.key === key) || visible[0]

  async function preview(requests) {
    setError('')
    setStatus('')
    try {
      const entries = await planMemories(book.id, requests)
      setPlan(entries.map((item, index) => ({ ...item, request: requests[index] })))
    } catch (failure) { setError(failure.message) }
  }

  async function generate() {
    const active = new AbortController()
    controller.current = active
    setBusy(true)
    setError('')
    let complete = 0
    try {
      for (const current of plan) {
        if (!current.calls) continue
        setStatus('正在生成 · ' + current.entry.title)
        const candidate = await generateMemory(book.id, current, active.signal)
        setCandidates((items) => ({ ...items, [current.key]: {
          ...candidate, sourceRevision: current.entry.sources[current.mode],
        } }))
        complete++
      }
      setStatus('已生成 ' + complete + ' 条候选，请逐条核对。')
      setPlan(null)
    } catch (failure) {
      if (active.signal.aborted) setStatus('已取消。已完成的候选可继续核对。')
      else setError(failure.message)
    } finally {
      controller.current = null
      setBusy(false)
    }
  }

  return <div className="memory-feature" data-compact={compact}>
    {error && <p role="alert" className="notice">{error}</p>}
    {status && <p role="status" className="memory-status">{status}</p>}
    {!!plan && <section className="memory-source-summary">
      <h2>生成前核对</h2>
      <p>{plan.length} 条 · 预计请求 {plan.reduce((total, item) => total + item.calls, 0)} 次</p>
      {plan.map((item) => <details key={item.key}>
        <summary>{item.entry.title} · {item.mode === 'excerpt' ? '所选片段' : item.mode === 'scene' ? '场景卡' : '章节正文'} · {item.text.length} 字符</summary>
        <pre>{item.text || '来源为空'}</pre>
      </details>)}
      <div className="actions">
        <button type="button" className="primary" disabled={busy || !plan.some(({ calls }) => calls)} onClick={generate}>开始生成</button>
        <button type="button" onClick={() => { if (busy) controller.current?.abort(); else setPlan(null) }}>{busy ? '停止生成' : '关闭预览'}</button>
      </div>
    </section>}
    <div className="memory-layout" data-detail={editing && Boolean(entry)}>
      <aside className="memory-shelf">
        {compact ? <h3>本章与场景</h3> : <>
          <input className="memory-search" aria-label="搜索前情" placeholder="搜索前情" value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="actions">
            <select aria-label="前情类型" value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="all">全部</option><option value="chapter">章节</option><option value="scene">场景</option>
              <option value="stale">待核对</option><option value="empty">未填写</option>
            </select>
            {volumes.length > 0 && <select aria-label="按卷筛选" value={volume} onChange={(e) => setVolume(e.target.value)}>
              <option value="">所有卷</option>{volumes.map((entry) => <option key={entry.key} value={entry.key}>{entry.title}</option>)}
            </select>}
          </div>
          <button disabled={busy || !checked.length} onClick={() => preview(checked.map((key) => ({ key })))}>生成选中章节 · {checked.length}/10</button>
        </>}
        <ul className="memory-entries">
          {visible.map((item) => <li key={item.key}>
            {!compact && item.kind === 'chapter' && <input type="checkbox" aria-label={'选中 ' + item.title}
              checked={checked.includes(item.key)} disabled={!checked.includes(item.key) && checked.length >= 10}
              onChange={(e) => setChecked((old) => e.target.checked ? [...old, item.key] : old.filter((value) => value !== item.key))} />}
            <button onClick={() => { setKey(item.key); setEditing(true) }} data-on={entry?.key === item.key}>
              <span>{item.title}</span><small>{candidates[item.key] ? '待确认候选' : states[item.state]}{item.pinned ? ' · 已固定' : ''}</small>
            </button>
          </li>)}
        </ul>
        {!visible.length && <p className="muted">{items ? '这里没有符合条件的前情。' : '正在读取前情…'}</p>}
      </aside>
      {entry ? <div className="memory-detail">
        <button className="text-button memory-back" onClick={() => setEditing(false)}><ArrowLeft size={16} />返回前情列表</button>
        {!compact && entry.chapter && onOpen && <button className="text-button" onClick={() => onOpen(entry.chapter)}><BookOpen size={15} />打开所属章节<ArrowRight size={15} /></button>}
        {saves[entry.key] && <p role="status" className="memory-status">前情已保存</p>}
        <MemoryEditor key={entry.key + ':' + entry.version} book={book} entry={entry} candidate={candidates[entry.key]}
          people={people} busy={busy} onPlan={preview} onSave={async (value) => {
            const saved = await writeMemory(book.id, entry.key, value)
            setItems((old) => old.map((item) => item.key === saved.key ? saved : item))
            setCandidates((old) => ({ ...old, [saved.key]: null }))
            if (matchMedia('(max-width: 760px)').matches) {
              setStatus('前情已保存')
              setEditing(false)
            } else setSaves((old) => ({ ...old, [saved.key]: true }))
          }} />
      </div> : items?.length === 0 && <div className="workspace-empty"><BookOpen size={28} /><p>新建章节或场景后即可记录前情。</p></div>}
    </div>
  </div>
}
