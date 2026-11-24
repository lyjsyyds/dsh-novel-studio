import React, { lazy, Suspense, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, Check, Focus, History, List, PanelLeft, PanelRight, Plus, Save, Search, Sparkles, Undo2, Wrench } from 'lucide-react'
import { api } from './transport.js'
import { commitChapter, compareParagraphs, loadSession, saveChapterText, saveSession } from './library.js'
import { chapterLookup } from '../../lib/story.js'
import { Drawer } from './drawer.jsx'
import { GuideButton } from './guide.jsx'
import { MemoryPane } from './memory.jsx'
import { StoryBoard } from './story-board.jsx'
import { BookDetails, Dashboard, DraftLibrary, ModelSettings, WritingDefaults } from './panels.jsx'
import { Appearance } from './theme.jsx'
import { FindReplace, RewritePassage } from './writing-tools.jsx'
import { SelectionTools } from './selection-tools.jsx'
import { ChapterOutline, revealPosition, useWritingViewport } from './writer-navigation.jsx'
import { ChapterContext, ChapterReference, DeskMenu, panelTitles, RecordReference, ReferenceCatalog } from './writer-panels.jsx'
import { CreativeSpace, spaceIcons } from './creative-spaces.jsx'
import { spaceNames } from './spaces.js'
import { Divider, divider, layoutTracks, useFocusMode, useMeasuredWidth } from './writing-layout.jsx'

const enc = encodeURIComponent
const count = (body) => (body.match(/[\u4e00-\u9fff]|[A-Za-z0-9]+/g) || []).length
const Manuscript = lazy(() => import('./manuscript.jsx'))
const deskTabs = [['context', '本章', PanelRight], ['catalog', '资料', BookOpen], ['memory', '前情', History], ['ai', 'AI', Sparkles], ['tools', '工具', Wrench]]
const isDeskTab = (key) => deskTabs.some(([id]) => id === key)
const emptyDesk = { active: '', stacks: {} }

function WritingTabs({ active, disabled, chapter, open }) {
  return <nav className="writing-toolbar" aria-label="创作工具">
    {deskTabs.map(([kind, text, Icon]) => <button key={kind} disabled={disabled || (!chapter && ['context', 'memory'].includes(kind))}
      data-on={active === kind} aria-pressed={active === kind} onClick={() => open(kind)}><Icon size={16} aria-hidden />{text}</button>)}
  </nav>
}

