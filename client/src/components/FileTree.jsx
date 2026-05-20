import { useState, useEffect, useRef } from 'react'
import { ChevronRight, ChevronDown, FolderIcon, OpenIcon, CopyIcon } from './Icons'
import { fmtBytes } from '../utils'
import { openFolder } from '../api'

function TreeNode({ node, depth = 0 }) {
  const [expanded, setExpanded] = useState(depth === 0)
  const hasChildren = node.children && node.children.length > 0

  const [ctx, setCtx] = useState(null)
  const menuRef = useRef(null)

  useEffect(() => {
    if (!ctx) return
    function handleClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setCtx(null)
      }
    }
    window.addEventListener('mousedown', handleClick)
    return () => window.removeEventListener('mousedown', handleClick)
  }, [ctx])

  function handleContextMenu(e) {
    e.preventDefault()
    setCtx({ x: e.clientX, y: e.clientY })
  }

  function handleOpen() {
    openFolder(node.path).catch(() => {})
    setCtx(null)
  }

  function handleCopy() {
    navigator.clipboard.writeText(node.path).catch(() => {})
    setCtx(null)
  }

  return (
    <div>
      <div
        className="tree-node flex items-center gap-1 px-2 py-1.5 rounded-md cursor-default select-none group"
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onContextMenu={handleContextMenu}
      >
        <button
          onClick={() => hasChildren && setExpanded(e => !e)}
          className={`w-4 h-4 flex-shrink-0 text-[#2A5298] ${hasChildren ? 'cursor-pointer' : 'invisible'}`}
        >
          {hasChildren ? (expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />) : null}
        </button>

        <FolderIcon className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />

        <span
          className="flex-1 text-xs text-slate-700 truncate font-medium"
          title={node.path}
        >
          {node.name}
        </span>

        <span className="text-xs text-slate-400 w-20 text-right flex-shrink-0 font-medium">
          {fmtBytes(node.size)}
        </span>
        <span className="text-xs text-slate-400 w-16 text-right flex-shrink-0">
          {(node.fileCount || 0).toLocaleString()}f
        </span>
      </div>

      {/* Context menu */}
      {ctx && (
        <div
          ref={menuRef}
          className="fixed z-50 bg-white border border-slate-200 rounded-lg shadow-xl py-1.5 min-w-[190px]"
          style={{ left: ctx.x, top: ctx.y }}
        >
          <button
            className="flex items-center gap-2.5 w-full px-4 py-2 text-sm text-slate-700 hover:bg-blue-50 hover:text-[#1B3A6B] transition-colors"
            onClick={handleOpen}
          >
            <OpenIcon className="w-4 h-4" />
            Open in Explorer
          </button>
          <button
            className="flex items-center gap-2.5 w-full px-4 py-2 text-sm text-slate-700 hover:bg-blue-50 hover:text-[#1B3A6B] transition-colors"
            onClick={handleCopy}
          >
            <CopyIcon className="w-4 h-4" />
            Copy Path
          </button>
        </div>
      )}

      {expanded && hasChildren && (
        <div>
          {node.children.map((child, i) => (
            <TreeNode key={i} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  )
}

export default function FileTree({ tree }) {
  if (!tree) return <p className="text-slate-400 text-sm text-center py-8">No tree data.</p>

  return (
    <div className="max-h-96 overflow-y-auto pr-1">
      <TreeNode node={tree} depth={0} />
    </div>
  )
}
