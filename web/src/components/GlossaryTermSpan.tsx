/** 术语悬停 span：虚线下划线 + 悬停 300ms 弹词条 tooltip + 点击打开完整词条卡。 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { GlossaryTerm } from '../types'
import { useGlossary } from '../hooks/useGlossary'

type TooltipState = {
  term: GlossaryTerm
  style: {
    left: number
    top: number
    width: number
    maxHeight: number
  }
}

export default function GlossaryTermSpan({ term, matchedText }: { term: GlossaryTerm; matchedText: string }) {
  const { openTerm, activeTermId } = useGlossary()
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)
  const hoverTimerRef = useRef<number | null>(null)
  const spanRef = useRef<HTMLSpanElement | null>(null)

  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) window.clearTimeout(hoverTimerRef.current)
    }
  }, [])

  function showTooltip() {
    const target = spanRef.current
    if (!target) return
    // 定位与钳制算法复刻 AiCompanion showTurnTooltip
    const rect = target.getBoundingClientRect()
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    const width = Math.max(220, Math.min(340, viewportWidth - 24))
    const left = Math.max(12, Math.min(rect.left + rect.width / 2 - width / 2, viewportWidth - width - 12))
    const top = rect.bottom + 10 > viewportHeight - 100 ? Math.max(12, rect.top - 120) : rect.bottom + 10
    setTooltip({
      term,
      style: {
        left,
        top,
        width,
        maxHeight: Math.max(72, viewportHeight - top - 16),
      },
    })
  }

  function handlePointerEnter() {
    if (hoverTimerRef.current) window.clearTimeout(hoverTimerRef.current)
    hoverTimerRef.current = window.setTimeout(showTooltip, 300)
  }

  function hideTooltip() {
    if (hoverTimerRef.current) window.clearTimeout(hoverTimerRef.current)
    setTooltip(null)
  }

  const cardOpen = activeTermId === term.id

  return (
    <>
      <span
        ref={spanRef}
        className="glossary-term"
        tabIndex={0}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={hideTooltip}
        onFocus={showTooltip}
        onBlur={hideTooltip}
        onClick={() => {
          hideTooltip()
          openTerm(term.id)
        }}
      >
        {matchedText}
      </span>
      {tooltip && !cardOpen
        ? createPortal(
            <div className="glossary-tooltip" style={tooltip.style}>
              <div className="glossary-tooltip-header">
                <strong>{tooltip.term.term}</strong>
              </div>
              <p className="glossary-tooltip-body">{tooltip.term.oneLiner}</p>
              <span className="glossary-tooltip-hint">点击查看完整词条</span>
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
