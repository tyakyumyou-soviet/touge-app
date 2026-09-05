import { beforeEach, describe, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ data: null as Record<string, unknown> | null, set: vi.fn(), update: vi.fn() }))
vi.mock('./firebase', () => ({ db: {} }))
vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db, _collection, id) => id), collection: vi.fn(), deleteDoc: vi.fn(), getDocs: vi.fn(), limit: vi.fn(), onSnapshot: vi.fn(), orderBy: vi.fn(), query: vi.fn(), setDoc: vi.fn(), where: vi.fn(), serverTimestamp: () => 'server-time',
  runTransaction: async (_db: unknown, work: (transaction: unknown) => Promise<void>) => work({ get: async () => ({ exists: () => Boolean(state.data), data: () => state.data }), set: state.set, update: state.update }),
}))
import { acceptFriend, friendPairId, normalizeFriendName, requestFriend, type FriendEntry } from './friends'
const pending: FriendEntry = { id: 'a~b', sender: 'a', recipient: 'b', members: ['a', 'b'], names: { a: 'A', b: 'B' }, status: 'pending' }
beforeEach(() => { state.data = null; vi.clearAllMocks() })
describe('friend request lifecycle', () => {
  it('normalizes names and uses the same pair for both directions', () => {
    expect(normalizeFriendName(' ＡｂＣ ')).toBe('abc')
    expect(friendPairId('b', 'a')).toBe(friendPairId('a', 'b'))
  })
  it('creates a pending request, never an accepted relationship', async () => {
    await requestFriend('a', 'A', { id: 'b', displayName: 'B' })
    expect(state.set).toHaveBeenCalledWith('a~b', { sender: 'a', recipient: 'b', members: ['a', 'b'], names: { a: 'A', b: 'B' }, status: 'pending', updatedAt: 'server-time' })
  })
  it('rejects self requests and existing pairs', async () => {
    await expect(requestFriend('a', 'A', { id: 'a', displayName: 'A' })).rejects.toThrow()
    state.data = { ...pending }
    await expect(requestFriend('b', 'B', { id: 'a', displayName: 'A' })).rejects.toThrow()
    expect(state.set).not.toHaveBeenCalled()
  })
  it('only the recipient can accept a still-pending request', async () => {
    state.data = { ...pending }
    await expect(acceptFriend(pending, 'a')).rejects.toThrow()
    await expect(acceptFriend(pending, 'stranger')).rejects.toThrow()
    await acceptFriend(pending, 'b')
    expect(state.update).toHaveBeenCalledWith('a~b', { status: 'accepted', updatedAt: 'server-time' })
    state.data = null
    await expect(acceptFriend(pending, 'b')).rejects.toThrow()
  })
})
