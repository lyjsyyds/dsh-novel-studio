import React, { useEffect, useId, useLayoutEffect, useRef } from 'react'
import { ArrowLeft, X } from 'lucide-react'
import { GuideButton } from './guide.jsx'

export function Drawer({ title, onClose, onBack, docked = false, visible = true, className = '', navigationKey, tabs, guideTopic, children }) {
  const dialogRef = useRef(null)
  const contentRef = useRef(null)
  const scroll = useRef(new WeakMap())
  const titleId = useId()
  useEffect(() => {
    if (!visible) return
    const dialog = dialogRef.current
    if (docked) dialog.show()
    else dialog.showModal()
    return () => dialog.close()
  }, [docked, visible])
  useLayoutEffect(() => {
    if (!navigationKey) return
    const content = contentRef.current
    content.scrollTop = scroll.current.get(navigationKey) || 0
  }, [navigationKey])
  return <dialog className={'studio-drawer ' + className} data-docked={docked} aria-labelledby={titleId} ref={dialogRef}
    onCancel={(event) => { event.preventDefault(); (onBack || onClose)() }}>
    <header>
      {onBack && <button className="icon-button" aria-label="返回上一级" onClick={onBack}><ArrowLeft size={18} /></button>}
      <h2 id={titleId}>{title}</h2>
      {!docked && guideTopic && <GuideButton topic={guideTopic} />}
      <button className="icon-button" aria-label="关闭" onClick={onClose}><X size={19} /></button>
    </header>
    {tabs}
    <div className="drawer-content" ref={contentRef} onScroll={(event) => {
      if (navigationKey) scroll.current.set(navigationKey, event.currentTarget.scrollTop)
    }}>{children}</div>
  </dialog>
}
