import { useState, useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Edit3, Save, X, Check } from 'lucide-react'
import hljs from 'highlight.js/lib/core'
import typescript from 'highlight.js/lib/languages/typescript'
import javascript from 'highlight.js/lib/languages/javascript'
import python from 'highlight.js/lib/languages/python'
import json from 'highlight.js/lib/languages/json'
import bash from 'highlight.js/lib/languages/bash'
import css from 'highlight.js/lib/languages/css'
import xml from 'highlight.js/lib/languages/xml'
import markdown from 'highlight.js/lib/languages/markdown'
import java from 'highlight.js/lib/languages/java'
import go from 'highlight.js/lib/languages/go'
import rust from 'highlight.js/lib/languages/rust'
import sql from 'highlight.js/lib/languages/sql'
import yaml from 'highlight.js/lib/languages/yaml'

hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('python', python)
hljs.registerLanguage('json', json)
hljs.registerLanguage('bash', bash)
hljs.registerLanguage('shell', bash)
hljs.registerLanguage('css', css)
hljs.registerLanguage('xml', xml)
hljs.registerLanguage('html', xml)
hljs.registerLanguage('markdown', markdown)
hljs.registerLanguage('java', java)
hljs.registerLanguage('go', go)
hljs.registerLanguage('rust', rust)
hljs.registerLanguage('sql', sql)
hljs.registerLanguage('yaml', yaml)

interface MarkdownViewerProps {
  content: string
  onSave?: (content: string) => void
  editable?: boolean
  className?: string
}

