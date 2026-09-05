import { useEffect, useRef, useState } from 'react'
import type { User } from 'firebase/auth'
import { accountIdAvailable, claimAccountId, normalizeAccountId, validAccountId } from '../lib/account'

function accountIdErrorMessage(caught: unknown, action: 'check' | 'save') {
  const code = typeof caught === 'object' && caught && 'code' in caught ? String(caught.code) : ''
  if (code.includes('permission-denied')) return 'ID管理の利用権限を確認できませんでした。管理者にFirestore設定の確認を依頼してください。'
  if (code.includes('unavailable') || code.includes('network-request-failed')) return 'Firebaseに接続できませんでした。通信状態を確認して、もう一度お試しください。'
  if (caught instanceof Error && caught.message) return caught.message
  return action === 'check' ? 'IDを確認できませんでした。もう一度お試しください。' : 'IDを登録できませんでした。もう一度お試しください。'
}

export function AccountIdGate({ user, onRegistered, onLogout }: { user: User; onRegistered: (accountId: string) => void; onLogout: () => void }) {
  const [value, setValue] = useState('')
  const [state, setState] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { input.current?.focus() }, [])
  useEffect(() => {
    const id = normalizeAccountId(value)
    setError('')
    if (!validAccountId(id)) { setState('idle'); return }
    let active = true
    setState('checking')
    const timer = window.setTimeout(() => accountIdAvailable(id).then((available) => { if (active) setState(available ? 'available' : 'taken') }).catch((caught) => {
      if (!active) return
      setState('idle')
      setError(accountIdErrorMessage(caught, 'check'))
    }), 350)
    return () => { active = false; window.clearTimeout(timer) }
  }, [value])
  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (state !== 'available' || saving) return
    setSaving(true); setError('')
    try { onRegistered(await claimAccountId(user, value)) }
    catch (caught) { setError(accountIdErrorMessage(caught, 'save')); setState('idle') }
    finally { setSaving(false) }
  }
  return <div className="account-id-gate" role="dialog" aria-modal="true" aria-labelledby="account-id-title">
    <form onSubmit={submit}>
      <p className="eyebrow">WELCOME TO TOUGE</p><h1 id="account-id-title">アカウントIDを決める</h1>
      <p>あなたを識別する一意のIDです。フレンド検索などに使用します。登録後は変更できません。</p>
      <label>アカウントID<div className={`account-id-input ${state}`}><span>@</span><input ref={input} value={value} onChange={(event) => setValue(event.target.value)} autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={20} placeholder="touge_driver" /></div></label>
      <small>3〜20文字。半角英小文字、数字、_、- が使えます。</small>
      {state === 'checking' && <p className="account-id-status" role="status">使用できるか確認中…</p>}
      {state === 'available' && <p className="account-id-status ok" role="status">@{normalizeAccountId(value)} は使用できます</p>}
      {state === 'taken' && <p className="account-id-status error" role="alert">このIDはすでに使われています</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="button primary" disabled={state !== 'available' || saving}>{saving ? '登録中…' : 'このIDで登録'}</button>
      <button className="text-button" type="button" onClick={onLogout}>別のアカウントでログイン</button>
    </form>
  </div>
}
