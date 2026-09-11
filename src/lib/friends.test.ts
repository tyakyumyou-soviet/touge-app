import { beforeEach, describe, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ data: null as Record<string, unknown> | null, documents: new Map<string, Record<string, unknown>>(), set: vi.fn(), update: vi.fn() }))
vi.mock('./firebase', () => ({ db: {} }))
vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db, collectionName, id) => `${collectionName}/${id}`), collection: vi.fn(), deleteDoc: vi.fn(), getDoc: vi.fn(async (ref: string) => ({ exists: () => state.documents.has(ref), data: () => state.documents.get(ref) })), onSnapshot: vi.fn(), query: vi.fn(), setDoc: vi.fn(), where: vi.fn(), serverTimestamp: () => 'server-time',
  runTransaction: async (_db: unknown, work: (transaction: unknown) => Promise<void>) => work({ get: async () => ({ exists: () => Boolean(state.data), data: () => state.data }), set: state.set, update: state.update }),
}))
import { acceptFriend, friendPairId, normalizeFriendAccountId, normalizeFriendName, requestFriend, searchFriends, type FriendEntry } from './friends'
const pending: FriendEntry = { id: 'a~b', sender: 'a', recipient: 'b', members: ['a', 'b'], names: { a: 'A', b: 'B' }, status: 'pending' }
beforeEach(() => { state.data = null; state.documents.clear(); vi.clearAllMocks() })
describe('friend request lifecycle', () => {
  it('normalizes names and uses the same pair for both directions', () => {
    expect(normalizeFriendName(' ＡｂＣ ')).toBe('abc')
    expect(friendPairId('b', 'a')).toBe(friendPairId('a', 'b'))
  })
  it('creates a pending request, never an accepted relationship', async () => {
    await requestFriend('a', 'A', { id: 'b', accountId: 'driver_b', displayName: 'B' })
    expect(state.set).toHaveBeenCalledWith('friendships/a~b', { sender: 'a', recipient: 'b', members: ['a', 'b'], names: { a: 'A', b: 'B' }, status: 'pending', updatedAt: 'server-time' })
  })
  it('rejects self requests and existing pairs', async () => {
    await expect(requestFriend('a', 'A', { id: 'a', accountId: 'driver_a', displayName: 'A' })).rejects.toThrow()
    state.data = { ...pending }
    await expect(requestFriend('b', 'B', { id: 'a', accountId: 'driver_a', displayName: 'A' })).rejects.toThrow()
    expect(state.set).not.toHaveBeenCalled()
  })
  it('only the recipient can accept a still-pending request', async () => {
    state.data = { ...pending }
    await expect(acceptFriend(pending, 'a')).rejects.toThrow()
    await expect(acceptFriend(pending, 'stranger')).rejects.toThrow()
    await acceptFriend(pending, 'b')
    expect(state.update).toHaveBeenCalledWith('friendships/a~b', { status: 'accepted', updatedAt: 'server-time' })
    state.data = null
    await expect(acceptFriend(pending, 'b')).rejects.toThrow()
  })

  it('finds only an exact registered account ID', async () => {
    expect(normalizeFriendAccountId('  @ＴＯＵＧＥ_61 ')).toBe('touge_61')
    state.documents.set('accountIds/touge_61', { uid: 'driver-61', displayName: '峠ドライバー' })
    await expect(searchFriends('@TOUGE_61')).resolves.toEqual([{ id: 'driver-61', accountId: 'touge_61', displayName: '峠ドライバー' }])
    await expect(searchFriends('touge')).resolves.toEqual([])
    state.documents.delete('accountIds/touge_61')
    await expect(searchFriends('touge_61')).resolves.toEqual([])
  })
})
