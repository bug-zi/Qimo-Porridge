/** 完整词条卡浮层：维基式阐述（KaTeX）+ 考法 + 易错点 + 关联知识点。 */
import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { X } from 'lucide-react'
import type { GlossaryTerm } from '../types'
import { glossaryMarkdownComponents } from '../glossary/termMatcher'

export default function GlossaryTermCard({ term, onClose }: { term: GlossaryTerm; onClose: () => void }) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return createPortal(
    <div className="glossary-term-card-overlay" onClick={onClose}>
      <section
        className="glossary-term-card"
        onClick={(event) => event.stopPropagation()}
        onWheel={(event) => event.stopPropagation()}
      >
        <header className="glossary-term-card-header">
          <div>
            <h3>{term.term}</h3>
            {term.aliases.length ? (
              <div className="glossary-term-card-aliases">
                {term.aliases.map((alias) => (
                  <span key={alias}>{alias}</span>
                ))}
              </div>
            ) : null}
          </div>
          <div className="glossary-term-card-actions">
            <span className={`glossary-term-card-badge ${term.importance}`}>
              {term.importance === 'core' ? '核心' : '拓展'}
            </span>
            <button type="button" onClick={onClose} aria-label="关闭词条卡">
              <X size={16} />
            </button>
          </div>
        </header>
        <div className="glossary-term-card-body">
          <p className="glossary-term-card-one-liner">{term.oneLiner}</p>
          {term.article ? (
            <div className="glossary-term-card-article">
              <Markdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} components={glossaryMarkdownComponents()}>
                {term.article}
              </Markdown>
            </div>
          ) : null}
          {term.examTips.length ? (
            <div className="glossary-term-card-section">
              <h4>考试考法</h4>
              <ul>
                {term.examTips.map((tip) => (
                  <li key={tip}>{tip}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {term.pitfalls.length ? (
            <div className="glossary-term-card-section">
              <h4>易错点</h4>
              <ul>
                {term.pitfalls.map((pitfall) => (
                  <li key={pitfall}>{pitfall}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </section>
    </div>,
    document.body,
  )
}
