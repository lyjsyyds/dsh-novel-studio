import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { BookmarkPlus, Copy, Ellipsis, GitBranch, GripVertical, Mail, Quote, Search, Sparkles, WrapText, X } from 'lucide-react'
import { manuscriptOffset } from './writer-navigation.jsx'

const gutter = 8
const clamp = (value, size, available) => Math.max(gutter, Math.min(value, available - size - gutter))
const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }

async function copySelection(editor, selection) {
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(selection.text)
      return true
    }
  } catch {
    // Desktop renderers and embedded previews can restrict the Clipboard API.
  }
  if (editor.value.slice(selection.start, selection.end) !== selection.text) return false
  editor.focus({ preventScroll: true })
  editor.setSelectionRange(selection.start, selection.end)
  return document.execCommand('copy')
}

export function SelectionTools({ editorRef, selection, onDismiss, onOpen, onReplace, onSave, onTransfer }) {
  const capsule = useRef(null)
  const row = useRef(null)
  const drag = useRef(null)
  const moved = useRef(null)
  const place = useRef(null)
  const [expanded, setExpanded] = useState(false)
  const [message, setMessage] = useState('')
  const [saveState, setSaveState] = useState('idle')
  const moreId = useId()

  useLayoutEffect(() => {
    const node = capsule.current
    const editor = editorRef.current
    const area = node.offsetParent
    const anchor = selection.anchor
    const caret = anchor ? null : manuscriptOffset(editor, selection.edge)

    function update() {
      const { left, top } = area.getBoundingClientRect()
      const rect = editor.getBoundingClientRect()
      const width = node.offsetWidth
      const barHeight = row.current.offsetHeight
      const x = rect.left - left + (anchor ? anchor.x : caret.x - editor.scrollLeft)
      const rawY = anchor ? anchor.y + anchor.scroll - editor.scrollTop : caret.y - editor.scrollTop
      const y = rect.top - top + Math.max(0, Math.min(rect.height, rawY))
      const initial = { x: x - width / 2, y: y - barHeight - gutter >= gutter ? y - barHeight - gutter : y + 22 }
      const target = moved.current || initial
      node.style.left = clamp(target.x, width, area.clientWidth) + 'px'
      node.style.top = clamp(target.y, node.offsetHeight, area.clientHeight) + 'px'
    }

    place.current = update
    update()
    const observer = new ResizeObserver(update)
    observer.observe(area)
    observer.observe(editor)
    observer.observe(node)
    editor.addEventListener('scroll', update, { passive: true })
    return () => {
      observer.disconnect()
      editor.removeEventListener('scroll', update)
    }
  }, [editorRef, selection])

  useEffect(() => {
    function outside(event) {
      if (!capsule.current.contains(event.target) && event.target !== editorRef.current) onDismiss(false)
    }
    document.addEventListener('pointerdown', outside, true)
    return () => document.removeEventListener('pointerdown', outside, true)
  }, [editorRef, onDismiss])

  function move(x, y) {
    moved.current = { x, y }
    place.current()
  }

  async function copy() {
    const copied = await copySelection(editorRef.current, selection).catch(() => false)
    setMessage(copied ? '已复制选段' : '请用系统复制命令复制选中的文字')
  }

  async function transfer(kind) {
    setSaveState('sending')
    try { await onTransfer(kind, selection) }
    catch (error) { setMessage(error.message) }
    finally { setSaveState('idle') }
  }

  const trimmed = selection.text.trim()
  const quoted = trimmed.startsWith('“') && trimmed.endsWith('”') ? selection.text
    : selection.text.replace(/^(\s*)([\s\S]*?\S)(\s*)$/, '$1“$2”$3')
  const cleaned = selection.text.replace(/[ \t\u3000]+(?=\n)/g, '').replace(/\n{3,}/g, '\n\n')
  return <div className="selection-capsule" ref={capsule} role="group" aria-label="选段工具"
    onMouseDown={(event) => { if (event.target.closest('button')) event.preventDefault() }}
    onKeyDown={(event) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      onDismiss(true)
    }}>
    <div className="selection-bar" ref={row}>
      <button type="button" className="selection-grip" title="拖动胶囊，或用方向键移动" aria-label="移动选段工具"
        onPointerDown={(event) => {
          if (event.button !== 0 || !event.isPrimary) return
          event.currentTarget.setPointerCapture(event.pointerId)
          const node = capsule.current
          drag.current = { x: node.offsetLeft - event.clientX, y: node.offsetTop - event.clientY }
          node.dataset.dragging = 'true'
        }}
        onPointerMove={(event) => {
          if (drag.current && event.currentTarget.hasPointerCapture(event.pointerId)) {
            move(event.clientX + drag.current.x, event.clientY + drag.current.y)
          }
        }}
        onLostPointerCapture={() => { drag.current = null; delete capsule.current.dataset.dragging }}
        onKeyDown={(event) => {
          const direction = arrows[event.key]
          if (!direction) return
          event.preventDefault()
          const node = capsule.current
          move(node.offsetLeft + direction[0] * 24, node.offsetTop + direction[1] * 24)
        }}><GripVertical size={18} aria-hidden /></button>
      <button type="button" className="selection-action" onClick={copy} disabled={!selection.text}><Copy size={15} aria-hidden />复制</button>
      <button type="button" className="selection-action" onClick={() => onOpen('find', selection)} disabled={!trimmed}><Search size={15} aria-hidden />查找</button>
      <button type="button" className="selection-action selection-ai" onClick={() => onOpen('rewrite', selection)} disabled={!trimmed}><Sparkles size={15} aria-hidden />改写</button>
      <button type="button" className="selection-action" aria-expanded={expanded} aria-controls={moreId}
        onClick={() => setExpanded(!expanded)}><Ellipsis size={16} aria-hidden />更多</button>
      <button type="button" className="selection-close" aria-label="关闭选段工具" onClick={() => onDismiss(true)}><X size={16} aria-hidden /></button>
    </div>
    {expanded && <div className="selection-extras" id={moreId}>
      <div className="selection-stats">{[...selection.text.replace(/\s/g, '')].length} 字符（不含空白）
        {trimmed && ' · ' + trimmed.split(/\n[ \t\u3000]*\n+/).length + ' 段'}</div>
      <div className="selection-grid">
        <button type="button" disabled={quoted === selection.text} onClick={() => onReplace(selection, quoted)}><Quote size={15} aria-hidden />加中文引号</button>
        <button type="button" disabled={cleaned === selection.text} onClick={() => onReplace(selection, cleaned)}><WrapText size={15} aria-hidden />整理空白</button>
        <button type="button" disabled={!trimmed} onClick={() => onOpen('search', selection)}><Search size={15} aria-hidden />全书搜索</button>
        <button type="button" disabled={!trimmed || saveState !== 'idle'} onClick={async () => {
          setSaveState('saving')
          setMessage('')
          try { await onSave(selection); setSaveState('saved'); setMessage('已存入资料中的素材') }
          catch (error) { setSaveState('idle'); setMessage(error.message) }
        }}><BookmarkPlus size={15} aria-hidden />{saveState === 'saving' ? '正在保存…' : saveState === 'saved' ? '已存为素材' : '存为素材'}</button>
        <button type="button" disabled={!trimmed || saveState === 'sending'} onClick={() => transfer('clips')}><Mail size={15} aria-hidden />制成声音明信片</button>
        <button type="button" disabled={!trimmed || saveState === 'sending'} onClick={() => transfer('paths')}><GitBranch size={15} aria-hidden />分岔试写</button>
      </div>
    </div>}
    {message && <div className="selection-message" role="status">{message}</div>}
  </div>
}
