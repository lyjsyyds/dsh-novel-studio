import React, { memo } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { native } from './platform.js'

const plugins = [remarkGfm]
const components = {
  a({ href, children }) {
    if (!/^https?:\/\//i.test(href || '')) return <span>{children}</span>
    return <button className="text-button manuscript-link" onClick={() => native('external', { url: href }).catch(() => {})}>{children}</button>
  },
  img({ alt }) { return <span>{alt || '图片'}</span> },
}

function Manuscript({ body }) {
  return <div className="reading paper-markdown">
    <Markdown remarkPlugins={plugins} components={components}>{body}</Markdown>
  </div>
}

export default memo(Manuscript)