export function Revision({ comparison, settle }) {
  const chunks = useMemo(() => compareParagraphs(comparison.original, comparison.proposed), [comparison])
  const [skipped, setSkipped] = useState(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const selected = chunks.filter((chunk, i) => chunk.kind === 'change' && !skipped.has(i)).length
  async function apply() {
    setBusy(true)
    setError('')
    const text = chunks.map((chunk, index) => chunk.kind === 'same' ? chunk.body : skipped.has(index) ? chunk.before : chunk.after).join('')
    try {
      const updated = await commitChapter(comparison.bookId, comparison.chapter, comparison.original, text)
      settle(updated)
    } catch (failure) {
      setError(failure.message)
    } finally {
      setBusy(false)
    }
  }
  return <Drawer title="改稿对照" guideTopic="writing" onClose={() => { if (!busy) settle(false) }}>
    {chunks.every((chunk) => chunk.kind === 'same') && <p>正文一致，没有需要应用的改动。</p>}
    {chunks.map((chunk, index) => chunk.kind === 'change' && <article className="revision-hunk" key={index}>
      <label><input type="checkbox" checked={!skipped.has(index)} onChange={() => setSkipped((before) => {
        const next = new Set(before)
        if (next.has(index)) next.delete(index)
        else next.add(index)
        return next
      })} /> 采纳这段修改</label>
      <div className="revision-pair"><pre>{chunk.before || '（新增）'}</pre><pre>{chunk.after || '（删除）'}</pre></div>
    </article>)}
    {error && <p role="alert" className="notice">{error}</p>}
    <div className="actions"><button className="primary" disabled={busy || !selected} onClick={apply}>应用选中修改</button>
      <button disabled={busy} onClick={() => settle(false)}>取消</button></div>
  </Drawer>
}

export function Writer({ book, active, layout, getPane, sections, compare, registerFlush, registerTools, registerRevision,
  themeMenu, appearance, settings, onSettingsChange, onBookChanged, onOpenBook, onTransfer, hub, compareAnchor, onExpandSpace }) {
  const { AiPane, nextChapterTitle } = getPane
  const root = '/library/' + enc(book.id)
  const base = root + '/unit/chapters'
  const [chapters, setChapters] = useState([])
  const [chapter, setChapter] = useState(null)
  const [body, setBody] = useState('')
  const [note, setNote] = useState('')
  const [status, setStatus] = useState('')
  const [view, setView] = useState('write')
  const [chaptersVisible, setChaptersVisible] = useState(true)
  const [desk, setDesk] = useState(emptyDesk)
  const [showChapters, setShowChapters] = useState(false)
  const [context, setContext] = useState(null)
  const [contextError, setContextError] = useState('')
  const [volumes, setVolumes] = useState([])
  const [checkVersion, setCheckVersion] = useState(0)
  const [modelVersion, setModelVersion] = useState(0)
  const [snapshots, setSnapshots] = useState(null)
  const [creating, setCreating] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [opening, setOpening] = useState(false)
  const [composing, setComposing] = useState(false)
  const [selection, setSelection] = useState(null)
  const [paper, setPaper] = useState(() => ({ width: settings?.paperWidth || 680, gap: settings?.paragraphGap || 1.2 }))
  const [canUndo, setCanUndo] = useState(false)
  const deferredBody = useDeferredValue(body)
  const surface = useRef(null)
  const width = useMeasuredWidth(surface, active)
  const mobile = width <= 760
  const input = useRef(null)
  const selecting = useRef(null)
  const keyboardHeight = useWritingViewport(input, mobile)
  const current = useRef({ id: '', previous: '', savedInput: '', body: '', note: '', offset: 0 })
  const operation = useRef(Promise.resolve())
  const restoreAt = useRef(null)
  const returnAt = useRef(null)
  const composingRef = useRef(false)
  const pendingChapter = useRef(0)
  const toolRequest = useRef(0)
  const wasAway = useRef(false)
  const preFocusTab = useRef('')
  const initialDesk = useRef(false)
  const undo = useRef({ at: 0, items: [] })
  const panels = desk.stacks[desk.active] || []
  const panel = panels.at(-1)
  const contextOpen = Boolean(desk.stacks.context)
  const managing = panels.some(({ kind }) => kind === 'manage' || kind === 'import' || kind === 'draft-library')
  const [columns, setColumns] = layout
  const focusMode = useFocusMode((entering) => {
    rememberEditor({ focus: !mobile, reveal: true })
    toolRequest.current++
    if (entering) {
      preFocusTab.current = desk.active
      setDesk((old) => ({ ...old, active: '' }))
    } else {
      const tab = preFocusTab.current
      setDesk((old) => ({ ...old, active: old.stacks[tab]?.length ? tab : '' }))
      preFocusTab.current = ''
      setShowChapters(false)
    }
  })
  const focus = Boolean(focusMode.mode)
  const preview = !focus && view === 'read'
  const rail = !focus && !mobile && chaptersVisible
  const split = !focus && view === 'split' && width - (rail ? columns.chapters + divider : 0) >= 560
  const tracks = layoutTracks(width, columns, { rail, dock: Boolean(panel && !focus && active), split })
  const canSplit = width - (rail ? tracks.chapters + divider : 0) >= 560
  const docked = tracks.docked

  useEffect(() => {
    if (!active || !width || !chapter || initialDesk.current) return
    initialDesk.current = true
    if (width >= 900 && !focus) setDesk((old) => old === emptyDesk
      ? { active: 'context', stacks: { context: [{ kind: 'context' }] } } : old)
  }, [active, width, chapter, focus])

  function rememberEditor(extra = {}) {
    const record = current.current
    const editor = input.current
    restoreAt.current = { from: editor?.selectionStart ?? record.offset, to: editor?.selectionEnd ?? record.end,
      scroll: editor?.scrollTop ?? record.scroll, ...extra }
  }

  const flush = useCallback(() => {
    const job = operation.current.catch(() => {}).then(async () => {
      if (composingRef.current) return false
      const record = current.current
      if (!record.id) return true
      try {
        if (record.body !== record.savedInput) {
          const text = record.body
          setStatus('保存中')
          const result = await saveChapterText(book.id, record.id, record.previous, text)
          record.previous = result.body
          record.savedInput = text
          setStatus(record.body === text ? '已保存' : '待保存')
        }
        const session = { chapter: record.id, offset: record.offset, scroll: record.scroll || 0, note: record.note }
        if (JSON.stringify(session) !== record.savedSession) {
          await saveSession(book.id, session)
          record.savedSession = JSON.stringify(session)
        }
        return true
      } catch (error) {
        setStatus(error.message)
        return false
      }
    })
    operation.current = job
    return job
  }, [book.id])

  const open = useCallback(async (id, offset = 0, handoff = '', scroll = 0, { end, keepTools, skipFlush, select } = {}) => {
    if (composingRef.current) return
    const request = ++pendingChapter.current
    setOpening(true)
    setStatus('读取中')
    try {
      if ((!skipFlush && !await flush()) || request !== pendingChapter.current) return
      const { data } = await api('GET', base + '/' + enc(id))
      if (request !== pendingChapter.current) return
      if (skipFlush && current.current.body !== current.current.savedInput) {
        setStatus('章节已变更。请先复制当前未保存的正文，再重新打开章节。')
        return
      }
      const text = data.body || ''
      const from = Math.min(offset || 0, text.length)
      const to = Math.min(end ?? from, text.length)
      restoreAt.current = { from, to, scroll, focus: select, reveal: select }
      current.current = { id, previous: text, savedInput: text, body: text, note: handoff, scroll, offset: from }
      undo.current = { at: 0, items: [] }
      setCanUndo(false)
      setSelection(null)
      setChapter({ ...data, id })
      setBody(text)
      setNote(handoff)
      setShowChapters(false)
      if (!keepTools) {
        setDesk((value) => {
          if (!value.active) return value
          const active = isDeskTab(value.active) ? value.active : 'context'
          return { active, stacks: { [active]: [{ kind: active }] } }
        })
        returnAt.current = null
      }
      setStatus('已保存')
      void flush()
    } catch (error) {
      setStatus(error.message)
    } finally {
      if (request === pendingChapter.current) setOpening(false)
    }
  }, [base, flush])

  const reload = useCallback(async () => {
    const [{ items }, outline] = await Promise.all([
      api('GET', base), api('GET', root + '/unit/outline/tree').catch(() => ({ items: [] })),
    ])
    setChapters(items)
    setVolumes(outline.items || [])
    return items
  }, [base, root])

  useEffect(() => {
    let active = true
    Promise.all([reload(), loadSession(book.id)]).then(([items, session]) => {
      if (!active) return
      const id = session.chapter
      const selected = items.find((item) => item.id === id) || items.at(-1)
      if (selected) void open(selected.id, selected.id === session.chapter ? session.offset : 0, session.note || '',
        selected.id === session.chapter ? session.scroll : 0)
    }).catch((error) => setStatus(error.message))
    return () => { active = false }
  }, [book.id, reload, open])

  useEffect(() => {
    registerFlush(flush)
    function saveHidden() { if (document.visibilityState === 'hidden') void flush() }
    document.addEventListener('visibilitychange', saveHidden)
    return () => { registerFlush(null); document.removeEventListener('visibilitychange', saveHidden) }
  }, [flush, registerFlush])

  useEffect(() => {
    if (active && restoreAt.current !== null && input.current) {
      const { from, to, scroll, focus: shouldFocus, reveal } = restoreAt.current
      if (shouldFocus) input.current.focus({ preventScroll: true })
      input.current.setSelectionRange(from, to ?? from)
      if (scroll != null) input.current.scrollTop = scroll
      if (reveal) revealPosition(input.current, from)
      restoreAt.current = null
    }
  }, [active, chapter, body, view, panel, showChapters, focus, docked])

  useEffect(() => {
    if (settings?.autosave === false || composing || opening) return
    const timer = setTimeout(flush, 650)
    return () => clearTimeout(timer)
  }, [body, note, flush, settings?.autosave, composing, opening])

  const chapterId = chapter?.id
  useEffect(() => {
    if (!chapterId || !contextOpen) return
    let active = true
    setContext(null)
    setContextError('')
    Promise.all([
      api('GET', root + '/graph'), api('GET', root + '/validate'),
      api('GET', root + '/unit/outline/foreshadowing'), api('GET', root + '/unit/outline/scenes'),
    ]).then(([graph, validation, foreshadowing, scenes]) => {
      if (!active) return
      const resolve = chapterLookup(chapters)
      const linked = (ref) => Boolean(ref && (ref === chapterId || resolve(ref)?.id === chapterId))
      const threads = foreshadowing.items.flatMap((item, index) =>
        [item.planted, item.plantedChapter, item.payoff, item.due].some(linked) ? [{ ...item, index }] : [])
      const issues = (validation.issues || []).filter(({ id, ref, chapter, location }) => {
        const entry = ref || location || {}
        return [id, entry.id, entry.chapter, chapter].includes(chapterId)
      })
      setContext({ nodes: graph.nodes, issues, threads, scenes: scenes.items.filter(({ chapter }) => linked(chapter)) })
    }).catch((error) => { if (active) setContextError(error.message) })
    return () => { active = false }
  }, [chapterId, contextOpen, root, checkVersion, chapters])

  async function create(event) {
    event.preventDefault()
    if (!newTitle.trim() || !await flush()) return
    try {
      const { id } = await api('POST', base, { title: newTitle.trim(), body: '' })
      setCreating(false)
      await reload()
      await open(id)
    } catch (error) {
      setStatus(error.message)
    }
  }

  async function snapshot() {
    if (!await flush()) return
    try {
      await api('POST', root + '/drafts', { chapter: chapter.id, note: '手动快照' })
      setSnapshots((await api('GET', root + '/drafts')).drafts || [])
    } catch (error) { setStatus(error.message) }
  }

  async function compareDraft(id) {
    try {
      const draft = await api('GET', root + '/drafts/' + enc(id))
      if (draft.chapter !== chapter.id) return
      await doCompare(book.id, chapter.id, current.current.previous, draft.body)
    } catch (error) { setStatus(error.message) }
  }

  const applyRevision = useCallback((id, original, updated) => {
    const record = current.current
    if (record.id !== id) return
    if (record.previous !== original || record.body !== record.savedInput) {
      setStatus('磁盘上的正文已更新。当前编辑已保留，请核对改动后重新打开。')
      return
    }
    undo.current.items = [...undo.current.items.slice(-29), { text: record.body, offset: record.offset }]
    undo.current.at = 0
    setCanUndo(true)
    record.previous = record.savedInput = record.body = updated.body
    const from = Math.min(record.offset, updated.body.length)
    record.offset = record.end = from
    restoreAt.current = { from, scroll: record.scroll, reveal: true }
    setBody(updated.body)
    setChapter({ ...updated, id })
    setSelection(null)
    setStatus('已保存')
  }, [])

  useEffect(() => {
    registerRevision(applyRevision)
    return () => registerRevision(null)
  }, [applyRevision, registerRevision])

  const doCompare = async (bookId, id, original, proposed) => {
    if (!await flush()) return false
    const updated = await compare({ bookId, chapter: id, original, proposed })
    if (updated && bookId === book.id) applyRevision(id, original, updated)
    return Boolean(updated)
  }

  const recordSelection = useCallback((element, anchor) => {
    const { selectionStart: start, selectionEnd: end } = element
    current.current.offset = start
    current.current.end = end
    if (selecting.current !== null || composingRef.current) return
    const text = element.value.slice(start, end)
    const id = current.current.id
    const edge = element.selectionDirection === 'backward' ? start : end
    setSelection((before) => {
      if (!text) return null
      if (!anchor && before?.id === id && before.start === start && before.end === end && before.text === text) return before
      return { id, start, end, text, edge, anchor }
    })
  }, [])

  useEffect(() => {
    function finish(event) {
      if (selecting.current !== event.pointerId) return
      selecting.current = null
      const editor = input.current
      if (!editor || event.type === 'pointercancel') return
      const rect = editor.getBoundingClientRect()
      const anchor = event.pointerType === 'touch' ? undefined
        : { x: event.clientX - rect.left, y: event.clientY - rect.top, scroll: editor.scrollTop }
      recordSelection(editor, anchor)
    }
    function reset() { selecting.current = null }
    document.addEventListener('pointerup', finish, true)
    document.addEventListener('pointercancel', finish, true)
    window.addEventListener('blur', reset)
    return () => {
      document.removeEventListener('pointerup', finish, true)
      document.removeEventListener('pointercancel', finish, true)
      window.removeEventListener('blur', reset)
    }
  }, [recordSelection])

  const dismissSelection = useCallback((returnFocus) => {
    const editor = input.current
    if (returnFocus && editor) {
      editor.focus({ preventScroll: true })
      editor.setSelectionRange(editor.selectionEnd, editor.selectionEnd)
      recordSelection(editor)
    }
    setSelection(null)
  }, [recordSelection])

  function edit(element) {
    const record = current.current
    const now = Date.now()
    if (record.body !== element.value && now - undo.current.at > 850) {
      undo.current.items = [...undo.current.items.slice(-29), { text: record.body, offset: record.offset }]
      setCanUndo(true)
    }
    undo.current.at = now
    record.body = element.value
    recordSelection(element)
    setStatus('待保存')
    setBody(element.value)
  }

  function undoEdit() {
    if (composingRef.current) return
    const previous = undo.current.items.pop()
    if (!previous) return
    undo.current.at = 0
    current.current.body = previous.text
    current.current.offset = current.current.end = previous.offset
    restoreAt.current = { from: previous.offset, focus: true }
    dismissSelection(false)
    setCanUndo(undo.current.items.length > 0)
    setBody(previous.text)
    setStatus('待保存')
  }

  function replaceSelected(range, replacement) {
    const record = current.current
    const editor = input.current
    if (!editor || editor.readOnly || composingRef.current || range.id !== record.id
      || record.body.slice(range.start, range.end) !== range.text) return
    undo.current.items = [...undo.current.items.slice(-29), { text: record.body, offset: range.start }]
    undo.current.at = 0
    const next = record.body.slice(0, range.start) + replacement + record.body.slice(range.end)
    const caret = range.start + replacement.length
    record.body = next
    record.offset = record.end = caret
    restoreAt.current = { from: caret, scroll: editor.scrollTop, focus: !mobile || document.activeElement === editor }
    setSelection(null)
    setCanUndo(true)
    setBody(next)
    setStatus('待保存')
  }

  async function saveSelected(range) {
    const title = chapter.title?.replace(/[<>:"/\\|?*.]/g, '').trim().slice(0, 42) || '章节'
    const name = title + '-选段-' + crypto.randomUUID().slice(0, 8) + '.md'
    await api('PUT', root + '/unit/materials/' + enc(name), { text: range.text })
  }

  const rememberCaret = useCallback(() => {
    if (returnAt.current) return
    const editor = input.current
    returnAt.current = { focus: !mobile || Boolean(keyboardHeight) }
    if (!editor) return
    Object.assign(current.current, { offset: editor.selectionStart, end: editor.selectionEnd, scroll: editor.scrollTop })
  }, [keyboardHeight, mobile])

  const showTool = useCallback(async (kind, { push = false, findCommand = false, selectionRange, ...details } = {}) => {
    if (composingRef.current) return
    const request = ++toolRequest.current
    const record = current.current
    const editor = input.current
    if (selectionRange && (record.id !== selectionRange.id || record.body.slice(selectionRange.start, selectionRange.end) !== selectionRange.text)) return
    const start = selectionRange?.start ?? editor?.selectionStart ?? record.offset
    const end = selectionRange?.end ?? editor?.selectionEnd ?? start
    const text = editor && editor.value.slice(start, end)
    const query = text?.trim().split('\n')[0].slice(0, 80) || ''
    const chapterTools = ['find', 'rewrite', 'drafts', 'memory', 'context']
    if (!record.id && chapterTools.includes(kind)) return
    rememberCaret()
    if (['ai', 'memory', 'scene-memory', 'find', 'rewrite', 'drafts', 'manage', 'import', 'export', 'draft-library', 'validate'].includes(kind)
      && !await flush()) return
    if (record !== current.current || request !== toolRequest.current) return
    if (kind === 'rewrite' && (!text || record.previous.slice(start, end) !== text)) {
      setStatus('正文已变化，请重新选段。')
      return
    }
    const tool = { kind, id: record.id, query, original: record.previous, start, end, text, ...details }
    if (kind === 'drafts') setSnapshots(null)
    setShowChapters(false)
    setDesk((old) => {
      if (findCommand) return { active: 'command', stacks: { ...old.stacks, command: [{ kind: 'tools', focusRequest: Date.now() }] } }
      if (kind === 'overview') return { active: 'overview', stacks: { ...old.stacks, overview: [tool] } }
      if (kind === 'space') {
        const active = 'space:' + details.space
        const previous = old.stacks[active]
        return { active, stacks: { ...old.stacks, [active]: !details.entry && previous ? previous : [tool] } }
      }
      if (!push && isDeskTab(kind)) {
        const previous = old.stacks[kind]
        if (old.active === kind && previous) return old
        const next = previous || [tool]
        return { active: kind, stacks: { ...old.stacks, [kind]: next } }
      }
      const active = push && old.active ? old.active : 'tools'
      const previous = push ? old.stacks[active] : null
      return { active, stacks: { ...old.stacks, [active]: [...(previous || [{ kind: active }]), tool] } }
    })
    return true
  }, [flush, rememberCaret])

  function openSelectionTool(kind, range) {
    dismissSelection(false)
    void showTool(kind, { selectionRange: range })
  }

  async function transferSelection(kind, range) {
    if (composingRef.current) return
    const record = current.current
    if (range.id !== record.id || record.body.slice(range.start, range.end) !== range.text) return
    rememberCaret()
    if (!await flush()) throw new Error('请先保存当前章节，再传送选段。')
    if (record !== current.current || record.body.slice(range.start, range.end) !== range.text) {
      throw new Error('正文选段已变化，请重新选段。')
    }
    const entry = await onTransfer(kind, { chapter: range.id, start: range.start, text: range.text,
      before: record.body.slice(Math.max(0, range.start - 24), range.start), after: record.body.slice(range.end, range.end + 24) },
      chapter.title || range.id)
    dismissSelection(false)
    await showTool('space', { space: kind, entry })
  }

  useEffect(() => {
    registerTools(showTool)
    return () => registerTools(null)
  }, [registerTools, showTool])

  useEffect(() => {
    function onShortcut(event) {
      if (active && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && !event.isComposing && !composingRef.current
        && !document.querySelector('dialog:modal:not(.writing-dock)')) {
        event.preventDefault()
        void showTool('tools', { findCommand: true })
      }
    }
    document.addEventListener('keydown', onShortcut)
    return () => document.removeEventListener('keydown', onShortcut)
  }, [active, showTool])

  useEffect(() => {
    if (panel?.kind !== 'drafts') return
    let active = true
    api('GET', root + '/drafts').then((value) => { if (active) setSnapshots(value.drafts || []) })
      .catch((error) => { if (active) { setStatus(error.message); setSnapshots([]) } })
    return () => { active = false }
  }, [panel, root])

  function closeTools() {
    toolRequest.current++
    const { id, offset, end, scroll } = current.current
    if (id) restoreAt.current = { from: offset, to: end, scroll, focus: returnAt.current?.focus ?? !mobile, reveal: true }
    returnAt.current = null
    setShowChapters(false)
    setDesk((old) => ({ ...old, active: '' }))
  }

  useEffect(() => {
    if (!active) { wasAway.current = true; return }
    if (!wasAway.current) return
    wasAway.current = false
    if (returnAt.current || panel || showChapters) closeTools()
    else {
      const record = current.current
      rememberEditor({ from: record.offset, to: record.end, scroll: record.scroll, focus: !mobile, reveal: true })
      const editor = input.current
      if (editor) {
        const { from, to, focus: shouldFocus, scroll } = restoreAt.current
        if (shouldFocus) editor.focus({ preventScroll: true })
        editor.setSelectionRange(from, to ?? from)
        editor.scrollTop = scroll || 0
        revealPosition(editor, from)
        restoreAt.current = null
      }
    }
  }, [active])

  function showCreate() {
    rememberCaret()
    setNewTitle(nextChapterTitle(chapters))
    setCreating(true)
    setShowChapters(false)
  }

  function openReference(section, group, id, hit) {
    if (section === 'write' || section === 'chapters') return showTool('chapter-reference', { push: true, id, line: hit?.line })
    if (section === 'memory') return showTool('scene-memory', { push: true, id })
    if (panelTitles[section]) return showTool(section, { push: true })
    return showTool(id == null ? 'unit' : 'record', { push: true, section, group, id })
  }

  async function unitChanged(section, group, moves) {
    if (section === 'outline' && group === 'tree') await reload()
    setCheckVersion((value) => value + 1)
    if (section !== 'chapters') return
    const record = current.current
    const items = await reload()
    const replacement = moves?.find(({ from }) => from === record.id)?.to || record.id
    const next = items.find(({ id }) => id === replacement) || items.at(-1)
    if (next) await open(next.id, record.offset, record.note, record.scroll, { keepTools: true, skipFlush: true })
    else if (current.current.body === current.current.savedInput) {
      current.current = { id: '', previous: '', savedInput: '', body: '', note: '', offset: 0 }
      setChapter(null)
      setBody('')
      setNote('')
    }
  }

  function jump(from, to) {
    if (docked && input.current) {
      const editor = input.current
      editor.focus({ preventScroll: true })
      editor.setSelectionRange(from, to)
      revealPosition(editor, from)
      recordSelection(editor)
      return
    }
    if (!docked) closeTools()
    restoreAt.current = { from, to, focus: true, reveal: true }
    setView('write')
  }

  function afterRevision() {
    if (!docked) { closeTools(); return }
    const { offset, scroll } = current.current
    restoreAt.current = { from: offset, scroll, focus: true }
    setDesk((old) => ({ ...old, stacks: { ...old.stacks, [old.active]: old.stacks[old.active].slice(0, -1) } }))
  }

  const chapterOutline = <ChapterOutline chapters={chapters} volumes={volumes} current={chapterId}
    onOpen={(id) => { if (id !== chapterId) void open(id); else if (showChapters) closeTools() }} onCreate={showCreate}
    onManage={() => showTool('manage')} onDrafts={() => showTool('draft-library')} />

  function toolTitle(tool) {
    if (tool.kind === 'space') return spaceNames[tool.space]
    if (tool.kind !== 'unit' && tool.kind !== 'record') return panelTitles[tool.kind]
    const section = sections.find(({ key }) => key === tool.section)
    return section?.groups?.find(({ key }) => key === tool.group)?.zh || section?.zh || '设定'
  }

  function renderTool(tool) {
    const go = openReference
    switch (tool.kind) {
      case 'tools': return <><DeskMenu open={(kind) => showTool(kind, { push: true })} disabled={!chapter}
        focusRequest={active && tool === panel ? tool.focusRequest : undefined} />
        <section className="working-spaces-menu"><h3>创作板块</h3><div className="actions">
          {Object.entries(spaceNames).map(([kind, name]) => {
            const Icon = spaceIcons[kind]
            return <button key={kind} onClick={() => showTool('space', { space: kind })}><Icon size={16} />{name}</button>
          })}
        </div></section></>
      case 'space': return <CreativeSpace key={tool.space + ':' + (tool.entry || '')} kind={tool.space} hub={hub} initialId={tool.entry} compare={compareAnchor}
        onFork={(id) => showTool('space', { space: 'paths', entry: id, push: true })}
        onModelSettings={() => showTool('ai-settings', { push: true })} onExpand={async (kind, id) => {
          if (focus) await focusMode.exit()
          await onExpandSpace(kind, id)
        }} />
      case 'overview': return <Dashboard book={book} go={(kind) => kind === 'write' ? closeTools() : go(kind)} />
      case 'context': return chapter && <ChapterContext data={context} error={contextError} chapter={chapter} body={deferredBody}
        onGo={go} note={note} onNote={(value) => { current.current.note = value; setNote(value) }}
        onCheck={async () => { if (await flush()) setCheckVersion((value) => value + 1) }} />
      case 'catalog': return <ReferenceCatalog sections={sections} go={go} />
      case 'ai': return <>
        <button className="text-button tool-settings-link" onClick={() => showTool('ai-settings', { push: true })}>AI 模型设置</button>
        <AiPane key={chapterId} book={book} initialChapter={chapterId} defaultInstruction={settings?.writingInstruction}
          active={tool === panel} catalogVersion={modelVersion} onPrepare={flush}
          onCompare={(id, original, proposed) => doCompare(book.id, id, original, proposed)} onCommitted={reload} />
      </>
      case 'memory': case 'scene-memory': {
        const initialKey = tool.kind === 'memory' && chapterId ? 'chapter:' + chapterId : 'scene:' + tool.id
        return <MemoryPane key={initialKey} book={book} initialKey={initialKey} active={tool === panel} compact />
      }
      case 'search': return <getPane.SearchPane book={book} sections={sections} initialQuery={tool.query}
        onOpen={(section, id, group, hit) => go(section, group, id, hit)} />
      case 'chapter-reference': return <ChapterReference book={book} id={tool.id} line={tool.line}
        localBody={tool.id === chapterId ? deferredBody : undefined} onOpen={(id, from, to) => {
          if (id === chapterId) jump(from, to)
          else { setView('write'); void open(id, from, '', 0, { end: to, select: true }) }
        }} />
      case 'story': return <StoryBoard book={book} go={go} compact onChanged={() => setCheckVersion((value) => value + 1)} />
      case 'graph': return <getPane.GraphPane book={book} />
      case 'shared': return <getPane.SharedPane book={book} onCreated={onOpenBook} />
      case 'calendar': return <getPane.CalendarNote book={book} />
      case 'validate': return <getPane.ValidatePane book={book} />
      case 'progress': return <getPane.ProgressPane book={book} />
      case 'import': return <getPane.ImportPane book={book} onImported={() => unitChanged('chapters')} />
      case 'export': return <getPane.ExportPane book={book} />
      case 'ai-settings': return <ModelSettings active={tool === panel} onConfigured={() => setModelVersion((value) => value + 1)} />
      case 'appearance': return <Appearance {...appearance} active={tool === panel}
        sample={chapter && { title: chapter.title, body: deferredBody.trim().slice(0, 140) }} />
      case 'book-settings': return <>
        <BookDetails book={book} onSaved={onBookChanged} />
        <WritingDefaults book={book} settings={settings} onSaved={onSettingsChange} />
        <getPane.SettingsPane book={book} settings={settings} onChange={onSettingsChange} />
      </>
      case 'draft-library': return <DraftLibrary book={book} go={go} compare={({ bookId, chapter: id, original, proposed }) =>
        doCompare(bookId, id, original, proposed)} />
      case 'drafts': return <>
        <button className="primary" onClick={snapshot}>保存当前快照</button>
        <button className="text-button tool-settings-link" onClick={() => showTool('draft-library', { push: true })}>查看全部草稿</button>
        {snapshots === null && <p role="status" className="muted">正在读取快照…</p>}
        {snapshots && <ul className="context-list">{snapshots.filter((item) => item.chapter === chapterId).map((item) =>
          <li key={item.id}><button onClick={() => compareDraft(item.id)}>{item.note || '章节快照'} · {new Date(item.at).toLocaleString('zh-CN')}</button></li>)}</ul>}
      </>
      case 'find': return <FindReplace original={tool.id === chapterId ? body : tool.original} initialQuery={tool.query} onJump={jump}
        onCompare={async (original, proposed) => { if (await doCompare(book.id, tool.id, original, proposed)) afterRevision() }} />
      case 'rewrite': return <RewritePassage book={book} text={tool.text} onCompare={(proposed) =>
        doCompare(book.id, tool.id, tool.original, tool.original.slice(0, tool.start) + proposed + tool.original.slice(tool.end))
          .then((applied) => { if (applied) afterRevision() })} />
      case 'paper': return <form className="form-stack" onSubmit={async (event) => {
        event.preventDefault()
        try {
          const result = await api('PATCH', root + '/settings', { paperWidth: paper.width, paragraphGap: paper.gap })
          onSettingsChange(result.settings)
          closeTools()
        } catch (error) { setStatus(error.message) }
      }}>
        <label>纸面宽度 · {paper.width} px<input type="range" min="460" max="920" step="20" value={paper.width}
          onChange={(e) => setPaper({ ...paper, width: Number(e.target.value) })} /></label>
        <label>段间距 · {paper.gap} em<input type="range" min="0.5" max="2" step="0.1" value={paper.gap}
          onChange={(e) => setPaper({ ...paper, gap: Number(e.target.value) })} /></label>
        <button className="primary">保存排版</button>
      </form>
      case 'manage': case 'unit': case 'record': {
        const section = sections.find(({ key }) => key === (tool.kind === 'manage' ? 'chapters' : tool.section))
        if (!section) return <p className="muted">未找到此设定分类。</p>
        const group = section.groups?.find(({ key }) => key === tool.group) || section.groups?.[0]
        if (tool.kind === 'record') return <RecordReference key={checkVersion} book={book} section={section} group={group} id={tool.id}
          onOpenChapter={(id) => go('write', undefined, id)}
          onEdit={() => showTool('unit', { push: true, section: section.key, group: group?.key, id: tool.id })} />
        return <getPane.UnitPane book={book} section={section} group={group}
          focus={tool.kind === 'unit' && tool.id ? { section: section.key, id: tool.id } : undefined}
          settings={section.key === 'chapters' ? { ...settings, autosave: false } : settings}
          onOpenChapter={(id) => go('write', undefined, id)} onUnitChanged={(moves) => unitChanged(section.key, group?.key, moves)} />
      }
    }
  }

  function reflowEditor() {
    requestAnimationFrame(() => {
      const editor = input.current
      if (editor) revealPosition(editor, editor.selectionDirection === 'backward' ? editor.selectionStart : editor.selectionEnd)
    })
  }

  return <section ref={surface} className="writing-view" data-focus={active && focus} data-rail={rail} data-dock={docked}
    data-keyboard={active && Boolean(keyboardHeight)}
    style={{ '--paper-width': focus || columns.fill ? '100%' : paper.width + 'px', '--paragraph-gap': paper.gap + 'em',
      '--chapter-track': tracks.chapters + 'px', '--tool-track': tracks.tools + 'px',
      '--split-track': Math.round((tracks.editor - divider) * tracks.ratio / 100) + 'px',
      ...(keyboardHeight ? { '--writing-viewport': keyboardHeight + 'px' } : {}),
      ...(settings?.fontSize ? { '--manuscript-size': settings.fontSize + 'px' } : {}) }}>
    <aside className="chapter-rail" aria-label="章节目录" hidden={!rail}>{chapterOutline}</aside>
    {rail && <Divider label="调整章节目录宽度" value={tracks.chapters} min={144} max={tracks.chapterMax} initial={200}
      onChange={(n) => setColumns('chapters', n)} onFinish={reflowEditor} />}
    <div className="studio-editor">
      <div className="editor-toolbar">
        {focus || mobile
          ? <button disabled={composing} onClick={() => { rememberCaret(); setShowChapters(true) }}><List size={17} />章节</button>
          : <button className="icon-button" aria-label={rail ? '收起章节目录' : '展开章节目录'}
            title={rail ? '收起章节目录' : '展开章节目录'} disabled={composing}
            onClick={() => { setChaptersVisible(!rail); reflowEditor() }}><PanelLeft size={17} /></button>}
        {!focus && <div className="segments" role="group" aria-label="正文显示方式">
          <button disabled={composing} data-on={!preview && !split} aria-pressed={!preview && !split} onClick={() => { if (preview) restoreAt.current = { from: current.current.offset, scroll: current.current.scroll }; setView('write') }}>正文</button>
          <button disabled={composing} data-on={preview} aria-pressed={preview} onClick={() => setView('read')}>预览</button>
          {canSplit && <button disabled={composing} data-on={split} aria-pressed={split} onClick={() => {
            if (preview) restoreAt.current = { from: current.current.offset, to: current.current.end, scroll: current.current.scroll }
            setView('split')
          }}>分屏</button>}</div>}
        <div className="editor-toolbar-right">
          {focus && <><GuideButton />{themeMenu}</>}
          {!focus && !mobile && <button aria-label="填满纸面" title={columns.fill ? '恢复固定版心' : '填满可用宽度'}
            aria-pressed={columns.fill} onClick={() => { setColumns('fill', !columns.fill); reflowEditor() }}>{columns.fill ? '固定版心' : '填满'}</button>}
          {focus && <span className="focus-indicator" aria-live="polite">{focusMode.mode === 'screen' ? '全屏' : '窗口专注'}</span>}
          <button aria-label={focus ? '退出专注' : '专注模式'} title={focus ? '退出专注' : '专注模式'}
            disabled={composing || focusMode.changing} onClick={focusMode.toggle}><Focus size={17} /><span>{focus ? '退出专注' : '专注模式'}</span></button>
        </div>
      </div>
      {chapter ? <>
        <div className="editor-document" data-split={split}>
          <header className="manuscript-heading"><h1>{chapter.title || chapter.id}</h1></header>
          <div className="paper-grid" data-split={split}>
            <div className="paper">
              <div className="paper-inner">
                {split && <div className="paper-view-label">正文</div>}
                {preview ? <Suspense fallback={<p>正在排版…</p>}><Manuscript body={deferredBody} /></Suspense>
                  : <textarea aria-label="章节正文" spellCheck="false" ref={input} readOnly={opening || managing}
                    value={body} onSelect={(event) => recordSelection(event.target)}
                    onPointerDown={(event) => {
                      if (!event.isPrimary || event.button !== 0) return
                      selecting.current = event.pointerId
                      setSelection(null)
                    }}
                    onScroll={(event) => { current.current.scroll = event.target.scrollTop }}
                    onCompositionStart={() => { composingRef.current = true; setComposing(true); setSelection(null) }}
                    onCompositionEnd={(event) => {
                      composingRef.current = false
                      setComposing(false)
                      edit(event.currentTarget)
                    }}
                    onKeyDown={(event) => {
                      if (composingRef.current || event.nativeEvent.isComposing) return
                      if (event.key === 'Escape' && selection) { event.preventDefault(); dismissSelection(true); return }
                      if (!(event.ctrlKey || event.metaKey)) return
                      if (event.key.toLowerCase() === 's') { event.preventDefault(); void flush() }
                      if (event.key.toLowerCase() === 'f') { event.preventDefault(); void showTool(event.shiftKey ? 'search' : 'find') }
                    }}
                    onBlur={() => { if (settings?.autosave !== false) void flush() }} onChange={(event) => edit(event.target)} />}
              </div>
            </div>
            {split && <Divider label="调整正文与预览比例" value={tracks.ratio} min={tracks.splitMin}
              max={100 - tracks.splitMin} initial={50} unit="%" scale={100 / (tracks.editor - divider)}
              onChange={(n) => setColumns('split', n)} onFinish={reflowEditor} />}
            {split && <div className="paper split-preview" aria-label="排版预览">
              <div className="paper-inner"><div className="paper-view-label">预览</div>
                <Suspense fallback={<p>正在排版…</p>}><Manuscript body={deferredBody} /></Suspense></div></div>}
          </div>
          {selection && selection.id === chapterId && !preview && !composing && !opening && !managing && (!panel || docked)
            && <SelectionTools key={selection.start + ':' + selection.end} editorRef={input} selection={selection}
              onDismiss={dismissSelection} onOpen={openSelectionTool} onReplace={replaceSelected} onSave={saveSelected}
              onTransfer={transferSelection} />}
        </div>
        <footer className="editor-footer">
          <div className="editor-footer-status">
            <span>{count(body).toLocaleString('zh-CN')} 字</span>
            <span className="editor-status" data-error={Boolean(status && !['已保存', '待保存', '保存中', '读取中'].includes(status))}
              role="status">{status === '已保存' && <Check size={14} aria-hidden />}{status}</span>
          </div>
          <div className="editor-footer-actions">
            <button disabled={composing} className="icon-button" aria-label="保存正文" title="保存正文" onClick={flush}><Save size={17} /></button>
            <button disabled={composing || !canUndo || managing} className="icon-button" aria-label="撤销最近编辑" onClick={undoEdit}><Undo2 size={17} /></button>
            <button disabled={composing} className="icon-button find-shortcut" aria-label="本章查找替换" title="本章查找替换" onClick={() => showTool('find')}><Search size={17} /></button>
            {!panel && <WritingTabs active={desk.active} disabled={composing} chapter={chapter} open={showTool} />}
          </div>
        </footer>
      </> : <div className="workspace-empty"><BookOpen size={38} /><h2>写下第一章</h2>
        <div className="actions"><button className="primary" onClick={showCreate}><Plus size={17} /> 新建章节</button>
          {!docked && <button onClick={() => showTool('tools')}>写作工具</button>}</div></div>}
    </div>
    {docked && <Divider label="调整工具区宽度" value={tracks.tools} min={280} max={tracks.toolsMax} initial={360} reverse
      onChange={(n) => setColumns('tools', n)} onFinish={reflowEditor} />}
    {creating && <Drawer title="新建章节" guideTopic="writing" visible={active} onClose={() => { setCreating(false); closeTools() }}>
      <form className="form-stack" onSubmit={create}>
        <label>章节标题<input autoFocus required value={newTitle} onChange={(event) => setNewTitle(event.target.value)} /></label>
        <button className="primary" type="submit" disabled={!newTitle.trim()}>创建章节</button>
      </form>
    </Drawer>}
    {showChapters && <Drawer title="切换章节" guideTopic="writing" visible={active} onClose={closeTools}>{chapterOutline}</Drawer>}
    {Object.keys(desk.stacks).length > 0 && <Drawer title={panel ? toolTitle(panel) : '创作工具'} onClose={closeTools}
      navigationKey={panel} docked={docked} visible={active && Boolean(panel)}
      className={'writing-dock' + (!docked && width < 900 ? ' writing-sheet' : '')}
      guideTopic={panel?.kind === 'space' ? 'spaces' : ['context', 'catalog', 'memory'].includes(desk.active) ? 'reference'
        : ['ai', 'ai-settings'].includes(panel?.kind) ? 'ai'
          : ['import', 'export'].includes(panel?.kind) ? 'transfer'
            : panel?.kind === 'appearance' ? 'appearance' : 'writing'}
      tabs={panel && <WritingTabs active={desk.active} disabled={composing} chapter={chapter} open={showTool} />}
      onBack={panels.length > 1 ? () => {
        toolRequest.current++
        setDesk((old) => ({ ...old, stacks: { ...old.stacks, [old.active]: old.stacks[old.active].slice(0, -1) } }))
      } : undefined}>
      {Object.entries(desk.stacks).map(([tab, items]) => items.map((item, index) => <div
        key={[tab, index, item.kind, item.id, item.start, item.end, item.query, item.entry].join(':')} hidden={item !== panel} className="writer-tool-page">
        {renderTool(item)}
      </div>))}
    </Drawer>}
  </section>
}
