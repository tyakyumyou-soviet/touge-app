import { collection, deleteDoc, doc, getDoc, onSnapshot, query, runTransaction, serverTimestamp, where } from 'firebase/firestore'
import { db } from './firebase'
import { normalizeAccountId, validAccountId } from './account'

export interface FriendEntry { id: string; sender: string; recipient: string; members: string[]; names: Record<string, string>; status: 'pending' | 'accepted' }
export interface SearchPerson { id: string; accountId: string; displayName: string }
export const friendPairId = (a: string, b: string) => [a, b].sort().join('~')
export const normalizeFriendName = (name: string) => name.normalize('NFKC').trim().toLowerCase()
export const normalizeFriendAccountId = (value: string) => normalizeAccountId(value).replace(/^@/, '')
export function canAcceptFriend(entry: FriendEntry, uid: string) { return entry.status === 'pending' && entry.recipient === uid }

export function subscribeFriends(uid: string, next: (items: FriendEntry[]) => void, error: () => void) {
  return onSnapshot(query(collection(db, 'friendships'), where('members', 'array-contains', uid)), (snapshot) => next(snapshot.docs.map((item) => ({ ...item.data(), id: item.id } as FriendEntry))), error)
}
export async function searchFriends(value: string): Promise<SearchPerson[]> {
  const accountId = normalizeFriendAccountId(value)
  if (!validAccountId(accountId)) return []
  const account = await getDoc(doc(db, 'accountIds', accountId))
  if (!account.exists()) return []
  const uid = String(account.data().uid ?? '')
  if (!uid) return []
  return [{ id: uid, accountId, displayName: String(account.data().displayName || 'ドライバー') }]
}
export async function requestFriend(uid: string, name: string, person: SearchPerson) {
  if (uid === person.id) throw new Error('自分には申請できません')
  const ref = doc(db, 'friendships', friendPairId(uid, person.id))
  await runTransaction(db, async (transaction) => {
    const existing = await transaction.get(ref)
    if (existing.exists()) throw new Error('すでに申請中、またはフレンドです')
    transaction.set(ref, { sender: uid, recipient: person.id, members: [uid, person.id], names: { [uid]: name.slice(0, 80), [person.id]: person.displayName.slice(0, 80) }, status: 'pending', updatedAt: serverTimestamp() })
  })
}
export async function acceptFriend(entry: FriendEntry, uid: string) {
  const ref = doc(db, 'friendships', entry.id)
  await runTransaction(db, async (transaction) => {
    const current = await transaction.get(ref)
    if (!current.exists() || !canAcceptFriend(current.data() as FriendEntry, uid)) throw new Error('この申請は承認できません。最新の一覧をご確認ください')
    transaction.update(ref, { status: 'accepted', updatedAt: serverTimestamp() })
  })
}
export async function removeFriend(entry: FriendEntry) { await deleteDoc(doc(db, 'friendships', entry.id)) }
