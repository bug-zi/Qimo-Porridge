import { useEffect } from 'react'

/**
 * 为所有 `.primary-button` 注入 SpecularButton 风格的「边框流光跟随鼠标」效果。
 *
 * 设计要点（与 App.css 中的 .primary-button::before / ::after 配合）：
 * - 在 document 上挂一个 rAF 节流的 pointermove 监听，命中当前悬停的
 *   `.primary-button` 时，把光斑中心写成百分比 CSS 变量 --sb-mx / --sb-my。
 * - 复用 pointermove 事件自带的 target（closest 查找，O(1)），不为每个按钮开循环，
 *   也不在每帧调用 elementFromPoint。
 * - 位置用百分比，分辨率无关；离开按钮后变量保留上次值，可见性由 CSS :hover 控制。
 * - 尊重 prefers-reduced-motion：直接不绑定监听，CSS 侧也会关掉空闲扫光。
 *
 * 全局只需在根组件调用一次；动态新增的 .primary-button 也会自动生效。
 */
export function useSpecularButtons(): void {
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    let frame = 0
    let lastTarget: Element | null = null
    let lastX = 0
    let lastY = 0

    const flush = () => {
      frame = 0
      const btn = lastTarget?.closest<HTMLButtonElement>('.primary-button')
      if (!btn || btn.disabled) return
      const rect = btn.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return
      const mx = ((lastX - rect.left) / rect.width) * 100
      const my = ((lastY - rect.top) / rect.height) * 100
      btn.style.setProperty('--sb-mx', `${mx}%`)
      btn.style.setProperty('--sb-my', `${my}%`)
    }

    const onPointerMove = (event: PointerEvent) => {
      lastTarget = event.target as Element | null
      lastX = event.clientX
      lastY = event.clientY
      if (frame) return
      frame = requestAnimationFrame(flush)
    }

    document.addEventListener('pointermove', onPointerMove, { passive: true })

    return () => {
      document.removeEventListener('pointermove', onPointerMove)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])
}
