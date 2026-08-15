import { useCallback, useEffect, useState } from 'react'

export interface TextSelectionSnapshot {
  text: string
  rect: DOMRect
}

/** 输入控件中的选区不弹工具条（避免干扰编辑） */
const EXCLUDE_SELECTOR =
  'input, textarea, select, [contenteditable="true"], [contenteditable=""]'

/**
 * 读取当前页面选区，返回标准化快照；不满足条件时返回 null。
 *
 * 约束：
 * - 必须在 `.app-shell` 内（排除启动/错误态等占位界面）；
 * - 排除输入控件内的选区；
 * - 选区必须有可见范围（rect 宽高都为 0 时忽略，例如纯折叠光标）。
 */
function readSelection(): TextSelectionSnapshot | null {
  if (typeof window === 'undefined') return null
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null

  const text = selection.toString().trim()
  if (!text) return null

  const range = selection.getRangeAt(0)
  const container = range.commonAncestorContainer
  const element =
    container.nodeType === Node.ELEMENT_NODE
      ? (container as Element)
      : container.parentElement
  if (!element) return null
  if (!element.closest('.app-shell')) return null
  if (element.closest(EXCLUDE_SELECTOR)) return null

  const rect = range.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) return null

  return { text, rect }
}

/**
 * 监听全局文本选区，用于驱动「添加到笔记」浮层。
 *
 * 行为：
 * - `mouseup` / `keyup`（键盘 Shift 选区）后捕获选区并弹出浮层，避免拖拽过程中跟着抖动；
 * - `selectionchange` 仅在选区被清空时隐藏浮层；
 * - 滚动 / 缩放时用 rAF 重定位，浮层不会停留在旧坐标上。
 */
export function useTextSelection(): TextSelectionSnapshot | null {
  const [snapshot, setSnapshot] = useState<TextSelectionSnapshot | null>(null)

  const commit = useCallback(() => {
    setSnapshot(readSelection())
  }, [])

  const hideIfEmpty = useCallback(() => {
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed || !selection.toString().trim()) {
      setSnapshot(null)
    }
  }, [])

  useEffect(() => {
    let frame = 0
    const reposition = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        setSnapshot(readSelection())
      })
    }

    document.addEventListener('mouseup', commit)
    document.addEventListener('keyup', commit)
    document.addEventListener('selectionchange', hideIfEmpty)
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)

    return () => {
      document.removeEventListener('mouseup', commit)
      document.removeEventListener('keyup', commit)
      document.removeEventListener('selectionchange', hideIfEmpty)
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [commit, hideIfEmpty])

  return snapshot
}
