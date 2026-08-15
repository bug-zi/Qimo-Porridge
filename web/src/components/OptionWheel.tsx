import { useCallback, useEffect, useRef, useState } from 'react'
import './OptionWheel.css'

/** 单项标签：渲染在主文案右侧的小胶囊（如「备考」「已结束」）。 */
export type OptionWheelItemTag = {
  label: string
  /** 主题色调 key，通过 data-tone 暴露给 CSS（如 'active' | 'history'）。 */
  tone?: string
}

type OptionWheelProps = {
  /** 选项文案数组（按顺序对应索引）。 */
  items: string[]
  /** 当前聚焦（居中）项的索引，受控。 */
  index: number
  /** 居中项变化时触发（用于「预览」）。 */
  onChange?: (index: number) => void
  /** 确认进入：回车或点击已居中的项时触发。 */
  onActivate?: () => void
  /** 按索引返回该项的小标签；返回 undefined 则不渲染。用于区分分组（备考/历史）。 */
  getItemTag?: (index: number) => OptionWheelItemTag | undefined
  side?: 'left' | 'right'
  /** 是否水平居中排列（窄容器/下拉用：取消左右弧形偏移，选项沿中线垂直排列）。 */
  centered?: boolean
  /** 字号（rem）。 */
  fontSize?: number
  /** 行距倍数。 */
  spacing?: number
  /** 弧线弯曲程度（0=直列，1=标准弧）。 */
  curve?: number
  /** 每项相对圆心的倾斜角（度），越大卷得越紧。 */
  tilt?: number
  /** 远离居中项的模糊量（px/项）。 */
  blur?: number
  /** 远离居中项的不透明度衰减（每项）。 */
  fade?: number
  /** 非居中项的最小不透明度。 */
  minOpacity?: number
  /** 缓动时间常数（ms）。 */
  smoothing?: number
  /** 左/右内边距（px）。 */
  inset?: number
  /** 是否首尾循环。 */
  loop?: boolean
  /** 是否允许拖拽。 */
  draggable?: boolean
  className?: string
  ariaLabel?: string
}

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max)

/**
 * OptionWheel —— 弧形滚轮单选器（移植自 reactbits，改为受控）。
 *
 * 受控约定：父级传 `index` 作为居中项的唯一真相源。内部 posRef/targetRef 只负责
 * 平滑动画。拖拽/滚动过程中只动 targetRef（纯视觉），松手/吸格/键盘/点按时算出
 * 整数索引并通过 onChange 上报；父级改 index 后由下方 effect 把 targetRef 同步过去
 * （不再回传 onChange，避免循环）。onActivate 用于「确认进入」。
 */
