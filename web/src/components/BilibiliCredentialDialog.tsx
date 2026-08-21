import { useState } from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle2, CircleAlert, KeyRound, LoaderCircle, RefreshCw, Save, X } from 'lucide-react'
import {
  clearBilibiliCredentials,
  saveBilibiliCredentials,
  verifyBilibiliCredentials,
} from '../apiClient'
import type { BilibiliCredentialStatus, BilibiliCredentialVerifyResult } from '../types'

type BilibiliCredentialDialogProps = {
  status: BilibiliCredentialStatus | null
  onClose: () => void
  onSaved: () => void
}

export function BilibiliCredentialDialog({ status, onClose, onSaved }: BilibiliCredentialDialogProps) {
  const [form, setForm] = useState({ sessdata: '', biliJct: '', dedeuserid: '' })
  const [action, setAction] = useState<'idle' | 'saving' | 'verifying' | 'clearing'>('idle')
  const [message, setMessage] = useState('')
  const [verifyResult, setVerifyResult] = useState<BilibiliCredentialVerifyResult | null>(null)
  const isBusy = action !== 'idle'
  const canSave = form.sessdata.trim() && form.biliJct.trim() && form.dedeuserid.trim() && !isBusy

  async function save() {
    setAction('saving')
    setMessage('')
    setVerifyResult(null)
    try {
      await saveBilibiliCredentials({
        sessdata: form.sessdata.trim(),
        biliJct: form.biliJct.trim(),
        dedeuserid: form.dedeuserid.trim(),
      })
      setForm({ sessdata: '', biliJct: '', dedeuserid: '' })
      onSaved()
      setAction('verifying')
      setMessage('已保存到本机。正在验证登录状态…（首次验证需拉起 npx 进程，可能等待约一分钟）')
      const result = await runVerify()
      if (result) setMessage('')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '凭据保存失败。')
    } finally {
      setAction('idle')
    }
  }

  async function runVerify(): Promise<BilibiliCredentialVerifyResult | null> {
    setAction('verifying')
    try {
      const result = await verifyBilibiliCredentials()
      setVerifyResult(result)
      return result
    } catch (error) {
      const fallback: BilibiliCredentialVerifyResult = {
        loggedIn: null,
        message: error instanceof Error ? error.message : '凭据校验失败。',
        nextSteps: [],
      }
      setVerifyResult(fallback)
      return fallback
    } finally {
      setAction('idle')
    }
  }

  async function clearCredentials() {
    setAction('clearing')
    setMessage('')
    setVerifyResult(null)
    try {
      await clearBilibiliCredentials()
      onSaved()
      setMessage('已清除本机保存的 B 站凭据。')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '凭据清除失败。')
    } finally {
      setAction('idle')
    }
  }

  return createPortal(
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="bilibili-credential-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Bilibili 登录凭据"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="bilibili-credential-heading">
          <div className="settings-heading-icon"><KeyRound size={19} /></div>
          <div>
            <h2>Bilibili 登录凭据</h2>
            <p>导入 B 站视频（字幕/简介）需要登录态 Cookie，只保存在本机后端，不会显示或上传。</p>
          </div>
          <button className="icon-button" type="button" aria-label="关闭" onClick={onClose}><X size={17} /></button>
        </header>

        <div className="bilibili-credential-current">
          {status?.configured
            ? <><CheckCircle2 size={15} /> 本机已保存凭据（覆盖旧配置）</>
            : status?.source === 'global_config'
              ? <><CircleAlert size={15} /> 检测到终端配置的旧凭据（可能已过期），保存后将覆盖</>
              : <><CircleAlert size={15} /> 尚未配置，导入 B 站视频前需先填写</>}
        </div>

        <ol className="bilibili-credential-steps">
          <li>浏览器登录 <a href="https://www.bilibili.com" target="_blank" rel="noreferrer">bilibili.com</a>，按 F12 打开开发者工具</li>
          <li>切到 <strong>Application（应用）</strong> → <strong>Cookies</strong> → <code>https://www.bilibili.com</code></li>
          <li>找到下面三个 Cookie，逐个双击值列复制后粘贴到对应输入框</li>
        </ol>

        <div className="model-form-grid bilibili-credential-form">
          <label className="settings-field settings-field-wide">
            <span>SESSDATA</span>
            <input
              type="password"
              autoComplete="off"
              value={form.sessdata}
              placeholder="例如：6%2Cab…（一长串）"
              onChange={(event) => setForm((current) => ({ ...current, sessdata: event.target.value }))}
            />
          </label>
          <label className="settings-field">
            <span>bili_jct（32 位 CSRF）</span>
            <input
              type="password"
              autoComplete="off"
              value={form.biliJct}
              placeholder="32 位十六进制字符串"
              onChange={(event) => setForm((current) => ({ ...current, biliJct: event.target.value }))}
            />
          </label>
          <label className="settings-field">
            <span>DedeUserID（UID）</span>
            <input
              type="password"
              autoComplete="off"
              value={form.dedeuserid}
              placeholder="纯数字"
              onChange={(event) => setForm((current) => ({ ...current, dedeuserid: event.target.value }))}
            />
          </label>
        </div>

        {message && <p className="embedding-inline-note">{message}</p>}
        {verifyResult && (
          <div className={`bilibili-credential-verify ${verifyResult.loggedIn === true ? 'is-ok' : verifyResult.loggedIn === false ? 'is-bad' : ''}`}>
            {verifyResult.loggedIn === true
              ? <CheckCircle2 size={15} />
              : <CircleAlert size={15} />}
            <span>{verifyResult.message || (verifyResult.loggedIn ? '登录有效' : '登录无效')}</span>
          </div>
        )}

        <div className="settings-actions">
          {status?.configured && (
            <button className="secondary-button bilibili-credential-clear" type="button" disabled={isBusy} onClick={clearCredentials}>
              {action === 'clearing' ? <LoaderCircle className="is-spinning" size={16} /> : <X size={16} />}
              清除凭据
            </button>
          )}
          {status?.configured && (
            <button className="secondary-button" type="button" disabled={isBusy} onClick={runVerify}>
              <RefreshCw className={action === 'verifying' ? 'is-spinning' : ''} size={16} /> 重新验证
            </button>
          )}
          <button className="primary-button" type="button" disabled={!canSave} onClick={save}>
            {action === 'saving' ? <LoaderCircle className="is-spinning" size={16} /> : <Save size={16} />}
            保存并验证
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