export default function MarkdownViewer({ content, onSave, editable = false, className = '' }: MarkdownViewerProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState(content)
  const [saved, setSaved] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Sync content when prop changes
  useEffect(() => { setEditContent(content) }, [content])

  // Highlight code blocks after render
  useEffect(() => {
    if (isEditing) return
    containerRef.current?.querySelectorAll('pre code').forEach(block => {
      hljs.highlightElement(block as HTMLElement)
    })
  }, [content, isEditing])

  // Auto-resize textarea
  useEffect(() => {
    if (isEditing && textareaRef.current) {
      const ta = textareaRef.current
      ta.style.height = 'auto'
      ta.style.height = Math.max(400, ta.scrollHeight) + 'px'
    }
  }, [isEditing, editContent])

  const handleSave = () => {
    onSave?.(editContent)
    setIsEditing(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleCancel = () => {
    setEditContent(content)
    setIsEditing(false)
  }

  // Handle tab key in textarea
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Tab') {
      e.preventDefault()
      const ta = textareaRef.current!
      const start = ta.selectionStart
      const end = ta.selectionEnd
      setEditContent(c => c.substring(0, start) + '  ' + c.substring(end))
      setTimeout(() => { ta.selectionStart = ta.selectionEnd = start + 2 }, 0)
    }
    if (e.key === 's' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSave()
    }
  }

  if (isEditing) {
    return (
      <div className={className}>
        <div className="flex items-center justify-between mb-3 sticky top-0 bg-white dark:bg-gray-800 py-2 z-10">
          <span className="text-xs text-gray-500 dark:text-gray-400 font-mono">Editing • Cmd+S to save • Tab for indent</span>
          <div className="flex gap-2">
            <button onClick={handleSave} className="flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 text-xs font-medium">
              <Save size={14} />Save
            </button>
            <button onClick={handleCancel} className="flex items-center gap-1 px-3 py-1.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 text-xs">
              <X size={14} />Cancel
            </button>
          </div>
        </div>
        <textarea
          ref={textareaRef}
          value={editContent}
          onChange={(e) => setEditContent(e.target.value)}
          onKeyDown={handleKeyDown}
          className="w-full min-h-[400h] px-4 py-3 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg font-mono text-[13px] leading-relaxed text-gray-900 dark:text-white resize-y focus:outline-none focus:ring-2 focus:ring-blue-500 tab-2"
          spellCheck={false}
          style={{ tabSize: 2 }}
        />
      </div>
    )
  }

  return (
    <div className={className}>
      {editable && (
        <div className="flex items-center justify-end mb-3 sticky top-0 bg-white dark:bg-gray-800 py-2 z-10">
          <div className="flex items-center gap-2">
            {saved && <span className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1"><Check size={12} />Saved</span>}
            <button onClick={() => { setEditContent(content); setIsEditing(true) }} className="flex items-center gap-1 px-3 py-1.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 text-xs">
              <Edit3 size={14} />Edit
            </button>
          </div>
        </div>
      )}
      <div ref={containerRef} className="markdown-body">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            code({ node, className, children, ...props }) {
              const match = /language-(\w+)/.exec(className || '')
              const isInline = !match && !String(children).includes('\n')
              if (isInline) {
                return <code className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-800 text-pink-600 dark:text-pink-400 rounded text-[13px] font-mono" {...props}>{children}</code>
              }
              return (
                <div className="relative group my-3">
                  {match && (
                    <span className="absolute top-2 right-2 text-[10px] text-gray-400 dark:text-gray-500 font-mono uppercase bg-gray-800 dark:bg-gray-900 px-1.5 py-0.5 rounded">
                      {match[1]}
                    </span>
                  )}
                  <pre className="bg-gray-900 dark:bg-gray-950 rounded-lg p-4 overflow-x-auto border border-gray-200 dark:border-gray-700">
                    <code className={`${className} text-[13px] leading-relaxed`} {...props}>{children}</code>
                  </pre>
                </div>
              )
            },
            h1({ children }) { return <h1 className="text-2xl font-bold text-gray-900 dark:text-white mt-8 mb-4 pb-2 border-b border-gray-200 dark:border-gray-700">{children}</h1> },
            h2({ children }) { return <h2 className="text-xl font-semibold text-gray-900 dark:text-white mt-6 mb-3 pb-1.5 border-b border-gray-100 dark:border-gray-800">{children}</h2> },
            h3({ children }) { return <h3 className="text-lg font-semibold text-gray-900 dark:text-white mt-5 mb-2">{children}</h3> },
            h4({ children }) { return <h4 className="text-base font-semibold text-gray-900 dark:text-white mt-4 mb-2">{children}</h4> },
            p({ children }) { return <p className="text-[13px] leading-relaxed text-gray-700 dark:text-gray-300 mb-3">{children}</p> },
            a({ href, children }) { return <a href={href} className="text-blue-600 dark:text-blue-400 hover:underline" target="_blank" rel="noopener noreferrer">{children}</a> },
            strong({ children }) { return <strong className="font-semibold text-gray-900 dark:text-white">{children}</strong> },
            em({ children }) { return <em className="italic text-gray-600 dark:text-gray-400">{children}</em> },
            ul({ children }) { return <ul className="list-disc list-inside mb-3 space-y-1 text-[13px] text-gray-700 dark:text-gray-300">{children}</ul> },
            ol({ children }) { return <ol className="list-decimal list-inside mb-3 space-y-1 text-[13px] text-gray-700 dark:text-gray-300">{children}</ol> },
            li({ children }) { return <li className="leading-relaxed">{children}</li> },
            blockquote({ children }) { return <blockquote className="border-l-4 border-blue-500 pl-4 py-1 my-3 bg-blue-50/50 dark:bg-blue-900/20 rounded-r text-[13px] text-gray-600 dark:text-gray-400">{children}</blockquote> },
            hr() { return <hr className="my-6 border-gray-200 dark:border-gray-700" /> },
            table({ children }) { return <div className="overflow-x-auto my-3"><table className="w-full text-[13px] border-collapse">{children}</table></div> },
            thead({ children }) { return <thead className="bg-gray-100 dark:bg-gray-800">{children}</thead> },
            th({ children }) { return <th className="text-left px-3 py-2 font-semibold text-gray-900 dark:text-white border border-gray-200 dark:border-gray-700">{children}</th> },
            td({ children }) { return <td className="px-3 py-2 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700">{children}</td> },
            input({ type, checked, ...props }) {
              if (type === 'checkbox') {
                return <input type="checkbox" checked={checked} readOnly className="mr-1.5 rounded" {...props} />
              }
              return <input type={type} {...props} />
            },
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    </div>
  )
}
