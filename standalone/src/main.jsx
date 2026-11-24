import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BookMarked, ChartNoAxesColumn, PenLine, Search, SlidersHorizontal } from 'lucide-react'
import { api, fetchLocal, loadModel } from './transport.js'
import { native, platform } from './platform.js'
import { recoverInterruptedRestore, saveText } from './library.js'
import { readFile, writeFile } from './files.js'
import { Appearance, ThemeMenu, useTheme } from './theme.jsx'
import { Bookshelf, Backup, ModelSettings } from './panels.jsx'
import { Drawer } from './drawer.jsx'
import { GuideButton, GuideContents, GuideContext } from './guide.jsx'
import { Revision, Writer } from './writer.jsx'
import { CharacterMemory, MemoryPicker } from './memory.jsx'
import { createItem, spaceNames, useSpaces } from './spaces.js'
import { CreativeSpace, spaceIcons } from './creative-spaces.jsx'
import { useWritingLayout } from './writing-layout.jsx'
import './styles.css'

let ui
window.__ModuleLoader__ = { load({ factory }) {
  ui = factory((name) => { if (name === 'react') return React; throw new Error('Unknown UI module: ' + name) })
    .standalone({ fetch: fetchLocal, saveText, external: (url) => native('external', { url }), MemoryPicker, CharacterMemory })
} }
await import('../../lib/client.js')
delete window.__ModuleLoader__

const lastBookFile = '/settings/recent-book.json'
const libraryPanels = { menu: '书库管理', backup: '备份与恢复', appearance: '页面配色', model: 'AI 模型设置' }

