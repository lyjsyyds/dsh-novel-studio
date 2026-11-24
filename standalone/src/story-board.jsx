import React, { useEffect, useMemo, useState } from 'react'
import { ArrowRight, CalendarDays, GitBranch, Layers, MoveRight, SlidersHorizontal } from 'lucide-react'
import { loadBoard, moveScene } from './continuity.js'

const keyOf = (row) => [row.kind, row.id, row.milestone].join(':')
const labels = { scene: '场景', event: '年表事件', foreshadowing: '伏笔' }

function castList(scene) {
  return Array.isArray(scene.characters) ? scene.characters : String(scene.characters || '').split(/[、,，\s]+/).filter(Boolean)
}

export function StoryBoard({ book, go, compact = false, onChanged }) {
  const [board, setBoard] = useState(null)
  const [mode, setMode] = useState('chapter')
  const [volume, setVolume] = useState('')
  const [cast, setCast] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [limit, setLimit] = useState(36)
  const [move, setMove] = useState(null)
  const [dragged, setDragged] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [reload, setReload] = useState(0)
  useEffect(() => {
    let open = true
    loadBoard(book.id).then((data) => { if (open) setBoard(data) })
      .catch((error) => { if (open) setMessage(error.message) })
    return () => { open = false }
  }, [book.id, reload])
  const chapters = board?.chapters || []
  const activeRange = useMemo(() => {
    const start = from ? chapters.findIndex((chapter) => chapter.id === from) : 0
    const end = to ? chapters.findIndex((chapter) => chapter.id === to) : chapters.length - 1
    return new Set(chapters.filter((chapter) => chapter.index >= Math.min(start, end)
      && chapter.index <= Math.max(start, end) && (!volume || chapter.volume === volume)).map(({ id }) => id))
  }, [chapters, from, to, volume])
  const castMember = board?.people.find(({ id }) => id === cast)
  const names = new Map((board?.people || []).map(({ id, name }) => [id, name || id]))
  const near = (row) => !castMember || (row.kind === 'scene'
    && castList(row).some((name) => name === castMember.id || name === castMember.name))
  function open(row) {
    if (row.kind === 'scene') go('outline', 'scenes', row.id)
    else if (row.kind === 'event') go('world', 'timeline', String(row.id))
    else go('outline', 'foreshadowing', String(row.id))
  }
  async function confirmMove() {
    if (!move.destination || busy) return
    setBusy(true)
    setMessage('')
    try {
      await moveScene(book.id, move.row.id, move.row.chapterRef, move.destination)
      setMove(null)
      setReload((value) => value + 1)
      setMessage('场景已移动。')
      onChanged?.()
    } catch (error) { setMessage(error.message) }
    finally { setBusy(false) }
  }
  function showRow(row) {
    const cast = row.kind === 'scene' ? castList(row).map((id) => names.get(id) || id).join(' · ') : ''
    const stage = { plantedChapter: '埋设', due: '待回收', payoff: '实际回收' }[row.milestone]
    return <article className="story-entry" key={keyOf(row)} data-kind={row.kind} data-stage={row.milestone}
      draggable={row.kind === 'scene'} onDragStart={(event) => {
        if (row.kind !== 'scene') return
        event.dataTransfer.setData('text/plain', row.id)
        event.dataTransfer.effectAllowed = 'move'
        setDragged(row.id)
      }} onDragEnd={() => setDragged('')}>
      <div className="story-entry-main">
        <small>{stage || row.label || labels[row.kind]}{row.status && row.status !== stage ? ' · ' + row.status : ''}</small>
        <button className="text-button" onClick={() => open(row)}>{row.title}</button>
        {cast && <small>出场 · {cast}</small>}
        <p>{row.goal || row.description || row.notes || ''}</p>
      </div>
      {row.kind === 'scene' && <div className="actions story-entry-actions">
        <button onClick={() => go('memory', 'scene', row.id)}>场景前情</button>
        <button onClick={() => setMove({ row, destination: row.chapter?.id || '' })}><MoveRight size={15} />移动</button>
      </div>}
    </article>
  }
  const dated = (board?.dated || []).filter((row) => near(row)
    && ((!from && !to && !volume) || activeRange.has(row.chapter?.id)))
  const pending = [...new Map([...(board?.unlinked || []), ...(board?.pending || [])]
    .filter(near).map((row) => [keyOf(row), row])).values()]
  const chapterRows = chapters.filter((chapter) => activeRange.has(chapter.id)
    && (!cast || chapter.rows.some(near)))
  const people = board?.people || []
  const filterCount = [volume, from, to, cast].filter(Boolean).length
  return <section className="story-workspace" data-compact={compact}>
    <header className="story-toolbar">
      <div className="segments" aria-label="看板顺序">
        <button data-on={mode === 'chapter'} onClick={() => { setMode('chapter'); setLimit(36) }}><Layers size={16} />章序</button>
        <button data-on={mode === 'date'} onClick={() => { setMode('date'); setLimit(36) }}><CalendarDays size={16} />故事时间</button>
      </div>
      <details className="story-filters">
        <summary><SlidersHorizontal size={16} aria-hidden />筛选{filterCount ? ' · ' + filterCount : ''}</summary>
        <div className="actions story-filter">
        <select aria-label="按卷筛选" value={volume} onChange={(e) => { setVolume(e.target.value); setLimit(36) }}>
          <option value="">所有卷</option>{[...new Set((board?.volumes || []).map(({ title }) => title).filter(Boolean))].map((title) => <option key={title}>{title}</option>)}
        </select>
        <select aria-label="起始章节" value={from} onChange={(e) => { setFrom(e.target.value); setLimit(36) }}>
          <option value="">起始章</option>{chapters.map(({ id, title }) => <option key={id} value={id}>{title}</option>)}
        </select>
        <select aria-label="结束章节" value={to} onChange={(e) => { setTo(e.target.value); setLimit(36) }}>
          <option value="">结束章</option>{chapters.map(({ id, title }) => <option key={id} value={id}>{title}</option>)}
        </select>
        <select aria-label="出场人物" value={cast} onChange={(e) => { setCast(e.target.value); setLimit(36) }}>
          <option value="">所有人物</option>{people.map(({ name, id }) => <option key={id} value={id}>{name || id}</option>)}
        </select>
        {filterCount > 0 && <button onClick={() => { setVolume(''); setCast(''); setFrom(''); setTo(''); setLimit(36) }}>清空筛选</button>}
        </div>
      </details>
    </header>
    {message && <p role="status" className="memory-status">{message}</p>}
    {move && <section className="move-preview">
      <h3>移动场景 · {move.row.title}</h3>
      <p>{move.row.chapter?.title || '待关联章节'} <span aria-hidden>→</span> {chapters.find(({ id }) => id === move.destination)?.title || '请选择目标章节'}</p>
      <div className="actions">
        <select aria-label="目标章节" value={move.destination} onChange={(e) => setMove({ ...move, destination: e.target.value })}>
          <option value="">目标章节</option>{chapters.map(({ id, title }) => <option key={id} value={id}>{title}</option>)}
        </select>
        <button className="primary" disabled={busy || !move.destination || move.destination === move.row.chapter?.id} onClick={confirmMove}>确认移动</button>
        <button disabled={busy} onClick={() => setMove(null)}>取消</button>
      </div>
    </section>}
    {!board ? <p className="muted">正在读取剧情…</p> : mode === 'chapter' ? <div className="story-columns">
      {chapterRows.slice(0, limit).map((chapter) => <section className="story-chapter" key={chapter.id}
        data-drag={Boolean(dragged)} onDragOver={(event) => { if (dragged) event.preventDefault() }}
        onDrop={(event) => {
          event.preventDefault()
          const sceneId = event.dataTransfer.getData('text/plain')
          if (!sceneId || dragged !== sceneId) return
          const row = [...chapters.flatMap(({ rows }) => rows), ...board.unlinked].find((item) => item.kind === 'scene' && item.id === sceneId)
          if (row) setMove({ row, destination: chapter.id })
          setDragged('')
        }}>
        <header><div>{chapter.volume && <small>{chapter.volume}</small>}
          <h3><button className="text-button" onClick={() => go('write', undefined, chapter.id)}>{chapter.title}<ArrowRight size={15} /></button></h3></div>
          <span>{chapter.rows.filter(near).length} 条</span></header>
        {chapter.rows.filter(near).map(showRow)}
        {!chapter.rows.length && <p className="muted">尚无关联场景或伏笔。</p>}
      </section>)}
      {!chapterRows.length && <p className="muted">{chapters.length ? '当前筛选没有匹配的章节。' : '新建章节后即可安排场景。'}</p>}
    </div> : <div className="story-timeline">
      {dated.slice(0, limit).map((row) => <div className="story-date" key={keyOf(row)}>
        <div><time>{row.when}</time>{row.chapter && <small>{row.chapter.title}</small>}</div>{showRow(row)}
      </div>)}
      {!dated.length && <div className="workspace-empty"><GitBranch size={30} /><p>可在年表和场景中填写故事时间。</p></div>}
    </div>}
    {(mode === 'chapter' ? chapterRows.length : dated.length) > limit && <button onClick={() => setLimit(limit + 36)}>继续加载</button>}
    {pending.length > 0 && <details className="story-pending">
      <summary>待处理 · {pending.length} 条</summary>
      <div className="story-columns">{pending.map(showRow)}</div>
    </details>}
  </section>
}
