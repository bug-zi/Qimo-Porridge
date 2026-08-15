import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, NotebookPen } from 'lucide-react'
import { useTextSelection } from '../hooks/useTextSelection'

interface SelectionToNoteToolbarProps {
  onAddToNote: (text: string) => void
}

const TOOLBAR_HEIGHT = 38
const GAP = 10
const EDGE_PADDING = 90
const FLASH_DURATION = 1100

/**
 * 选中文本后浮现的轻量工具条：把当前选区摘录追加到当前课程的复习笔记。
 *
 * 渲染策略：通过 portal 挂到 `document.body`，绕开 `.app-shell` 的 `zoom` 缩放，
 * 这样 `position: fixed` + 视口坐标（来自 `getBoundingClientRect`）定位始终准确。
 */
export function SelectionToNoteToolbar({ onAddToNote }: SelectionToNoteToolbarProps) {
  const snapshot = useTextSelection()
  const [flash, setFlash] = useState(false)
  const flashTimer = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(flashTimer.current), [])

  // 选区切换后恢复「添加」态
  useEffect(() => {
    if (snapshot) setFlash(false)
  }, [snapshot])

  if (!snapshot || typeof document === 'undefined') return null

  const { rect, text } = snapshot

  // 选区贴近视口顶部时，工具条改放到选区下方，避免被裁切
  const placeBelow = rect.top < TOOLBAR_HEIGHT + GAP + 8
  const top = placeBelow ? rect.bottom + GAP : rect.top - TOOLBAR_HEIGHT - GAP
  const left = Math.max(
    EDGE_PADDING,
    Math.min(rect.left + rect.width / 2, window.innerWidth - EDGE_PADDING),
  )

  const handleAdd = () => {
    onAddToNote(text)
    setFlash(true)
    window.clearTimeout(flashTimer.current)
    flashTimer.current = window.setTimeout(() => {
      window.getSelection()?.removeAllRanges()
      setFlash(false)
    }, FLASH_DURATION)
  }

  return createPortal(
    <div
      className="selection-to-note-toolbar"
      role="toolbar"
      aria-label="选区操作"
      style={{ top, left }}
    >
      <button
        type="button"
        className={flash ? 'is-done' : ''}
        onMouseDown={(event) => event.preventDefault()}
        onClick={handleAdd}
      >
        {flash ? <Check size={14} /> : <NotebookPen size={14} />}
        {flash ? '已加入笔记' : '添加到笔记'}
      </button>
    </div>,
    document.body,
  )
}
