import { type FormEvent, type PointerEvent as ReactPointerEvent, useState } from 'react'
import { Bot, Check, MessageCircle, PanelRightClose, PanelRightOpen, Send, Sparkles, X } from 'lucide-react'
import rehypeKatex from 'rehype-katex'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import 'katex/dist/katex.min.css'
import type { AdjustmentProposal, Course, ModelProfile, StudyMessage } from '../types'

type AiCompanionProps = {
  className?: string
  course: Course
  messages: StudyMessage[]
  proposal: AdjustmentProposal | null
  modelProfile: ModelProfile
  isCollapsed: boolean
  onClose: () => void
  onToggleCollapse: () => void
  onResizeStart: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onApplyProposal: () => void
  onDismissProposal: () => void
  onSendMessage: (message: string) => Promise<void>
}

type CompanionMode = 'chat' | 'agent'

const agentPrompts = [
  '检查今天的复习计划',
  '根据错题调整接下来的安排',
  '帮我生成一轮考前冲刺动作',
]

const bareLatexCommandPattern = /\\(?:cap|cup|setminus|overline|underline|frac|dfrac|tfrac|sqrt|times|cdot|div|pm|mp|leq?|geq?|neq|approx|equiv|in|notin|subset(?:eq)?|supset(?:eq)?|emptyset|forall|exists|neg|land|lor|Rightarrow|Leftrightarrow|sum|prod|int|lim|alpha|beta|gamma|delta|theta|lambda|mu|pi|sigma|phi|omega)\b/
const cjkPattern = /[\u3400-\u9fff]/

