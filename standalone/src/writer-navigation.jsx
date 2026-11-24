import React, { useEffect, useMemo, useState } from 'react'
import { Files, Plus } from 'lucide-react'
import { chapterLookup } from '../../lib/story.js'

export function ChapterOutline({ chapters, volumes, current, onOpen, onCreate, onManage, onDrafts }) {
  const grouped = useMemo(() => {
    const resolve = chapterLookup(chapters)
    const order = new Map(chapters.map(({ id }, index) => [id, index]))
    const ranges = volumes.map((volume) => ({ title: volume.title, first: order.get(resolve(volume.from)?.id), last: order.get(resolve(volume.to)?.id) }))
    const groups = []
    for (const [index, chapter] of chapters.entries()) {
      const title = ranges.find(({ first, last }) => index >= first && index <= last)?.title || ''
      const group = groups.at(-1)
      if (!group || group.title !== title) groups.push({ title, index, items: [] })
      groups.at(-1).items.push({ ...chapter, number: index + 1 })
    }
    return groups
  }, [chapters, volumes])
  const [filter, setFilter] = useState('')
  const query = filter.trim().toLowerCase()
  return <div className="chapter-outline">
    <div className="chapter-list-heading"><h2>章节目录</h2><button className="icon-button" aria-label="新建章节" onClick={onCreate}><Plus size={19} /></button></div>
    <input className="chapter-filter" aria-label="筛选章节" placeholder="筛选章节" value={filter} onChange={(e) => setFilter(e.target.value)} />
    <div className="chapter-outline-list">
      {grouped.map(({ title, index, items }) => {
        const visible = query ? items.filter((item) => (item.title || item.id).toLowerCase().includes(query)) : items
        if (!visible.length) return null
        const rows = <ol className="chapter-list" start={visible[0].number}>{visible.map(({ id, title: name, number }) =>
          <li key={id}><button data-on={current === id} aria-current={current === id ? 'location' : undefined} onClick={() => onOpen(id)}>
            <span>{String(number).padStart(2, '0')}</span>{name || id}</button></li>)}</ol>
        if (!title && grouped.length === 1) return <div key={index}>{rows}</div>
        return <details key={index} open={Boolean(query || visible.some(({ id }) => id === current) || index === 0)}>
          <summary>{title || '未分卷'}<span>{visible.length}</span></summary>{rows}
        </details>
      })}
    </div>
    <div className="chapter-outline-actions"><button onClick={onManage}><Files size={15} />章节管理</button><button onClick={onDrafts}>全部草稿</button></div>
  </div>
}

export function useWritingViewport(input, mobile) {
  const [height, setHeight] = useState(0)
  useEffect(() => {
    if (!mobile) return
    const viewport = window.visualViewport
    let fullHeight = 0
    let width = 0
    function measure() {
      const nextWidth = window.innerWidth
      const nextHeight = Math.round(viewport?.height || window.innerHeight)
      if (Math.abs(width - nextWidth) > 40) { width = nextWidth; fullHeight = nextHeight }
      fullHeight = Math.max(fullHeight, nextHeight)
      const typing = input.current && document.activeElement === input.current
      setHeight(typing && fullHeight - nextHeight > 115 && (viewport?.scale ?? 1) < 1.05 ? nextHeight : 0)
    }
    const onFocus = () => requestAnimationFrame(measure)
    measure()
    window.addEventListener('resize', measure)
    viewport?.addEventListener('resize', measure)
    document.addEventListener('focusin', onFocus)
    document.addEventListener('focusout', onFocus)
    return () => {
      window.removeEventListener('resize', measure)
      viewport?.removeEventListener('resize', measure)
      document.removeEventListener('focusin', onFocus)
      document.removeEventListener('focusout', onFocus)
    }
  }, [input, mobile])
  return mobile ? height : 0
}

export function manuscriptOffset(input, offset) {
  const computed = getComputedStyle(input)
  const measure = document.createElement('div')
  Object.assign(measure.style, {
    position: 'fixed', inset: '0 auto auto 0', visibility: 'hidden', pointerEvents: 'none',
    width: input.clientWidth + 'px', font: computed.font, lineHeight: computed.lineHeight, letterSpacing: computed.letterSpacing,
    padding: computed.padding, whiteSpace: 'pre-wrap', overflowWrap: 'break-word',
  })
  const marker = document.createElement('span')
  const lineEnd = input.value.indexOf('\n', offset)
  marker.textContent = input.value.slice(offset, lineEnd === -1 ? undefined : lineEnd) || '\u200b'
  measure.append(document.createTextNode(input.value.slice(0, offset)), marker)
  document.body.append(measure)
  const position = { x: marker.offsetLeft, y: marker.offsetTop }
  measure.remove()
  return position
}

export function revealPosition(input, offset) {
  if (input.scrollHeight <= input.clientHeight) return
  const { y } = manuscriptOffset(input, offset)
  if (y < input.scrollTop || y > input.scrollTop + input.clientHeight - 35) input.scrollTop = Math.max(0, y - input.clientHeight / 3)
}