function App() {
  const appearance = useTheme()
  const writingLayout = useWritingLayout()
  const flushLayout = writingLayout[2]
  const [books, setBooks] = useState([])
  const [sections, setSections] = useState([])
  const [workspace, setWorkspace] = useState(null)
  const [section, setSection] = useState('shelf')
  const [focusedId, setFocusedId] = useState(null)
  const [recent, setRecent] = useState(null)
  const [libraryPanel, setLibraryPanel] = useState('')
  const [guide, setGuide] = useState('')
  const [error, setError] = useState('')
  const [comparison, setComparison] = useState(null)
  const [pending, setPending] = useState(true)
  const writerFlush = useRef(null)
  const writerTools = useRef(null)
  const writerRevision = useRef(null)
  const currentWorkspace = useRef(null)
  currentWorkspace.current = workspace
  const pendingBook = useRef(0)
  const flushRef = useCallback((flush) => { writerFlush.current = flush }, [])
  const toolsRef = useCallback((open) => { writerTools.current = open }, [])
  const revisionRef = useCallback((apply) => { writerRevision.current = apply }, [])
  const notify = useCallback((failure) => setError(failure?.message || String(failure)), [])
  const hub = useSpaces(notify)
  const { flush: flushSpaces, load: loadSpaces } = hub
  const refresh = useCallback(async () => {
    const { books: items } = await api('GET', '/library')
    setBooks(items || [])
    setRecent((previous) => items?.some(({ id }) => previous?.id === id) ? previous : null)
    const current = currentWorkspace.current
    if (current && !items?.some(({ id }) => id === current.book.id)) {
      setWorkspace((previous) => previous === current ? null : previous)
      setSection((previous) => previous === 'write' ? 'shelf' : previous)
    }
  }, [])

  useEffect(() => window.novelNative?.onClosing?.(async () => {
    const ok = (!writerFlush.current || await writerFlush.current()) && await flushSpaces()
    await flushLayout()
    await native('closeReady', { ok })
  }), [flushLayout, flushSpaces])

  const openBook = useCallback(async (id, silent = false, afterRestore = false) => {
    const request = ++pendingBook.current
    try {
      if (!afterRestore && currentWorkspace.current?.book.id === id) {
        setSection('write')
        setError('')
        return
      }
      if (!afterRestore && writerFlush.current && !await writerFlush.current()) {
        if (request === pendingBook.current) notify('当前章节未能保存。请返回正文处理后再换书。')
        return
      }
      const path = '/library/' + encodeURIComponent(id)
      const [detail, prefs] = await Promise.all([api('GET', path), api('GET', path + '/settings')])
      if (request !== pendingBook.current) return
      setSection('write')
      setWorkspace({ book: detail.book, settings: prefs.settings || {} })
      setRecent(detail.book)
      setLibraryPanel('')
      setError('')
      await writeFile(lastBookFile, JSON.stringify({ id })).catch(() => {})
    } catch (failure) { if (request === pendingBook.current && !silent) notify(failure) }
  }, [notify])

  async function navigate(kind, id = null) {
    const request = ++pendingBook.current
    if (writerFlush.current && !await writerFlush.current()) {
      if (request === pendingBook.current) notify('当前章节未能保存，请检查正文底部的保存状态。')
      return false
    }
    if (!await flushSpaces() || request !== pendingBook.current) return false
    setSection(kind)
    setFocusedId(id)
    setLibraryPanel('')
    setError('')
    if (kind === 'shelf') void refresh().catch(notify)
    return true
  }

  useEffect(() => {
    recoverInterruptedRestore().then(() => Promise.all([
      refresh(), loadSpaces().catch(notify), loadModel().catch(() => {}), api('GET', '/schema').then(({ sections }) => setSections(sections)),
      readFile(lastBookFile, 'utf8').then(JSON.parse).then((record) => {
        if (typeof record?.id === 'string') return openBook(record.id, true)
      }).catch(() => {}),
    ])).catch(notify).finally(() => setPending(false))
  }, [notify, refresh, openBook, loadSpaces])

  const compare = useCallback((details) => new Promise((resolve) => setComparison({ ...details, resolve })), [])
  const settle = (result) => { comparison.resolve(result); setComparison(null) }
  const book = workspace?.book
  const writing = Boolean(book && section === 'write')
  const themeMenu = <ThemeMenu {...appearance} onError={notify} />

  async function transfer(kind, anchor, chapterTitle) {
    if (!hub.data) throw new Error('请先载入创作空间。')
    const source = book.title + ' · ' + chapterTitle
    const seed = kind === 'clips' ? { text: anchor.text, source, tags: '正文选段' }
      : { premise: anchor.text, a: anchor.text, b: anchor.text, anchor: { ...anchor, bookId: book.id } }
    const item = createItem(kind, anchor.text.trim().slice(0, 28), seed)
    hub.change(kind, (all) => [item, ...all])
    return item.id
  }

  async function compareAnchor(anchor, replacement) {
    if (book?.id === anchor.bookId && writerFlush.current && !await writerFlush.current()) {
      throw new Error('来源章节未能保存。请先处理保存问题。')
    }
    const path = '/library/' + encodeURIComponent(anchor.bookId) + '/unit/chapters/' + encodeURIComponent(anchor.chapter)
    const { data } = await api('GET', path)
    const original = data.body || ''
    const end = anchor.start + anchor.text.length
    if (original.slice(anchor.start, end) !== anchor.text ||
        !original.slice(0, anchor.start).endsWith(anchor.before) || !original.slice(end).startsWith(anchor.after)) {
      throw new Error('来源选段或相邻文字已变化。请重新选取正文，当前推演已保留。')
    }
    const result = await compare({ bookId: anchor.bookId, chapter: anchor.chapter, original,
      proposed: original.slice(0, anchor.start) + replacement + original.slice(end) })
    if (result && book?.id === anchor.bookId) writerRevision.current?.(anchor.chapter, original, result)
    return result
  }

  function resumeWriting() {
    pendingBook.current++
    setSection('write')
    setError('')
  }

  return <GuideContext.Provider value={setGuide}><div className="studio ns-root" data-writing={writing}>
    <header className="studio-top">
      <div className="wordmark"><BookMarked size={23} aria-hidden /><span>Novel Studio</span></div>
      {writing && <div className="current-book" title={book.title}>{book.title}</div>}
      <div className="top-tools">
        {book && !writing && <button className="primary resume-writing" onClick={resumeWriting} title={book.title}><PenLine size={16} />返回正文</button>}
        {writing ? <>
          <button className="icon-button" aria-label="作品总览" title="作品总览" onClick={() => writerTools.current?.('overview')}><ChartNoAxesColumn size={18} /></button>
          <button className="icon-button" aria-label="搜索工具" title="搜索工具（Ctrl+K）" onClick={() => writerTools.current?.('tools', { findCommand: true })}><Search size={18} /></button>
          <GuideButton />
        </> : <button className="icon-button" aria-label="书库管理" title="书库管理" disabled={pending} onClick={() => setLibraryPanel('menu')}><SlidersHorizontal size={18} /></button>}
        {themeMenu}
      </div>
    </header>
    <nav className="studio-primary-nav" aria-label="主导航">
      {Object.entries({ shelf: '书架', ...spaceNames }).map(([kind, title]) => {
        const Icon = spaceIcons[kind]
        return <button key={kind} aria-label={'进入' + title} aria-current={section === kind ? 'page' : undefined}
          disabled={pending} onClick={() => {
            if (writing && kind !== 'shelf') void writerTools.current?.('space', { space: kind })
            else if (section !== kind) void navigate(kind)
          }}>
          <Icon size={17} aria-hidden /><span>{title}</span></button>
      })}
    </nav>
    <main className="studio-content">
      {error && <p className="top-notice notice" role="alert">{error}</p>}
      {pending ? <div className="workspace-empty">正在打开工作台…</div>
        : section === 'shelf' ? <Bookshelf books={books} openBook={openBook} refresh={refresh} ui={ui} recentId={recent?.id} />
        : section !== 'write' ? <CreativeSpace key={section + ':' + (focusedId || '')} kind={section} hub={hub} initialId={focusedId}
          compare={compareAnchor} onModelSettings={() => setLibraryPanel('model')} onFork={(id) => navigate('paths', id)} />
        : null}
      {!pending && book && <div className="writer-route" hidden={!writing}>
          <Writer key={book.id} book={book} active={writing} layout={writingLayout} getPane={ui} sections={sections} appearance={appearance} settings={workspace.settings}
            registerFlush={flushRef} registerTools={toolsRef} registerRevision={revisionRef} compare={compare} themeMenu={themeMenu}
            onOpenBook={openBook} onTransfer={transfer} hub={hub} compareAnchor={compareAnchor} onExpandSpace={navigate}
            onSettingsChange={(settings) => setWorkspace((previous) => ({ ...previous, settings }))}
            onBookChanged={async (next) => { setWorkspace((previous) => ({ ...previous, book: next })); setRecent(next); await refresh() }} />
        </div>}
    </main>
    {!writing && <GuideButton topic={['shelf', 'divination'].includes(section) ? section : 'spaces'} floating />}
    {libraryPanel && <Drawer title={libraryPanels[libraryPanel]} onClose={() => setLibraryPanel('')}
      guideTopic={{ menu: 'shelf', backup: 'transfer', appearance: 'appearance', model: 'ai' }[libraryPanel]}
      onBack={libraryPanel === 'menu' ? undefined : () => setLibraryPanel('menu')}>
      {libraryPanel === 'menu' && <div className="desk-menu"><section>
        {Object.entries(libraryPanels).slice(1).filter(([key]) => key !== 'backup' || platform !== 'dsh').map(([key, title]) => <button key={key} onClick={async () => {
          if (key !== 'backup' || await flushSpaces()) setLibraryPanel(key)
        }}>{title}</button>)}
      </section></div>}
      {libraryPanel === 'backup' && <Backup book={recent} refreshed={async (id) => {
        setWorkspace(null)
        await Promise.all([refresh(), loadSpaces()])
        if (id) await openBook(id, false, true)
      }} />}
      {libraryPanel === 'appearance' && <Appearance {...appearance} />}
      {libraryPanel === 'model' && <ModelSettings />}
    </Drawer>}
    {comparison && <Revision comparison={comparison} settle={settle} />}
    {guide && <Drawer title="使用说明" onClose={() => setGuide('')} className="guide-drawer">
      <GuideContents key={guide} initial={guide} />
    </Drawer>}
  </div></GuideContext.Provider>
}

createRoot(document.getElementById('root')).render(<App />)
