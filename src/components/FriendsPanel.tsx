import { useEffect, useRef, useState, type ReactNode } from 'react'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { acceptFriend, canAcceptFriend, publishFriendSearch, removeFriend, requestFriend, searchFriends, subscribeFriends, type FriendEntry, type SearchPerson } from '../lib/friends'

export function FriendsPanel({ uid, name, listPanel, listCount = 0 }: { uid: string; name: string; listPanel: ReactNode; listCount?: number }) {
  const [tab, setTab] = useState<'friends' | 'requests' | 'search' | 'lists'>('friends')
  const [entries, setEntries] = useState<FriendEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchPerson[]>([])
  const [searched, setSearched] = useState(false)
  const [discoverable, setDiscoverable] = useState<boolean | null>(null)
  const [removing, setRemoving] = useState<FriendEntry | null>(null)
  const revision = useRef(0)
  useEffect(() => {
    let active = true
    getDoc(doc(db, 'friendDirectory', uid)).then((snapshot) => { if (active) setDiscoverable(snapshot.exists()) }).catch(() => { if (active) setError('検索公開の設定を取得できませんでした') })
    const unsubscribe = subscribeFriends(uid, (items) => { setEntries(items); setLoading(false) }, () => { setLoading(false); setError('フレンドを同期できませんでした。接続状態を確認してください') })
    const currentRevision = revision
    return () => { active = false; currentRevision.current++; unsubscribe() }
  }, [uid])
  async function perform(action: () => Promise<unknown>, message: string) {
    if (busy) return
    setBusy(true); setError(''); setNotice('')
    try { await action(); setNotice(message); setRemoving(null) }
    catch (caught) { setError(caught instanceof Error && !('code' in caught) ? caught.message : '操作を完了できませんでした。接続状態を確認して再試行してください') }
    finally { setBusy(false) }
  }
  const accepted = entries.filter((entry) => entry.status === 'accepted')
  const pending = entries.filter((entry) => entry.status === 'pending')
  const incoming = pending.filter((entry) => canAcceptFriend(entry, uid))
  const otherId = (entry: FriendEntry) => entry.sender === uid ? entry.recipient : entry.sender
  const personName = (entry: FriendEntry) => entry.names[otherId(entry)] || 'ドライバー'
  const avatar = (title: string) => <span className="friend-avatar" aria-hidden="true">{title.slice(0, 1)}</span>
  return <section className="friends-hub" aria-label="フレンド管理">
    <div className="community-segments" role="tablist" aria-label="フレンドの表示">
      {([['friends', 'フレンド', accepted.length], ['requests', '申請', incoming.length], ['search', '探す', 0], ['lists', 'リスト', listCount]] as const).map(([id, title, count]) => <button key={id} id={`friend-tab-${id}`} role="tab" aria-selected={tab === id} aria-controls="friend-tab-panel" onClick={() => { setTab(id); setRemoving(null) }}>{title}{count > 0 && <span className="count-badge">{count}</span>}</button>)}
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {notice && <p className="form-success" role="status">{notice}</p>}
    <div id="friend-tab-panel" role="tabpanel" aria-labelledby={`friend-tab-${tab}`}>
      {tab !== 'lists' && loading && <p role="status">フレンドを読み込み中…</p>}
      {tab === 'friends' && <>
        {!loading && !accepted.length && <div className="community-empty"><span aria-hidden="true">◎</span><h3>一緒に走る仲間を見つけよう</h3><p>名前で検索して申請できます。相手が承認するとフレンドになります。</p><button className="button primary" onClick={() => setTab('search')}>フレンドを探す</button></div>}
        {accepted.map((entry) => <article className="friend-person" key={entry.id}>{avatar(personName(entry))}<div><strong>{personName(entry)}</strong><small>フレンド</small></div><button className="text-button" disabled={busy} onClick={() => setRemoving(entry)}>解除</button></article>)}
        {removing && <section className="friend-confirm" role="alert"><p>「{personName(removing)}」とのフレンド関係を解除しますか？位置情報のフレンド共有対象からも外れます。</p><div className="social-actions"><button disabled={busy} onClick={() => setRemoving(null)}>キャンセル</button><button className="danger-button" disabled={busy} onClick={() => void perform(() => removeFriend(removing), 'フレンドを解除しました')}>解除する</button></div></section>}
      </>}
      {tab === 'requests' && <>
        {!loading && !pending.length && <div className="community-empty"><h3>申請はありません</h3><p>受信した申請と、承認待ちの申請をここで確認できます。</p></div>}
        {pending.map((entry) => <article className="friend-person" key={entry.id}>{avatar(personName(entry))}<div><strong>{personName(entry)}</strong><small>{canAcceptFriend(entry, uid) ? 'フレンド申請が届いています' : '承認待ち'}</small><div className="social-actions">{canAcceptFriend(entry, uid) && <button disabled={busy} className="button primary" onClick={() => void perform(() => acceptFriend(entry, uid), 'フレンドになりました')}>承認</button>}<button disabled={busy} onClick={() => void perform(() => removeFriend(entry), canAcceptFriend(entry, uid) ? '申請を拒否しました' : '申請を取り消しました')}>{canAcceptFriend(entry, uid) ? '拒否' : '申請を取り消す'}</button></div></div></article>)}
      </>}
      {tab === 'search' && <>
        <label className="community-switch"><span><strong>名前で見つけてもらう</strong><small>公開されるのは表示名だけです</small></span><input type="checkbox" role="switch" checked={discoverable === true} disabled={busy || discoverable === null} onChange={(event) => { const enabled = event.target.checked; void perform(async () => { await publishFriendSearch(uid, name, enabled); setDiscoverable(enabled) }, enabled ? '名前で検索できるようになりました' : '検索への公開を停止しました') }} /></label>
        <form className="friend-search" onSubmit={(event) => { event.preventDefault(); const current = ++revision.current; void perform(async () => { const found = await searchFriends(query); if (current === revision.current) { setResults(found.filter((person) => person.id !== uid)); setSearched(true) } }, '') }}><input aria-label="フレンドの表示名" placeholder="表示名で検索" value={query} maxLength={80} onChange={(event) => { revision.current++; setQuery(event.target.value); setResults([]); setSearched(false) }} /><button className="button primary" disabled={busy || !query.trim()}>検索</button></form>
        <p className="muted">名前の先頭から検索します。検索公開をオンにしたユーザーが表示されます（最大20件）。</p>
        {searched && !results.length && <p className="community-empty">見つかりませんでした。表示名と相手の検索公開設定をご確認ください。</p>}
        {results.map((person) => { const relation = entries.find((entry) => entry.members.includes(person.id)); return <article className="friend-person" key={person.id}>{avatar(person.displayName)}<div><strong>{person.displayName}</strong><small>{relation?.status === 'accepted' ? 'フレンド' : relation ? '申請中' : 'ドライバー'}</small></div>{relation ? <button onClick={() => setTab(relation.status === 'accepted' ? 'friends' : 'requests')}>確認</button> : <button disabled={busy} className="button primary" onClick={() => void perform(() => requestFriend(uid, name, person), 'フレンド申請を送りました')}>申請</button>}</article> })}
      </>}
      {tab === 'lists' && listPanel}
    </div>
  </section>
}