function formatAssistantContent(content: string) {
  const normalized = content
    .replace(/\r\n?/g, '\n')
    .replace(/\\\[((?:.|\n)*?)\\\]/g, (_, formula: string) => `\n\n$$\n${formula.trim()}\n$$\n\n`)
    .replace(/\\\((.+?)\\\)/g, (_, formula: string) => `$${formula.trim()}$`)
    .replace(/\*\*contentRefreshRecommended=true\*\*/g, '**资料已更新**')
    .replace(/contentRefreshRecommended=true/g, '资料已更新')
    .replace(/\s+---\s+(?=#{2,6}\s+)/g, '\n\n---\n\n')
    .replace(/\s+(#{2,6}\s+)/g, '\n\n$1')
    .replace(/\n{3,}/g, '\n\n')

  let insideCodeFence = false
  let insideMathBlock = false
  return normalized
    .split('\n')
    .map((line) => {
      const trimmed = line.trim()
      if (trimmed.startsWith('```')) {
        insideCodeFence = !insideCodeFence
        return line
      }
      if (!insideCodeFence && trimmed === '$$') {
        insideMathBlock = !insideMathBlock
        return line
      }
      if (insideCodeFence || insideMathBlock || !trimmed || trimmed.includes('$')) return line

      const listItem = line.match(/^(\s*(?:[-*+]|\d+[.)])\s+)(.+)$/)
      const prefix = listItem?.[1] ?? line.slice(0, line.length - line.trimStart().length)
      const formula = (listItem?.[2] ?? trimmed).trim()
      if (bareLatexCommandPattern.test(formula) && !cjkPattern.test(formula)) {
        return `${prefix}$${formula}$`
      }
      return line
    })
    .join('\n')
    .trim()
}

export function AiCompanion({
  className = '',
  course,
  messages,
  proposal,
  modelProfile,
  isCollapsed,
  onClose,
  onToggleCollapse,
  onResizeStart,
  onApplyProposal,
  onDismissProposal,
  onSendMessage,
}: AiCompanionProps) {
  const [mode, setMode] = useState<CompanionMode>('chat')
  const [input, setInput] = useState('')
  const [isSending, setIsSending] = useState(false)
  const canSend = input.trim().length > 0 && !isSending
  const panelClassName = ['ai-panel', isCollapsed ? 'is-collapsed' : '', className].filter(Boolean).join(' ')

  async function sendMessage() {
    const trimmed = input.trim()
    if (!trimmed || isSending) return

    setIsSending(true)
    try {
      await onSendMessage(trimmed)
      setInput('')
    } finally {
      setIsSending(false)
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void sendMessage()
  }

  return (
    <aside className={panelClassName} aria-label="AI 伴学">
      <button
        className="ai-resize-handle"
        type="button"
        aria-label="拖拽调整 AI 伴学宽度"
        title="拖拽调整 AI 伴学宽度"
        onPointerDown={onResizeStart}
      />

      <div className="ai-collapsed-rail">
        <button
          className="icon-button ai-expand-button"
          type="button"
          aria-label="展开 AI 伴学"
          title="展开 AI 伴学"
          onClick={onToggleCollapse}
        >
          <PanelRightOpen size={18} />
        </button>
        <div className="ai-collapsed-brand">
          <span className="ai-avatar"><Bot size={18} /></span>
          <span>AI<br />伴学</span>
        </div>
      </div>

      <header className="ai-panel-header">
        <div>
          <span className="ai-avatar"><Bot size={18} /></span>
          <div>
            <h2>AI 伴学</h2>
            <span>{modelProfile.status === 'connected' ? modelProfile.model : '未配置模型'} · {course.name}</span>
          </div>
        </div>
        <div className="ai-panel-actions">
          <button
            className="icon-button ai-collapse-toggle"
            type="button"
            aria-label="收起 AI 伴学"
            title="收起 AI 伴学"
            aria-expanded={!isCollapsed}
            onClick={onToggleCollapse}
          >
            <PanelRightClose size={17} />
          </button>
          <button className="icon-button ai-close" type="button" aria-label="关闭 AI 伴学" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
      </header>

      <div className="ai-mode-switch" role="tablist" aria-label="伴学模式">
        <button
          className={mode === 'chat' ? 'is-active' : ''}
          type="button"
          role="tab"
          aria-selected={mode === 'chat'}
          onClick={() => setMode('chat')}
        >
          <MessageCircle size={14} />
          <span>Chat</span>
        </button>
        <button
          className={mode === 'agent' ? 'is-active' : ''}
          type="button"
          role="tab"
          aria-selected={mode === 'agent'}
          onClick={() => setMode('agent')}
        >
          <Sparkles size={14} />
          <span>Agent</span>
        </button>
      </div>

      <div className="ai-scroll">
        <section className={`companion-card ${mode === 'agent' ? 'is-agent-mode' : ''}`}>
          <div className="companion-orb">
            {mode === 'chat' ? <Bot size={37} /> : <Sparkles size={37} />}
          </div>
          {mode === 'chat' ? (
            <>
              <strong>晚好，冲刺的你很棒！</strong>
              <p>我会根据你的资料、作答和时间安排，让每一段复习都更值钱。</p>
            </>
          ) : (
            <>
              <strong>Agent 模式已待命</strong>
              <p>我会把资料、计划和错题串起来，给你拆成下一步可以执行的动作。</p>
            </>
          )}
        </section>

        {mode === 'chat' ? (
          <section className="chat-history" aria-label="AI 对话记录">
            {messages.map((message) => (
              <article className={`chat-message ${message.role === 'user' ? 'is-user' : ''}`} key={message.id}>
                {message.role === 'assistant' ? (
                  <div className="chat-markdown">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm, remarkMath]}
                      rehypePlugins={[rehypeKatex]}
                    >
                      {formatAssistantContent(message.content)}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <p>{message.content}</p>
                )}
                <time>{message.createdAt}</time>
              </article>
            ))}
          </section>
        ) : (
          <section className="agent-workbench" aria-label="Agent 操作">
            <div className="agent-workbench-heading">
              <Sparkles size={18} />
              <div>
                <span>行动入口</span>
                <strong>让 Agent 接管一段复习任务</strong>
              </div>
            </div>
            <div className="agent-prompt-grid">
              {agentPrompts.map((prompt) => (
                <button type="button" key={prompt} onClick={() => setInput(prompt)}>
                  {prompt}
                </button>
              ))}
            </div>
          </section>
        )}

        {mode === 'agent' && proposal && proposal.status === 'pending' && (
          <section className="proposal-card">
            <div className="proposal-heading">
              <Sparkles size={18} />
              <div>
                <span>调整提案</span>
                <strong>{proposal.title}</strong>
              </div>
            </div>
            <p>{proposal.reason}</p>
            <div className="proposal-impact">{proposal.impact}</div>
            <div className="proposal-actions">
              <button className="primary-button" type="button" onClick={onApplyProposal}>
                <Check size={16} /> 确认调整
              </button>
              <button className="secondary-button" type="button" onClick={onDismissProposal}>
                暂不应用
              </button>
            </div>
          </section>
        )}

        {mode === 'agent' && proposal?.status === 'applied' && (
          <section className="applied-proposal">
            <Check size={17} />
            <span>已应用：{proposal.title}</span>
          </section>
        )}
      </div>

      <form className="ai-input" onSubmit={handleSubmit}>
        <input
          value={input}
          placeholder={mode === 'chat' ? '和我聊聊复习卡点...' : '让 Agent 检查计划、错题或资料...'}
          aria-label="输入给 AI 伴学的消息"
          onChange={(event) => setInput(event.target.value)}
        />
        <button type="submit" aria-label={mode === 'chat' ? '发送 Chat 消息' : '发送 Agent 指令'} disabled={!canSend}>
          <Send size={17} />
        </button>
      </form>
    </aside>
  )
}