export function OptionWheel({
  items,
  index,
  onChange,
  onActivate,
  getItemTag,
  side = 'left',
  centered = false,
  fontSize = 1.5,
  spacing = 1.3,
  curve = 1,
  tilt = 8,
  blur = 1.5,
  fade = 0.28,
  minOpacity = 0.12,
  smoothing = 220,
  inset = 24,
  loop = false,
  draggable = true,
  className = '',
  ariaLabel = '选项滚轮',
}: OptionWheelProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<(HTMLDivElement | null)[]>([])
  const posRef = useRef(index)
  const targetRef = useRef(index)
  const selectedRef = useRef(index)
  const rafRef = useRef<number | null>(null)
  const lastRef = useRef(0)
  const cfgRef = useRef<Record<string, number | string | boolean>>({})
  const onChangeRef = useRef(onChange)
  const onActivateRef = useRef(onActivate)
  const wheelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dragRef = useRef<{ y: number; start: number; id: number } | null>(null)
  const dragMovedRef = useRef(false)
  const [isDragging, setIsDragging] = useState(false)

  const reducedMotion =
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  const remPx =
    typeof window !== 'undefined'
      ? parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
      : 16

  onChangeRef.current = onChange
  onActivateRef.current = onActivate
  cfgRef.current = {
    count: items.length,
    rowH: Math.max(fontSize * spacing * remPx, 1),
    curve,
    tilt,
    blur,
    fade,
    minOpacity,
    side,
    centered,
    loop,
    smoothing,
  }

  // rAF 缓动 + 沿弧布局：R = rowH / tiltRad，保证相邻项弧长 = 一行高。
  const runFrame = useCallback(
    (now: number) => {
      const dt = Math.min((now - lastRef.current) / 1000, 0.05)
      lastRef.current = now
      const cfg = cfgRef.current
      const count = Number(cfg.count)
      const tau = Math.max(Number(cfg.smoothing), 1) / 1000
      const k = 1 - Math.exp(-dt / tau)

      const target = targetRef.current
      const cur = posRef.current
      let next = reducedMotion ? target : cur + (target - cur) * k
      const settled = Math.abs(target - next) < 0.001
      if (settled) next = target
      posRef.current = next

      const els = itemRefs.current
      const mirror = cfg.side === 'right' ? -1 : 1
      const tiltRad = (Number(cfg.tilt) * Math.PI) / 180
      const R = tiltRad > 0.0005 ? Number(cfg.rowH) / tiltRad : 0
      const rowH = Number(cfg.rowH)
      const fadeV = Number(cfg.fade)
      const minOp = Number(cfg.minOpacity)
      const blurV = Number(cfg.blur)
      for (let i = 0; i < count; i++) {
        const el = els[i]
        if (!el) continue
        let d = i - next
        if (cfg.loop && count > 1) {
          d = (((d % count) + count) % count)
          if (d > count / 2) d -= count
        }
        const dist = Math.abs(d)
        let x = 0
        let y = d * rowH
        let rot = 0
        if (R > 0) {
          const ang = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, d * tiltRad))
          y = R * Math.sin(ang)
          x = cfg.centered ? 0 : -mirror * R * (1 - Math.cos(ang)) * Number(cfg.curve)
          rot = (mirror * ang * 180) / Math.PI
        }
        el.style.transform = `translate(${x.toFixed(2)}px, calc(${y.toFixed(2)}px - 50%)) rotate(${rot.toFixed(3)}deg)`
        el.style.opacity = String(Math.max(minOp, 1 - dist * fadeV))
        el.style.filter = blurV > 0 ? `blur(${(dist * blurV).toFixed(2)}px)` : 'none'
        el.style.setProperty('--ow-p', Math.max(0, 1 - Math.min(dist, 1)).toFixed(4))
      }

      rafRef.current = settled ? null : requestAnimationFrame(runFrame)
    },
    [reducedMotion],
  )

  const startLoop = useCallback(() => {
    if (rafRef.current != null) return
    lastRef.current = performance.now()
    rafRef.current = requestAnimationFrame(runFrame)
  }, [runFrame])

  // 仅移动视觉目标（拖拽/滚动连续过程），不上报。
  const moveTarget = useCallback(
    (value: number) => {
      const cfg = cfgRef.current
      const count = Number(cfg.count)
      const v = cfg.loop ? value : clamp(value, 0, Math.max(count - 1, 0))
      targetRef.current = v
      startLoop()
    },
    [startLoop],
  )

  // 吸格并上报变化（松手/键盘/点击）。
  const commit = useCallback(
    (value: number) => {
      const cfg = cfgRef.current
      const count = Number(cfg.count)
      if (count <= 0) return
      const clamped = cfg.loop ? value : clamp(value, 0, count - 1)
      const snapped = Math.round(clamped)
      const idx = ((snapped % count) + count) % count
      targetRef.current = snapped
      if (idx !== selectedRef.current) {
        selectedRef.current = idx
        onChangeRef.current?.(idx)
      }
      startLoop()
    },
    [startLoop],
  )

  // 受控同步：index 或视觉参数变化时，把目标和已选对齐到 index。
  useEffect(() => {
    const count = Number(cfgRef.current.count)
    if (count <= 0) return
    const v = clamp(index, 0, count - 1)
    selectedRef.current = Math.round(v)
    targetRef.current = v
    startLoop()
  }, [index, items, fontSize, spacing, curve, tilt, blur, fade, minOpacity, side, loop, smoothing, startLoop])

  // 滚轮（非 passive，需 preventDefault）。
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const cfg = cfgRef.current
      const rowH = Number(cfg.rowH)
      const delta = e.deltaMode === 1 ? e.deltaY * 24 : e.deltaY
      const step = Math.max(-1, Math.min(1, delta / rowH))
      moveTarget(targetRef.current + step)
      if (wheelTimerRef.current) clearTimeout(wheelTimerRef.current)
      wheelTimerRef.current = setTimeout(() => commit(targetRef.current), 140)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      el.removeEventListener('wheel', onWheel)
      if (wheelTimerRef.current) clearTimeout(wheelTimerRef.current)
    }
  }, [moveTarget, commit])

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!draggable) return
      dragRef.current = { y: e.clientY, start: targetRef.current, id: e.pointerId }
      dragMovedRef.current = false
      setIsDragging(true)
    },
    [draggable],
  )

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current
      if (!drag) return
      const dy = e.clientY - drag.y
      if (!dragMovedRef.current && Math.abs(dy) > 4) {
        dragMovedRef.current = true
        rootRef.current?.setPointerCapture(drag.id)
      }
      if (dragMovedRef.current) {
        moveTarget(drag.start - dy / Number(cfgRef.current.rowH))
      }
    },
    [moveTarget],
  )

  const handlePointerEnd = useCallback(() => {
    if (!dragRef.current) return
    dragRef.current = null
    setIsDragging(false)
    if (dragMovedRef.current) commit(targetRef.current)
  }, [commit])

  const handleItemClick = useCallback(
    (i: number) => {
      if (dragMovedRef.current) return
      if (i === selectedRef.current) {
        onActivateRef.current?.()
        return
      }
      commit(i)
    },
    [commit],
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        onActivateRef.current?.()
        return
      }
      let delta: number | null = null
      if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') delta = -1
      else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') delta = 1
      if (delta == null) return
      e.preventDefault()
      commit(Math.round(targetRef.current) + delta)
    },
    [commit],
  )

  useEffect(
    () => () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
      // 必须置空：StrictMode 开发模式会「挂载→清理→再挂载」，若留着已取消的 id，
      // 再挂载时 startLoop 开头的 `if (rafRef.current != null) return` 会误判为
      // 「循环已在跑」而提前返回，导致 rAF 永不调度、选项全堆在中点。
      rafRef.current = null
    },
    [],
  )

  return (
    <div
      ref={rootRef}
      role="listbox"
      tabIndex={0}
      aria-label={ariaLabel}
      className={`option-wheel${side === 'right' ? ' option-wheel--right' : ''}${isDragging ? ' option-wheel--dragging' : ''}${className ? ` ${className}` : ''}`}
      style={{
        '--ow-font-size': `${fontSize}rem`,
        '--ow-inset': `${inset}px`,
      } as React.CSSProperties}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onKeyDown={handleKeyDown}
    >
      {items.map((label, i) => {
        const tag = getItemTag?.(i)
        return (
          <div
            key={`${label}-${i}`}
            ref={(el) => {
              itemRefs.current[i] = el
            }}
            role="option"
            aria-selected={i === index}
            className={`option-wheel__item${i === index ? ' option-wheel__item--selected' : ''}`}
            onClick={() => handleItemClick(i)}
          >
            <span className="option-wheel__item-label">{label}</span>
            {tag ? (
              <span className="option-wheel__item-tag" data-tone={tag.tone}>
                {tag.label}
              </span>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
