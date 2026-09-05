import { useEffect, useState } from 'react'
import type { FriendList } from '../types'

interface Props {
  lists: FriendList[]
  friendIds: string[]
  friendName: (id: string) => string
  onSave: (lists: FriendList[]) => Promise<void>
}

type View = 'list' | 'create' | 'detail'

export function FriendListsPanel({ lists, friendIds, friendName, onSave }: Props) {
  const [view, setView] = useState<View>('list')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const [draftMemberIds, setDraftMemberIds] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const selected = lists.find((list) => list.id === selectedId)

  useEffect(() => {
    if (view === 'detail' && !selected) {
      setView('list')
      setSelectedId(null)
    }
  }, [selected, view])

  function openCreate() {
    setDraftName('')
    setDraftMemberIds([])
    setError('')
    setConfirmDelete(false)
    setView('create')
  }

  function openDetail(list: FriendList) {
    setSelectedId(list.id)
    setDraftName(list.name)
    setDraftMemberIds(list.memberIds)
    setError('')
    setConfirmDelete(false)
    setView('detail')
  }

  function closeEditor() {
    setView('list')
    setSelectedId(null)
    setConfirmDelete(false)
    setError('')
  }

  function toggleMember(id: string) {
    setDraftMemberIds((ids) => ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id])
  }

  async function commit() {
    const name = draftName.trim()
    if (!name) { setError('リスト名を入力してください'); return }
    const memberIds = [...new Set(draftMemberIds)].filter((id) => friendIds.includes(id))
    const next = view === 'create'
      ? [...lists, { id: crypto.randomUUID(), name, memberIds }]
      : lists.map((list) => list.id === selectedId ? { ...list, name, memberIds } : list)
    setBusy(true); setError('')
    try { await onSave(next); closeEditor() }
    catch { setError('フレンドリストを保存できませんでした。接続状態を確認してください') }
    finally { setBusy(false) }
  }

  async function removeSelected() {
    if (!selected) return
    setBusy(true); setError('')
    try { await onSave(lists.filter((list) => list.id !== selected.id)); closeEditor() }
    catch { setError('フレンドリストを削除できませんでした。接続状態を確認してください') }
    finally { setBusy(false) }
  }

  if (view === 'list') return <section className="friend-list-manager" aria-labelledby="friend-lists-title">
    <header className="friend-list-manager-heading"><div><p className="eyebrow">SHARING LISTS</p><h3 id="friend-lists-title">フレンドリスト</h3><p>コースや現在地を共有する相手を、グループごとに管理できます。</p></div><button type="button" className="button primary friend-list-create-button" onClick={openCreate}><span aria-hidden="true">＋</span> 新規作成</button></header>
    {lists.length ? <div className="friend-list-cards">{lists.map((list) => <button type="button" className="friend-list-card" key={list.id} onClick={() => openDetail(list)}><span className="friend-list-icon" aria-hidden="true">{list.name.slice(0, 1)}</span><span><strong>{list.name}</strong><small>{list.memberIds.length ? `${list.memberIds.length}人のフレンド` : 'メンバー未設定'}</small></span><b aria-hidden="true">›</b></button>)}</div> : <div className="friend-list-empty"><span aria-hidden="true">◎</span><strong>リストはまだありません</strong><p>よく一緒に走る仲間や、共有したい相手をまとめられます。</p></div>}
  </section>

  return <section className="friend-list-manager friend-list-editor" aria-labelledby="friend-list-editor-title">
    <header className="friend-list-editor-heading"><button type="button" className="friend-list-back" onClick={closeEditor} aria-label="フレンドリスト一覧へ戻る">←</button><div><p className="eyebrow">{view === 'create' ? 'NEW LIST' : 'LIST DETAILS'}</p><h3 id="friend-list-editor-title">{view === 'create' ? 'フレンドリストを作成' : 'フレンドリスト詳細'}</h3></div></header>
    <label className="friend-list-name-field"><span>リスト名</span><input value={draftName} onChange={(event) => setDraftName(event.target.value)} maxLength={40} placeholder="例：伊豆ドライブ仲間" autoFocus /></label>
    <div className="friend-list-member-picker"><div><strong>メンバー</strong><small>{draftMemberIds.length}人を選択中</small></div>{friendIds.length ? friendIds.map((id) => <label key={id} className={draftMemberIds.includes(id) ? 'selected' : ''}><span className="friend-avatar" aria-hidden="true">{friendName(id).slice(0, 1)}</span><span><strong>{friendName(id)}</strong><small>{draftMemberIds.includes(id) ? 'このリストに追加済み' : 'フレンド'}</small></span><input type="checkbox" checked={draftMemberIds.includes(id)} onChange={() => toggleMember(id)} /></label>) : <p className="friend-list-no-friends">リストへ追加できるフレンドがまだいません。</p>}</div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="friend-list-editor-actions"><button type="button" className="button primary" disabled={busy || !draftName.trim()} onClick={() => void commit()}>{busy ? '保存中…' : view === 'create' ? 'リストを作成' : '変更を保存'}</button>{view === 'detail' && <button type="button" className="text-button danger-button" disabled={busy} onClick={() => setConfirmDelete(true)}>このリストを削除</button>}</div>
    {confirmDelete && selected && <div className="friend-list-delete-confirm" role="alert"><strong>「{selected.name}」を削除しますか？</strong><p>フレンド関係そのものは解除されません。共有先からこのリストだけが削除されます。</p><div><button type="button" onClick={() => setConfirmDelete(false)}>キャンセル</button><button type="button" className="danger-button" disabled={busy} onClick={() => void removeSelected()}>削除する</button></div></div>}
  </section>
}
