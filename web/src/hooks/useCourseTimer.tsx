import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'

export type CourseTimerState = {
  courseId: string
  courseName: string
  elapsedSec: number
  running: boolean
}

type CourseTimerContextValue = {
  timer: CourseTimerState | null
  recording: boolean
  start: (courseId: string, courseName: string) => void
  toggle: () => void
  stopAndRecord: () => Promise<void>
  discard: () => void
  backfill: (minutes: number) => Promise<void>
}

const CourseTimerContext = createContext<CourseTimerContextValue | null>(null)

/**
 * 课程级计时器：状态挂在 App 顶层 Provider，组件树任意子树卸载（如离开「计划」页）
 * 都不会丢失计时。只有用户手动暂停/停止才改变 running 状态。
 */
export function CourseTimerProvider({
  children,
  onRecordMinutes,
}: {
  children: ReactNode
  onRecordMinutes: (courseId: string, courseName: string, minutes: number) => Promise<void>
}) {
  const [timer, setTimer] = useState<CourseTimerState | null>(null)
  const [recording, setRecording] = useState(false)
  const timerRef = useRef<CourseTimerState | null>(null)
  timerRef.current = timer

  // running 为 true 时每秒 +1；暂停时清理 interval，elapsedSec 保留。
  useEffect(() => {
    if (!timer?.running) return
    const id = window.setInterval(() => {
      setTimer((current) => (current ? { ...current, elapsedSec: current.elapsedSec + 1 } : current))
    }, 1000)
    return () => window.clearInterval(id)
  }, [timer?.running])

  const start = useCallback((courseId: string, courseName: string) => {
    setTimer((current) => {
      // 同一门课：恢复计时；不同课程：直接覆盖（旧的由调用方先 stopAndRecord）。
      if (current && current.courseId === courseId) {
        return { ...current, running: true }
      }
      return { courseId, courseName, elapsedSec: 0, running: true }
    })
  }, [])

  const toggle = useCallback(() => {
    setTimer((current) => (current ? { ...current, running: !current.running } : current))
  }, [])

  const stopAndRecord = useCallback(async () => {
    const current = timerRef.current
    if (!current) return
    // 舍弃秒数,只计整分钟:3分34秒 记为 3 分钟;不足 1 分钟(如 0分35秒)记为 0,不写入。
    const minutes = Math.floor(current.elapsedSec / 60)
    if (minutes <= 0) {
      // 不足 1 分钟:无有效时长可记,直接清掉计时,不调用后端(后端要求 minutes>=1)。
      setTimer(null)
      return
    }
    setRecording(true)
    try {
      await onRecordMinutes(current.courseId, current.courseName, minutes)
    } finally {
      setRecording(false)
      setTimer(null)
    }
  }, [onRecordMinutes])

  const discard = useCallback(() => {
    setTimer(null)
  }, [])

  const backfill = useCallback(
    async (minutes: number) => {
      const current = timerRef.current
      if (!current) return
      const safe = Math.max(1, Math.min(1440, Math.round(minutes)))
      setRecording(true)
      try {
        await onRecordMinutes(current.courseId, current.courseName, safe)
      } finally {
        setRecording(false)
      }
    },
    [onRecordMinutes],
  )

  return (
    <CourseTimerContext.Provider
      value={{ timer, recording, start, toggle, stopAndRecord, discard, backfill }}
    >
      {children}
    </CourseTimerContext.Provider>
  )
}

export function useCourseTimer() {
  const ctx = useContext(CourseTimerContext)
  if (!ctx) throw new Error('useCourseTimer 必须在 CourseTimerProvider 内使用')
  return ctx
}
