import { useEffect, useRef, useState } from 'react'
import type { User } from 'firebase/auth'
import { accountIdAvailable, claimAccountId, normalizeAccountId, validAccountId } from '../lib/account'

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
    const timer = window.setTimeout(() => accountIdAvailable(id).then((available) => { if (active) setState(available ? 'available' : 'taken') }).catch(() => { if (active) setError('IDを確認できませんでした。通信状態を確認してください') }), 350)
    return () => { active = false; window.clearTimeout(timer) }
  }, [value])
  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (state !== 'available' || saving) return
    setSaving(true); setError('')
    try { onRegistered(await claimAccountId(user, value)) }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'IDを登録できませんでした'); setState('taken') }
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
