import { collection, deleteDoc, doc, getDocs, limit, onSnapshot, orderBy, query, runTransaction, serverTimestamp, setDoc, where } from 'firebase/firestore'
import { db } from './firebase'

export interface FriendEntry { id: string; sender: string; recipient: string; members: string[]; names: Record<string, string>; status: 'pending' | 'accepted' }
export interface SearchPerson { id: string; displayName: string }
export const friendPairId = (a: string, b: string) => [a, b].sort().join('~')
export const normalizeFriendName = (name: string) => name.normalize('NFKC').trim().toLowerCase()
export function canAcceptFriend(entry: FriendEntry, uid: string) { return entry.status === 'pending' && entry.recipient === uid }

export function subscribeFriends(uid: string, next: (items: FriendEntry[]) => void, error: () => void) {
  return onSnapshot(query(collection(db, 'friendships'), where('members', 'array-contains', uid)), (snapshot) => next(snapshot.docs.map((item) => ({ ...item.data(), id: item.id } as FriendEntry))), error)
}
export async function publishFriendSearch(uid: string, displayName: string, enabled: boolean) {
  const ref = doc(db, 'friendDirectory', uid)
  if (!enabled) return deleteDoc(ref)
  const name = displayName.trim().slice(0, 80) || 'ドライバー'
  await setDoc(ref, { displayName: name, searchName: normalizeFriendName(name) })
}
export async function searchFriends(name: string): Promise<SearchPerson[]> {
  const prefix = normalizeFriendName(name)
  if (!prefix) return []
  const result = await getDocs(query(collection(db, 'friendDirectory'), orderBy('searchName'), where('searchName', '>=', prefix), where('searchName', '<=', prefix + '\uf8ff'), limit(20)))
  return result.docs.map((item) => ({ id: item.id, displayName: String(item.data().displayName) }))
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
