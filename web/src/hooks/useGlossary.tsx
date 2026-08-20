/** 课程术语词条状态：拉取 glossary → 注册到匹配器；refresh 轮询 job；渲染词条卡浮层。 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { GlossaryStatus, GlossaryTerm } from '../types'
import { getAgentJob, getCourseGlossary, refreshCourseGlossary } from '../apiClient'
import { clearGlossaryTerms, setActiveGlossaryTerms } from '../glossary/termMatcher'
import GlossaryTermCard from '../components/GlossaryTermCard'

type GlossaryContextValue = {
  terms: GlossaryTerm[]
  status: GlossaryStatus | null
  activeTermId: string | null
  openTerm: (termId: string) => void
  closeTerm: () => void
  refresh: () => Promise<void>
}

const GlossaryContext = createContext<GlossaryContextValue | null>(null)

export function useGlossary(): GlossaryContextValue {
  const context = useContext(GlossaryContext)
  if (!context) {
    // FormulaText 在 React 树内被渲染时必然处于 Provider 之下；防御性兜底
    return { terms: [], status: null, activeTermId: null, openTerm: () => {}, closeTerm: () => {}, refresh: async () => {} }
  }
  return context
}

export function GlossaryProvider({ courseId, children }: { courseId: string | null; children: ReactNode }) {
  const [terms, setTerms] = useState<GlossaryTerm[]>([])
  const [status, setStatus] = useState<GlossaryStatus | null>(null)
  const [activeTermId, setActiveTermId] = useState<string | null>(null)
  const [glossaryJobId, setGlossaryJobId] = useState<string | null>(null)
  const pollTimerRef = useRef<number | null>(null)

  const loadGlossary = useCallback(async (id: string) => {
    try {
      const response = await getCourseGlossary(id)
      setTerms(response.terms)
      setStatus(response.status)
      setActiveGlossaryTerms(response.terms)
    } catch {
      setTerms([])
      setStatus(null)
      clearGlossaryTerms()
    }
  }, [])

  useEffect(() => {
    if (courseId) {
      loadGlossary(courseId)
    } else {
      setTerms([])
      setStatus(null)
      clearGlossaryTerms()
    }
  }, [courseId, loadGlossary])

  useEffect(() => {
    return () => {
      if (pollTimerRef.current) window.clearInterval(pollTimerRef.current)
    }
  }, [])

  const refresh = useCallback(async () => {
    if (!courseId || glossaryJobId) return
    try {
      const { jobId } = await refreshCourseGlossary(courseId)
      setGlossaryJobId(jobId)
      const poll = window.setInterval(async () => {
        try {
          const job = await getAgentJob(jobId)
          if (job.status === 'completed' || job.status === 'failed') {
            window.clearInterval(poll)
            pollTimerRef.current = null
            setGlossaryJobId(null)
            await loadGlossary(courseId)
          }
        } catch {
          window.clearInterval(poll)
          pollTimerRef.current = null
          setGlossaryJobId(null)
        }
      }, 1800)
      pollTimerRef.current = poll
    } catch {
      setGlossaryJobId(null)
    }
  }, [courseId, glossaryJobId, loadGlossary])

  const openTerm = useCallback((termId: string) => setActiveTermId(termId), [])
  const closeTerm = useCallback(() => setActiveTermId(null), [])

  const activeTerm = useMemo(() => terms.find((term) => term.id === activeTermId) ?? null, [terms, activeTermId])

  const value = useMemo(
    () => ({ terms, status, activeTermId, openTerm, closeTerm, refresh }),
    [terms, status, activeTermId, openTerm, closeTerm, refresh],
  )

  return (
    <GlossaryContext.Provider value={value}>
      {children}
      {activeTerm ? <GlossaryTermCard term={activeTerm} onClose={closeTerm} /> : null}
    </GlossaryContext.Provider>
  )
}
