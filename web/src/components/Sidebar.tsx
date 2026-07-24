import {
  Braces,
  CircleCheck,
  ClipboardList,
  Database,
  ArchiveRestore,
  FileArchive,
  FileText,
  Grid2X2,
  Orbit,
  Plus,
  Sigma,
  SquarePen,
  Settings2,
  Target,
  Trash2,
  X,
} from 'lucide-react'
import type { Course, LearningModule } from '../types'

type MainNavigationProps = {
  activeModule: LearningModule
  onModuleChange: (module: LearningModule) => void
}

type CoursePanelProps = {
  courses: Course[]
  activeCourseId: string
  onSelectCourse: (course: Course) => void
  onDeleteCourse: (course: Course) => void
  onNewCourse: () => void
  isOpen: boolean
  onClose: () => void
}

const moduleItems: { id: LearningModule; label: string; icon: typeof CircleCheck }[] = [
  { id: 'overview', label: '总览', icon: Grid2X2 },
  { id: 'materials', label: '资料库', icon: FileArchive },
  { id: 'strategy', label: '复习策略', icon: FileText },
  { id: 'plan', label: '复习主线', icon: CircleCheck },
  { id: 'practice', label: '刷题', icon: Target },
  { id: 'mock', label: '模拟卷', icon: ClipboardList },
  { id: 'notes', label: '笔记', icon: SquarePen },
  { id: 'errors', label: '错题本', icon: FileText },
  { id: 'archive', label: '归档', icon: ArchiveRestore },
]

function CourseGlyph({ course }: { course: Course }) {
  const iconProps = { size: 19, strokeWidth: 2.2 }
  switch (course.icon) {
    case 'code':
      return <Braces {...iconProps} />
    case 'physics':
      return <Orbit {...iconProps} />
    case 'math':
      return <Sigma {...iconProps} />
    case 'english':
      return <span className="course-letter">Aa</span>
    case 'system':
      return <Database {...iconProps} />
    default:
      return <Grid2X2 {...iconProps} />
  }
}

export function MainNavigation({ activeModule, onModuleChange }: MainNavigationProps) {
  return (
    <aside className="main-navigation">
      <button className="brand-button" type="button" aria-label="返回课程总览" onClick={() => onModuleChange('overview')}>
        <span className="brand-mark" aria-hidden="true"></span>
        <span className="brand-name">期末粥<br />加速器</span>
      </button>

      <div className="nav-section">
        <span className="nav-section-label">学习</span>
        {moduleItems.map((item) => {
          const Icon = item.icon
          return (
            <button
              className={`nav-item ${activeModule === item.id ? 'is-active' : ''}`}
              key={item.id}
              type="button"
              title={item.label}
              onClick={() => onModuleChange(item.id)}
            >
              <Icon size={20} />
              <span>{item.label}</span>
            </button>
          )
        })}
      </div>

      <div className="nav-bottom">
        <button
          className={`nav-item ${activeModule === 'settings' ? 'is-active' : ''}`}
          type="button"
          title="设置"
          onClick={() => onModuleChange('settings')}
        >
          <Settings2 size={20} />
          <span>设置</span>
        </button>
      </div>
    </aside>
  )
}

export function CoursePanel({
  courses,
  activeCourseId,
  onSelectCourse,
  onDeleteCourse,
  onNewCourse,
  isOpen,
  onClose,
}: CoursePanelProps) {
  return (
    <aside className={`course-panel ${isOpen ? 'is-open' : ''}`}>
      <header className="course-panel-header">
        <div>
          <span className="eyebrow">课程空间</span>
          <h2>我的课程 <small>({courses.length})</small></h2>
        </div>
        <button className="icon-button close-course-panel" type="button" aria-label="关闭课程列表" onClick={onClose}>
          <X size={18} />
        </button>
        <button className="add-course-button" type="button" aria-label="新建课程" onClick={onNewCourse}>
          <Plus size={19} />
        </button>
      </header>

      <div className="course-list">
        {courses.map((course) => (
          <article
            className={`course-card ${course.id === activeCourseId ? 'is-selected' : ''}`}
            key={course.id}
          >
            <button className="course-card-select" type="button" onClick={() => onSelectCourse(course)}>
              <span className="course-card-icon">
                <CourseGlyph course={course} />
              </span>
              <span className="course-card-content">
                <span className="course-card-title">{course.name}</span>
                <span className="course-card-meta">{course.examDate} <i></i> 目标 {course.targetScore} 分</span>
                <span className="course-progress">
                  <span style={{ width: `${course.progress}%` }}></span>
                </span>
                <span className="course-card-footer">
                  <span>每日可用 {course.dailyHours} 小时</span>
                  <b>{course.progress}%</b>
                </span>
              </span>
            </button>
            <button
              className="course-delete-button"
              type="button"
              title={`删除 ${course.name}`}
              aria-label={`删除 ${course.name}`}
              onClick={() => onDeleteCourse(course)}
            >
              <Trash2 size={15} />
            </button>
          </article>
        ))}
      </div>
    </aside>
  )
}
