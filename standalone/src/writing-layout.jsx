import React, { useCallback, useEffect, useRef, useState } from 'react'
import { readFile, writeFile } from './files.js'
import { native, platform } from './platform.js'

const layoutFile = '/settings/writing-layout.json'
const defaults = { chapters: 200, tools: 360, split: 50, fill: false }
const clamp = (n, min, max) => Math.round(Math.max(min, Math.min(max, n)))
export const divider = 10

export function useWritingLayout() {
  const [value, setValue] = useState(defaults)
  const current = useRef(value)
  current.current = value
  const edited = useRef(false)
  const writes = useRef(Promise.resolve())
  const flush = useCallback(() => {
    if (edited.current) {
      const next = current.current
      writes.current = writes.current.then(() => writeFile(layoutFile, JSON.stringify(next))).catch(() => {})
    }
    return writes.current
  }, [])
  useEffect(() => {
    let live = true
    readFile(layoutFile, 'utf8').then(JSON.parse).then((saved) => {
      if (!live || edited.current) return
      setValue({
        chapters: Number.isFinite(saved.chapters) ? clamp(saved.chapters, 144, 360) : defaults.chapters,
        tools: Number.isFinite(saved.tools) ? clamp(saved.tools, 280, 1100) : defaults.tools,
        split: Number.isFinite(saved.split) ? clamp(saved.split, 1, 99) : defaults.split,
        fill: saved.fill === true,
      })
    }).catch(() => {})
    return () => { live = false }
  }, [])
  useEffect(() => {
    if (!edited.current) return
    const timer = setTimeout(flush, 250)
    function saveHidden() { if (document.hidden) { clearTimeout(timer); void flush() } }
    document.addEventListener('visibilitychange', saveHidden)
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', saveHidden) }
  }, [flush, value])
  return [value, (key, next) => {
    edited.current = true
    setValue((old) => old[key] === next ? old : { ...old, [key]: next })
  }, flush]
}

export function useMeasuredWidth(element, active) {
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const node = element.current
    if (!active || !node) return
    const update = () => { if (node.clientWidth) setWidth(node.clientWidth) }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(node)
    return () => observer.disconnect()
  }, [active, element])
  return width
}

export function layoutTracks(width, value, { rail, dock, split }) {
  const manuscriptMin = split ? 560 : 360
  const minRail = rail ? 144 + divider : 0
  const canDock = dock && width >= 900 && width - minRail >= manuscriptMin + 280 + divider
  const chapterMax = Math.max(144, Math.min(360, width - manuscriptMin - divider - (canDock ? 280 + divider : 0)))
  const chapters = rail ? clamp(value.chapters, 144, chapterMax) : 0
  const available = width - (rail ? chapters + divider : 0)
  const toolsMax = Math.floor(Math.min(width * 0.52, available - manuscriptMin - divider))
  const docked = canDock && toolsMax >= 280
  const tools = docked ? clamp(value.tools, 280, toolsMax) : 0
  const editor = available - (docked ? tools + divider : 0)
  const splitMin = Math.ceil(27000 / Math.max(540, editor - divider))
  return { chapterMax, chapters, toolsMax, tools, docked, editor,
    splitMin, ratio: clamp(value.split, splitMin, 100 - splitMin) }
}

export function Divider({ label, value, min, max, initial, onChange, onFinish, reverse = false, scale = 1, unit = '像素' }) {
  const drag = useRef(null)
  function update(next) { onChange(clamp(next, min, max)) }
  return <div className="writing-divider" role="separator" tabIndex={0} aria-orientation="vertical"
    aria-label={label} aria-valuemin={min} aria-valuemax={max} aria-valuenow={value} aria-valuetext={value + ' ' + unit}
    title={label + ' · 拖动调整，双击恢复'}
    onPointerDown={(event) => {
      if (event.button !== 0 || !event.isPrimary) return
      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
      drag.current = { x: event.clientX, value }
      event.currentTarget.dataset.dragging = 'true'
    }}
    onPointerMove={(event) => {
      if (drag.current && event.currentTarget.hasPointerCapture(event.pointerId)) {
        update(drag.current.value + (event.clientX - drag.current.x) * scale * (reverse ? -1 : 1))
      }
    }}
    onLostPointerCapture={(event) => {
      drag.current = null
      delete event.currentTarget.dataset.dragging
      onFinish?.()
    }}
    onDoubleClick={() => { update(initial); onFinish?.() }}
    onKeyDown={(event) => {
      const key = event.key
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(key)) return
      event.preventDefault()
      const delta = (key === 'ArrowRight' ? 1 : -1) * (reverse ? -1 : 1)
      update(key === 'Home' ? min : key === 'End' ? max : value + delta * (unit === '%' ? 2 : 12))
      onFinish?.()
    }} />
}

export function useFocusMode(beforeChange) {
  const [mode, setMode] = useState('')
  const [changing, setChanging] = useState(false)
  const state = useRef({ mode: '', changing: false, owned: false })
  const prepare = useRef(beforeChange)
  prepare.current = beforeChange

  async function exit() {
    const record = state.current
    if (!record.mode || record.changing) return
    record.changing = true
    setChanging(true)
    prepare.current(false)
    try {
      if (record.owned === 'android') await native('writingFullscreen', { enabled: false })
      if (record.owned === 'dom' && document.fullscreenElement) await document.exitFullscreen()
    } catch {
      // Escape and native Back can exit fullscreen before the button resolves.
    } finally {
      Object.assign(record, { mode: '', changing: false, owned: false })
      setMode('')
      setChanging(false)
    }
  }

  async function enter() {
    const record = state.current
    if (record.changing || record.mode) return
    record.changing = true
    setChanging(true)
    prepare.current(true)
    let next = 'window'
    try {
      if (platform === 'android') {
        await native('writingFullscreen', { enabled: true })
        record.owned = 'android'
        next = 'screen'
      } else if (document.fullscreenElement) {
        next = 'screen'
      } else if (document.fullscreenEnabled && typeof document.documentElement.requestFullscreen === 'function') {
        await document.documentElement.requestFullscreen()
        record.owned = 'dom'
        next = 'screen'
      }
    } catch {
      // Embedded previews can deny the Fullscreen API.
    } finally {
      Object.assign(record, { mode: next, changing: false })
      setMode(next)
      setChanging(false)
    }
  }

  useEffect(() => {
    function onFullscreenChange() {
      if (state.current.mode === 'screen' && platform !== 'android' && !document.fullscreenElement) void exit()
    }
    function onKey(event) {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing ||
        !state.current.mode || document.querySelector('dialog:modal')) return
      event.preventDefault()
      void exit()
    }
    function onNativeBack() { void exit() }
    document.addEventListener('fullscreenchange', onFullscreenChange)
    document.addEventListener('keydown', onKey)
    document.addEventListener('novel:exit-focus', onNativeBack)
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange)
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('novel:exit-focus', onNativeBack)
      if (state.current.owned === 'android') void native('writingFullscreen', { enabled: false }).catch(() => {})
      if (state.current.owned === 'dom' && document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    }
  }, [])
  return { mode, changing, toggle: () => mode ? exit() : enter(), exit }
}
