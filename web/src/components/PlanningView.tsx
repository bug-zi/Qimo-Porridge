import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, LoaderCircle, X } from 'lucide-react'
import type { Course, StudyWorkspace } from '../types'
import { getCourseWorkspace } from '../api'

type PlanningViewProps = {
  courses: Course[]
  courseWorkspaces: Record<string, StudyWorkspace>
}

type CourseEntry = {
  course: Course
  plannedMinutes: number
  isExam: boolean
}

type DayCell = {
  date: Date
  iso: string
  inMonth: boolean
  isToday: boolean
  entries: CourseEntry[]
  plannedMinutes: number
  spentMinutes: number
  overBudget: boolean
}

const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日']
const CN_WEEKDAY = ['日', '一', '二', '三', '四', '五', '六']
const MONTH_LABELS = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月']
const VISIBLE_ENTRIES = 3

function pad2(value: number) {
  return value < 10 ? `0${value}` : String(value)
}

function formatIso(date: Date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

function parseIso(value: string | undefined): Date | null {
  if (!value) return null
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value.trim())
  if (!match) return null
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return Number.isNaN(date.getTime()) ? null : date
}

function addDays(date: Date, days: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function buildCellTooltip(cell: DayCell) {
  const parts: string[] = [`${cell.iso} 周${CN_WEEKDAY[cell.date.getDay()]}`]
  if (cell.entries.length > 0) {
    parts.push(`${cell.entries.length} 门课程 · 计划 ${cell.plannedMinutes} 分钟`)
    parts.push(cell.entries.map((entry) => (entry.isExam ? `${entry.course.name}·考试` : `${entry.course.name} ${entry.plannedMinutes}′`)).join('、'))
  }
  if (cell.spentMinutes > 0) parts.push(`实际学习 ${cell.spentMinutes} 分钟${cell.overBudget ? '（超额）' : ''}`)
  return parts.join('\n')
}

function CourseEventChip({ entry }: { entry: CourseEntry }) {
  if (entry.isExam) {
    return <span className="planning-exam-chip">{entry.course.name} 考试</span>
  }
  const style = { '--course-color': entry.course.color } as CSSProperties
  return (
    <span className="planning-course-chip" style={style}>
      <span className="planning-course-bar" />
      <span className="planning-course-name">{entry.course.name}</span>
      {entry.plannedMinutes > 0 && <span className="planning-course-min">{entry.plannedMinutes}′</span>}
    </span>
  )
}

export function PlanningView({ courses, courseWorkspaces }: PlanningViewProps) {
  const today = useMemo(() => startOfDay(new Date()), [])
  const todayIso = formatIso(today)

  // 补拉未缓存课程的 workspace
  const [extraWorkspaces, setExtraWorkspaces] = useState<Record<string, StudyWorkspace>>({})
  const [loadingExtra, setLoadingExtra] = useState(false)

  useEffect(() => {
    let cancelled = false
    const missing = courses.filter((course) => !courseWorkspaces[course.id] && !extraWorkspaces[course.id])
    if (missing.length === 0) return
    setLoadingExtra(true)
    void Promise.all(
      missing.map((course) =>
        getCourseWorkspace(course.id)
          .then((workspace) => ({ id: course.id, workspace }))
          .catch(() => null),
      ),
    ).then((results) => {
      if (cancelled) return
      setExtraWorkspaces((current) => {
        const next = { ...current }
        for (const result of results) {
          if (result) next[result.id] = result.workspace
        }
        return next
      })
      setLoadingExtra(false)
    })
    return () => {
      cancelled = true
    }
  }, [courses, courseWorkspaces, extraWorkspaces])

  const combinedWorkspaces = useMemo(() => {
    const merged: Record<string, StudyWorkspace> = { ...courseWorkspaces, ...extraWorkspaces }
    return Object.values(merged)
  }, [courseWorkspaces, extraWorkspaces])

  const schedule = useMemo(() => {
    const minutesByIso = new Map<string, Map<string, number>>() // iso -> courseId -> minutes
    const examByIso = new Map<string, Set<string>>() // iso -> courseIds
    const spentByIso = new Map<string, number>()
    let nearestExam: { date: Date; course: Course } | null = null

    for (const workspace of combinedWorkspaces) {
      const course = workspace.course
      const planStart = parseIso(workspace.planStartDate)
      if (planStart) {
        for (const task of workspace.tasks) {
          if (!task.day || task.day < 1) continue
          const iso = formatIso(addDays(planStart, task.day - 1))
          const inner = minutesByIso.get(iso) ?? new Map<string, number>()
          inner.set(course.id, (inner.get(course.id) ?? 0) + (task.duration || 0))
          minutesByIso.set(iso, inner)
        }
      }
      const examDate = parseIso(course.examDate)
      if (examDate) {
        const examIso = formatIso(examDate)
        const set = examByIso.get(examIso) ?? new Set<string>()
        set.add(course.id)
        examByIso.set(examIso, set)
        if (examDate.getTime() >= today.getTime() && (!nearestExam || examDate.getTime() < nearestExam.date.getTime())) {
          nearestExam = { date: examDate, course }
        }
      }
      for (const entry of workspace.timeLog ?? []) {
        spentByIso.set(entry.date, (spentByIso.get(entry.date) ?? 0) + entry.minutes)
      }
    }

    return { minutesByIso, examByIso, spentByIso, nearestExam }
  }, [combinedWorkspaces, today])

  const coursesById = useMemo(() => {
    const map = new Map<string, Course>()
    for (const course of courses) map.set(course.id, course)
    // workspace 里可能带有 courses 列表外的课程信息（例如颜色更新），兜底用 workspace.course
    for (const workspace of combinedWorkspaces) {
      if (!map.has(workspace.course.id)) map.set(workspace.course.id, workspace.course)
    }
    return map
  }, [courses, combinedWorkspaces])

  const overdueTotal = useMemo(
    () => combinedWorkspaces.reduce((sum, workspace) => sum + (workspace.dailyProgress?.overdue?.length ?? 0), 0),
    [combinedWorkspaces],
  )

  const hasPlan = schedule.minutesByIso.size > 0 || schedule.examByIso.size > 0

  const initialAnchor = schedule.nearestExam?.date ?? today
  const [view, setView] = useState<[number, number]>([initialAnchor.getFullYear(), initialAnchor.getMonth()])
  const [selectedIso, setSelectedIso] = useState<string | null>(null)

  const cells = useMemo<DayCell[]>(() => {
    const monthStart = new Date(view[0], view[1], 1)
    const gridStart = addDays(monthStart, -((monthStart.getDay() + 6) % 7))

    const result: DayCell[] = []
    for (let i = 0; i < 42; i += 1) {
      const date = addDays(gridStart, i)
      const iso = formatIso(date)
      const dayMinutes = schedule.minutesByIso.get(iso)
      const exams = schedule.examByIso.get(iso)

      const involvedIds = new Set<string>()
      dayMinutes?.forEach((_, courseId) => involvedIds.add(courseId))
      exams?.forEach((courseId) => involvedIds.add(courseId))

      const entries: CourseEntry[] = []
      let plannedTotal = 0
      for (const courseId of involvedIds) {
        const course = coursesById.get(courseId)
        if (!course) continue
        const planned = dayMinutes?.get(courseId) ?? 0
        const isExam = exams?.has(courseId) ?? false
        entries.push({ course, plannedMinutes: planned, isExam })
        plannedTotal += planned
      }
      // 考试在前，其余按计划时长降序
      entries.sort((a, b) => {
        if (a.isExam !== b.isExam) return a.isExam ? -1 : 1
        return b.plannedMinutes - a.plannedMinutes
      })

      const spent = schedule.spentByIso.get(iso) ?? 0
      result.push({
        date,
        iso,
        inMonth: date.getMonth() === view[1],
        isToday: iso === todayIso,
        entries,
        plannedMinutes: plannedTotal,
        spentMinutes: spent,
        overBudget: plannedTotal > 0 && spent > plannedTotal,
      })
    }
    return result
  }, [view, schedule, coursesById, todayIso])

  function shiftMonth(delta: number) {
    setSelectedIso(null)
    setView(([year, month]) => {
      const total = year * 12 + month + delta
      return [Math.floor(total / 12), (((total % 12) + 12) % 12)]
    })
  }

  function backToToday() {
    setSelectedIso(null)
    setView([today.getFullYear(), today.getMonth()])
  }

  function toggleSelected(iso: string) {
    setSelectedIso((current) => (current === iso ? null : iso))
  }

  const isViewingCurrentMonth = view[0] === today.getFullYear() && view[1] === today.getMonth()
  const todayCell = cells.find((cell) => cell.isToday)
  const selectedCell = selectedIso ? cells.find((cell) => cell.iso === selectedIso) ?? null : null

  const examCountdown = schedule.nearestExam
    ? Math.round((schedule.nearestExam.date.getTime() - today.getTime()) / 86_400_000)
    : null

  if (courses.length === 0) {
    return (
      <div className="module-page empty-module">
        <CalendarDays size={32} />
        <h1>还没有课程</h1>
        <p>先创建课程并生成复习策略，再回到这里查看全部课程的复习节奏。</p>
      </div>
    )
  }

  if (!hasPlan && !loadingExtra) {
    return (
      <div className="module-page empty-module">
        <CalendarDays size={32} />
        <h1>尚未生成复习计划</h1>
        <p>先在「资料库」为课程生成复习策略后，再回到这里查看全部课程的月度规划。</p>
      </div>
    )
  }

  return (
    <div className="module-page planning-page">
      <section className="page-heading-row">
        <div>
          <p className="page-kicker"><CalendarDays size={15} /> 月度规划</p>
          <h1>全部课程 · 复习节奏</h1>
          <p>按日历查看每天要复习的课程与计划时长。每门课程用一种颜色，考试以红色块标注。</p>
        </div>
        <div className="planning-toolbar">
          <button className="icon-button" type="button" aria-label="上一月" onClick={() => shiftMonth(-1)}>
            <ChevronLeft size={18} />
          </button>
          <span className="planning-month-label">{view[0]} 年 {MONTH_LABELS[view[1]]}</span>
          <button className="icon-button" type="button" aria-label="下一月" onClick={() => shiftMonth(1)}>
            <ChevronRight size={18} />
          </button>
          <button
            className="secondary-button"
            type="button"
            disabled={isViewingCurrentMonth}
            onClick={backToToday}
          >
            回到本月
          </button>
        </div>
      </section>

      <section className="planning-summary">
        {todayCell && (
          <span>
            今日 <b>{todayCell.entries.length}</b> 门课程 · 计划 <b>{todayCell.plannedMinutes}</b>′
            {todayCell.spentMinutes > 0 && (
              <> · 已投入 <b>{todayCell.spentMinutes}</b>′</>
            )}
          </span>
        )}
        {overdueTotal > 0 && (
          <span className="planning-summary-warn">
            <b>{overdueTotal}</b> 项逾期
          </span>
        )}
        {examCountdown !== null && (
          <span>
            {examCountdown > 0
              ? <>距 <b>{schedule.nearestExam?.course.name}</b> 考试还有 <b>{examCountdown}</b> 天</>
              : examCountdown === 0
                ? <>今天有考试</>
                : <>最近的考试已结束</>}
          </span>
        )}
        {loadingExtra && (
          <span className="planning-summary-loading">
            <LoaderCircle size={12} className="planning-summary-spinner" /> 正在加载其余课程…
          </span>
        )}
      </section>

      <section className="planning-calendar" aria-label="全部课程月度日历">
        <div className="planning-weekdays">
          {WEEKDAY_LABELS.map((label) => (
            <span className="planning-weekday" key={label}>{label}</span>
          ))}
        </div>
        <div className="planning-grid">
          {cells.map((cell) => {
            const visible = cell.entries.slice(0, VISIBLE_ENTRIES)
            const hiddenCount = cell.entries.length - visible.length
            const investRatio = cell.plannedMinutes > 0
              ? Math.min(cell.spentMinutes / cell.plannedMinutes, 1)
              : (cell.spentMinutes > 0 ? 1 : 0)
            const showInvest = cell.spentMinutes > 0 || cell.plannedMinutes > 0
            const isSelected = selectedIso === cell.iso
            return (
              <div
                key={cell.iso}
                className={[
                  'planning-day-cell',
                  cell.inMonth ? '' : 'is-muted',
                  cell.isToday ? 'is-today' : '',
                  isSelected ? 'is-selected' : '',
                ].join(' ').trim()}
                title={buildCellTooltip(cell)}
                role="button"
                tabIndex={0}
                onClick={() => toggleSelected(cell.iso)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    toggleSelected(cell.iso)
                  }
                }}
              >
                <span className={`planning-day-num${cell.isToday ? ' is-today' : ''}`}>{cell.date.getDate()}</span>

                {visible.length > 0 && (
                  <div className="planning-entry-list">
                    {visible.map((entry) => (
                      <CourseEventChip key={entry.isExam ? `${entry.course.id}-exam` : entry.course.id} entry={entry} />
                    ))}
                    {hiddenCount > 0 && (
                      <span className="planning-task-overflow">+{hiddenCount} 门</span>
                    )}
                  </div>
                )}

                {showInvest && (
                  <span
                    className="planning-day-invest"
                    data-over={cell.overBudget ? 'true' : 'false'}
                  >
                    <span
                      className="planning-day-invest-fill"
                      style={{ width: `${Math.round(investRatio * 100)}%` }}
                    />
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </section>

      {selectedCell && (
        <section className="planning-day-detail" aria-label={`当天详情 ${selectedCell.iso}`}>
          <header className="planning-day-detail-head">
            <div className="planning-day-detail-title">
              <h3>{selectedCell.iso.replace(/-/g, '/')} 周{CN_WEEKDAY[selectedCell.date.getDay()]}</h3>
              <p>
                {selectedCell.entries.length > 0
                  ? <>{selectedCell.entries.length} 门课程 · 计划 <b>{selectedCell.plannedMinutes}</b>′ · 实际 <b>{selectedCell.spentMinutes}</b>′</>
                  : '当天无复习安排'}
              </p>
            </div>
            <button
              className="icon-button"
              type="button"
              aria-label="关闭当天详情"
              onClick={() => setSelectedIso(null)}
            >
              <X size={16} />
            </button>
          </header>

          {selectedCell.entries.length > 0 && (
            <ul className="planning-day-detail-list">
              {selectedCell.entries.map((entry) => (
                <li key={entry.isExam ? `${entry.course.id}-exam` : entry.course.id} className="planning-day-detail-task">
                  <CourseEventChip entry={entry} />
                  <p className="planning-day-detail-desc">
                    {entry.isExam
                      ? `${entry.course.name} 考试日（${entry.course.examDate}）`
                      : `计划复习 ${entry.plannedMinutes} 分钟`}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="planning-legend">
        <span><i className="planning-legend-dots" /> 每门课程一种颜色</span>
        <span><i className="planning-legend-exam" /> 考试</span>
        <span><i className="planning-legend-today" /> 今天</span>
      </section>
    </div>
  )
}
