import { Pause, Play, Square, X } from 'lucide-react'
import { useCourseTimer } from '../hooks/useCourseTimer'

/**
 * 顶栏课程计时器：常驻显示在 topbar，任意页面都可开始 / 暂停 / 记入 / 放弃。
 * 计时状态来自全局 CourseTimerProvider，跨页面不丢失。
 */
export function TopbarCourseTimer({
  activeCourseId,
  activeCourseName,
}: {
  activeCourseId: string
  activeCourseName: string
}) {
  const { timer, start, toggle, stopAndRecord, discard, recording } = useCourseTimer()

  if (!timer) {
    return (
      <div className="topbar-course-timer">
        <button
          className="tct-start"
          type="button"
          disabled={recording}
          onClick={() => start(activeCourseId, activeCourseName)}
        >
          <Play size={14} /> 计时
        </button>
      </div>
    )
  }

  const min = Math.floor(timer.elapsedSec / 60)
  const sec = timer.elapsedSec % 60
  const time = `${min}:${String(sec).padStart(2, '0')}`
  const showCourse = timer.courseId !== activeCourseId

  return (
    <div className={`topbar-course-timer ${timer.running ? 'is-running' : 'is-paused'}`}>
      <button
        className="tct-toggle"
        type="button"
        disabled={recording}
        aria-label={timer.running ? '暂停计时' : '继续计时'}
        onClick={toggle}
      >
        {timer.running ? <Pause size={14} /> : <Play size={14} />}
      </button>
      <span className="tct-time">{time}</span>
      {showCourse && <span className="tct-course">{timer.courseName}</span>}
      <button
        className="tct-icon-btn"
        type="button"
        disabled={recording}
        aria-label="记入本次时长"
        title="记入"
        onClick={() => {
          void stopAndRecord()
        }}
      >
        <Square size={13} />
      </button>
      <button
        className="tct-icon-btn"
        type="button"
        disabled={recording}
        aria-label="放弃本次计时"
        title="放弃"
        onClick={discard}
      >
        <X size={13} />
      </button>
    </div>
  )
}
