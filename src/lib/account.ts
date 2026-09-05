import { collection, deleteDoc, doc, getDoc, getDocs, onSnapshot, runTransaction, serverTimestamp, setDoc } from 'firebase/firestore'
import type { User } from 'firebase/auth'
import { db } from './firebase'
import type { AccountRole, UserProfile } from '../types'

export const PRIMARY_SUPER_ADMIN_EMAIL = 'taizu61zx@gmail.com'
export const normalizeAccountId = (value: string) => value.normalize('NFKC').trim().toLowerCase()
export const validAccountId = (value: string) => /^[a-z0-9][a-z0-9_-]{2,19}$/.test(normalizeAccountId(value))

export function isPrimarySuperAdmin(user: Pick<User, 'email' | 'emailVerified'>) {
  return user.emailVerified && user.email?.trim().toLowerCase() === PRIMARY_SUPER_ADMIN_EMAIL
}

export function registeredAccountRole(uid: string, storedRole: AccountRole | undefined, primarySuperAdminUid?: string): AccountRole {
  if (uid === primarySuperAdminUid) return 'superadmin'
  return storedRole === 'admin' || storedRole === 'superadmin' ? storedRole : 'user'
}

export function subscribeAccountRole(user: User, next: (role: AccountRole) => void) {
  if (isPrimarySuperAdmin(user)) {
    next('superadmin')
    return () => undefined
  }
  return onSnapshot(doc(db, 'adminRoles', user.uid), (snapshot) => {
    const role = snapshot.data()?.role
    next(role === 'admin' || role === 'superadmin' ? role : 'user')
  }, () => next('user'))
}

export async function accountIdAvailable(value: string) {
  const id = normalizeAccountId(value)
  if (!validAccountId(id)) return false
  return !(await getDoc(doc(db, 'accountIds', id))).exists()
}

export async function claimAccountId(user: User, value: string): Promise<string> {
  const accountId = normalizeAccountId(value)
  if (!validAccountId(accountId)) throw new Error('3〜20文字の半角英小文字・数字・_・-で入力してください')
  await runTransaction(db, async (transaction) => {
    const profileRef = doc(db, 'users', user.uid)
    const idRef = doc(db, 'accountIds', accountId)
    const profile = await transaction.get(profileRef)
    const reservation = await transaction.get(idRef)
    const current = profile.data()?.accountId
    if (typeof current === 'string' && current) {
      if (current === accountId) return
      throw new Error('アカウントIDは登録済みです')
    }
    if (reservation.exists()) throw new Error('このIDはすでに使われています')
    transaction.set(idRef, { uid: user.uid, accountId, displayName: user.displayName ?? 'ドライバー', createdAt: serverTimestamp() })
    transaction.set(profileRef, { accountId, displayName: user.displayName ?? 'ドライバー', photoURL: user.photoURL ?? null, updatedAt: serverTimestamp() }, { merge: true })
  })
  return accountId
}

export interface RegisteredAccount { uid: string; accountId: string; displayName: string; role: AccountRole; profile: UserProfile }
export async function loadRegisteredAccounts(primarySuperAdminUid?: string): Promise<RegisteredAccount[]> {
  const [users, roles] = await Promise.all([getDocs(collection(db, 'users')), getDocs(collection(db, 'adminRoles'))])
  const roleMap = new Map(roles.docs.map((item) => [item.id, item.data().role as AccountRole]))
  return users.docs.flatMap((item) => {
    const data = item.data() as Partial<UserProfile>
    return typeof data.accountId === 'string' ? [{ uid: item.id, accountId: data.accountId, displayName: data.displayName ?? 'ドライバー', role: registeredAccountRole(item.id, roleMap.get(item.id), primarySuperAdminUid), profile: { id: item.id, displayName: data.displayName ?? 'ドライバー', bio: '', mapVisibility: 'friends', followingIds: [], followerCount: 0, ...data } as UserProfile }] : []
  }).sort((a, b) => a.accountId.localeCompare(b.accountId))
}

export async function setAccountRole(target: RegisteredAccount, role: AccountRole, actor: User) {
  const ref = doc(db, 'adminRoles', target.uid)
  if (role === 'user') await deleteDoc(ref)
  else await setDoc(ref, { role, accountId: target.accountId, displayName: target.displayName, updatedBy: actor.uid, updatedAt: serverTimestamp() })
}
