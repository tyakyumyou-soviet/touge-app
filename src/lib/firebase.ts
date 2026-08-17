import { initializeApp } from 'firebase/app'
import {
  browserLocalPersistence,
  getAuth,
  GoogleAuthProvider,
  getRedirectResult,
  setPersistence,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type AuthError,
  type User,
} from 'firebase/auth'
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  query,
  where,
} from 'firebase/firestore'
import { getStorage } from 'firebase/storage'
import { ratingLabels, type Coordinate, type Course, type CourseComment, type LiveRoadInfo, type RatingKey, type RatingSubmission, type Ratings, type UserProfile } from '../types'
import { combinedRatings, emptyRatings, routeDistanceKm, userRatingAverage } from './course'

const firebaseConfig = {
  apiKey: 'AIzaSyBXyb8s-ZAsfBUJyv_dMCgjl0Z8r0sSBGc',
  authDomain: 'touge-app.firebaseapp.com',
  projectId: 'touge-app',
  storageBucket: 'touge-app.firebasestorage.app',
  messagingSenderId: '875569817110',
  appId: '1:875569817110:web:89893c21f3451da024b737',
}

const app = initializeApp(firebaseConfig)
let db: ReturnType<typeof getFirestore>
try {
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  })
} catch {
  db = getFirestore(app)
}

export const auth = getAuth(app)
export const storage = getStorage(app)
export { db }

type StoredCoordinate = { lng: number; lat: number }

// Firestore does not allow an array to contain another array. Routes are used
// by the UI as [lng, lat] tuples, so convert them at the storage boundary.
// The reader also understands legacy tuples to keep previously imported data
// usable.
function routeForFirestore(route: Coordinate[]): StoredCoordinate[] {
  return route.map(([lng, lat]) => ({ lng, lat }))
}

function routeFromFirestore(value: unknown): Coordinate[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((point): Coordinate[] => {
    if (Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1])) return [[Number(point[0]), Number(point[1])]]
    if (point && typeof point === 'object' && Number.isFinite((point as StoredCoordinate).lng) && Number.isFinite((point as StoredCoordinate).lat)) return [[(point as StoredCoordinate).lng, (point as StoredCoordinate).lat]]
    return []
  })
}

function firestoreDate(value: unknown): string {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'toDate' in value && typeof (value as { toDate?: unknown }).toDate === 'function') {
    const date = (value as { toDate: () => Date }).toDate()
    return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10)
  }
  if (value && typeof value === 'object' && typeof (value as { seconds?: unknown }).seconds === 'number') return new Date((value as { seconds: number }).seconds * 1000).toISOString().slice(0, 10)
  return ''
}

function strings(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [] }

function ratings(value: unknown): Ratings {
  const fallback = emptyRatings()
  if (!value || typeof value !== 'object') return fallback
  return Object.fromEntries(Object.keys(fallback).map((key) => [key, typeof (value as Record<string, unknown>)[key] === 'number' ? (value as Record<string, number>)[key] : fallback[key as RatingKey]])) as Ratings
}

function courseFromFirestore(id: string, value: Record<string, unknown>): Course {
  const route = routeFromFirestore(value.route)
  const elevationProfile = Array.isArray(value.elevationProfile) ? value.elevationProfile.filter((item): item is number => typeof item === 'number' && Number.isFinite(item)) : []
  const profileMin = elevationProfile.length ? Math.min(...elevationProfile) : 0
  const profileMax = elevationProfile.length ? Math.max(...elevationProfile) : 0
  const rawRatings = ratings(value.ratings)
  const rawSystemRatings = value.systemRatings && typeof value.systemRatings === 'object' ? ratings(value.systemRatings) : undefined
  const rawUserRatings = value.userRatings && typeof value.userRatings === 'object' ? ratings(value.userRatings) : undefined
  return {
    ...value,
    id,
    name: typeof value.name === 'string' ? value.name : '名称未設定コース',
    area: typeof value.area === 'string' ? value.area : 'エリア未設定',
    description: typeof value.description === 'string' ? value.description : '',
    route,
    distanceKm: typeof value.distanceKm === 'number' && Number.isFinite(value.distanceKm) ? value.distanceKm : routeDistanceKm(route),
    durationMin: typeof value.durationMin === 'number' && Number.isFinite(value.durationMin) ? value.durationMin : Math.max(1, Math.round(routeDistanceKm(route) * 2)),
    elevationProfile,
    minElevation: typeof value.minElevation === 'number' && Number.isFinite(value.minElevation) ? value.minElevation : profileMin,
    maxElevation: typeof value.maxElevation === 'number' && Number.isFinite(value.maxElevation) ? value.maxElevation : profileMax,
    tags: strings(value.tags),
    cautions: strings(value.cautions),
    ratings: rawRatings,
    systemRatings: rawSystemRatings,
    userRatings: rawUserRatings,
    ratingCount: typeof value.ratingCount === 'number' ? value.ratingCount : 0,
    updatedAt: firestoreDate(value.updatedAt) || firestoreDate(value.createdAt) || '更新日不明',
  } as Course
}

async function saveUserProfile(user: User): Promise<User> {
  await setDoc(doc(db, 'users', user.uid), {
    displayName: user.displayName ?? 'ドライバー',
    photoURL: user.photoURL,
    updatedAt: serverTimestamp(),
  }, { merge: true })
  return user
}

export async function loginWithGoogle(): Promise<User | null> {
  await setPersistence(auth, browserLocalPersistence)
  const provider = new GoogleAuthProvider()
  try {
    const result = await signInWithPopup(auth, provider)
    return saveUserProfile(result.user)
  } catch (error) {
    const code = (error as Partial<AuthError>).code
    const useRedirect = ['auth/popup-blocked', 'auth/popup-closed-by-user', 'auth/cancelled-popup-request', 'auth/operation-not-supported-in-this-environment', 'auth/web-storage-unsupported'].includes(code ?? '')
    if (!useRedirect) throw error
    await signInWithRedirect(auth, provider)
    return null
  }
}

export async function completeRedirectLogin(): Promise<User | null> {
  const result = await getRedirectResult(auth)
  return result ? saveUserProfile(result.user) : null
}

export const logout = () => signOut(auth)

async function hydrateCourses(documents: Awaited<ReturnType<typeof getDocs>>['docs']): Promise<Course[]> {
  return Promise.all(documents
    .map(async (item) => {
      const raw = courseFromFirestore(item.id, item.data() as Record<string, unknown>)
      const systemRatings = raw.systemRatings ?? raw.ratings
      const ratingSnapshot = await getDocs(collection(db, 'courses', item.id, 'ratings'))
      const sums = Object.fromEntries(Object.keys(ratingLabels).map((key) => [key, 0])) as Ratings
      for (const rating of ratingSnapshot.docs) {
        const values = rating.data() as Partial<Record<RatingKey, unknown>>
        for (const key of Object.keys(ratingLabels) as RatingKey[]) {
          if (typeof values[key] === 'number') sums[key] += values[key] as number
        }
      }
      const ratingCount = ratingSnapshot.size
      const userRatings = ratingCount ? userRatingAverage(sums, ratingCount) : undefined
      return { ...raw, systemRatings, userRatings, ratingCount, ratings: combinedRatings({ ...raw, systemRatings, userRatings, ratingCount }) }
    }))
}

/** Load public routes plus the signed-in driver's own limited/private routes. */
export async function loadPublicCourses(userId?: string): Promise<Course[]> {
  const publicSnapshot = await getDocs(query(collection(db, 'courses'), where('visibility', '==', 'public')))
  const ownSnapshot = userId
    ? await getDocs(query(collection(db, 'courses'), where('authorId', '==', userId)))
    : null
  const documents = [...publicSnapshot.docs, ...(ownSnapshot?.docs ?? [])]
  const uniqueDocuments = [...new Map(documents.map((item) => [item.id, item])).values()]
  return hydrateCourses(uniqueDocuments).then((courses) => courses.filter((course) => course.route.length >= 2))
}

export async function loadCourseById(courseId: string): Promise<Course | null> {
  const snapshot = await getDoc(doc(db, 'courses', courseId))
  if (!snapshot.exists()) return null
  const course = courseFromFirestore(snapshot.id, snapshot.data())
  return course.route.length >= 2 ? course : null
}

export async function createCourse(course: Omit<Course, 'id'>): Promise<string> {
  const { route, ...courseFields } = course
  const result = await addDoc(collection(db, 'courses'), {
    ...courseFields,
    route: routeForFirestore(route),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  return result.id
}

export async function updateCourse(courseId: string, changes: Pick<Course, 'name' | 'area' | 'prefecture' | 'description' | 'tags' | 'cautions' | 'visibility'>): Promise<void> {
  await updateDoc(doc(db, 'courses', courseId), { ...changes, updatedAt: serverTimestamp() })
}

export async function deleteCourse(courseId: string): Promise<void> {
  const courseRef = doc(db, 'courses', courseId)
  const [ratings, likes, comments, live] = await Promise.all([
    getDocs(collection(courseRef, 'ratings')),
    getDocs(collection(courseRef, 'likes')),
    getDocs(collection(courseRef, 'comments')),
    getDoc(doc(courseRef, 'live', 'current')),
  ])
  const batch = writeBatch(db)
  ratings.docs.forEach((item) => batch.delete(item.ref))
  likes.docs.forEach((item) => batch.delete(item.ref))
  comments.docs.forEach((item) => batch.delete(item.ref))
  if (live.exists()) batch.delete(live.ref)
  batch.delete(courseRef)
  await batch.commit()
}

export async function saveRating(rating: RatingSubmission, user: User): Promise<void> {
  const { courseId, ...values } = rating
  await setDoc(doc(db, 'courses', courseId, 'ratings', user.uid), {
    ...values,
    userId: user.uid,
    userName: user.displayName ?? 'ドライバー',
    updatedAt: serverTimestamp(),
  })
}

export async function submitTollReport(courseId: string, report: { fee: string; freeCondition: string; applicableTime: string; sourceUrl: string; observedAt: string }, user: User): Promise<void> {
  await addDoc(collection(db, 'reports'), {
    type: 'toll-info',
    courseId,
    ...report,
    authorId: user.uid,
    authorName: user.displayName ?? 'ドライバー',
    status: 'pending',
    createdAt: serverTimestamp(),
  })
}

export async function loadUserProfile(userId: string): Promise<UserProfile | null> {
  const snapshot = await getDoc(doc(db, 'users', userId))
  return snapshot.exists() ? ({ id: userId, displayName: 'ドライバー', followingIds: [], mapVisibility: 'friends', followerCount: 0, bio: '', ...snapshot.data() } as UserProfile) : null
}

export async function saveUserProfileSettings(user: User, values: Pick<UserProfile, 'displayName' | 'bio' | 'homeArea' | 'mapVisibility'>): Promise<void> {
  await setDoc(doc(db, 'users', user.uid), { ...values, displayName: values.displayName || user.displayName || 'ドライバー', updatedAt: serverTimestamp() }, { merge: true })
}

export async function toggleFollow(targetId: string, user: User): Promise<boolean> {
  const followRef = doc(db, 'users', user.uid, 'following', targetId)
  const existing = await getDoc(followRef)
  if (existing.exists()) { await deleteDoc(followRef); return false }
  await setDoc(followRef, { targetId, createdAt: serverTimestamp() }); return true
}

export async function toggleCourseLike(courseId: string, user: User): Promise<boolean> {
  const likeRef = doc(db, 'courses', courseId, 'likes', user.uid)
  const existing = await getDoc(likeRef)
  if (existing.exists()) { await deleteDoc(likeRef); return false }
  await setDoc(likeRef, { userId: user.uid, userName: user.displayName ?? 'ドライバー', createdAt: serverTimestamp() }); return true
}

export async function loadCourseComments(courseId: string): Promise<CourseComment[]> {
  const snapshot = await getDocs(collection(db, 'courses', courseId, 'comments'))
  return snapshot.docs.map((item) => ({ id: item.id, courseId, likeCount: 0, ...item.data() } as CourseComment))
}

export async function addCourseComment(courseId: string, body: string, user: User): Promise<string> {
  const created = await addDoc(collection(db, 'courses', courseId, 'comments'), { authorId: user.uid, authorName: user.displayName ?? 'ドライバー', body, likeCount: 0, createdAt: serverTimestamp() })
  return created.id
}

export async function deleteCourseComment(courseId: string, commentId: string): Promise<void> {
  await deleteDoc(doc(db, 'courses', courseId, 'comments', commentId))
}

export function subscribeCourseComments(courseId: string, onChange: (comments: CourseComment[]) => void, onError?: (error: Error) => void): () => void {
  return onSnapshot(collection(db, 'courses', courseId, 'comments'), (snapshot) => {
    onChange(snapshot.docs.map((item) => ({ id: item.id, courseId, likeCount: 0, ...item.data() } as CourseComment)))
  }, (error) => onError?.(error))
}

export function subscribeCourseLikes(courseId: string, userId: string | undefined, onChange: (state: { count: number; liked: boolean }) => void): () => void {
  return onSnapshot(collection(db, 'courses', courseId, 'likes'), (snapshot) => onChange({ count: snapshot.size, liked: Boolean(userId && snapshot.docs.some((item) => item.id === userId)) }))
}

export async function loadLiveRoadInfo(courseId: string): Promise<LiveRoadInfo | null> {
  const snapshot = await getDoc(doc(db, 'courses', courseId, 'live', 'current'))
  return snapshot.exists() ? snapshot.data() as LiveRoadInfo : null
}

export function subscribeLiveRoadInfo(courseId: string, onChange: (info: LiveRoadInfo | null) => void): () => void {
  return onSnapshot(doc(db, 'courses', courseId, 'live', 'current'), (snapshot) => onChange(snapshot.exists() ? snapshot.data() as LiveRoadInfo : null), () => onChange(null))
}

export async function submitAdminReport(courseId: string, type: 'discovery' | 'quality' | 'road', payload: Record<string, unknown>, user: User): Promise<void> {
  await addDoc(collection(db, 'reports'), { type, courseId, ...payload, authorId: user.uid, status: 'pending', createdAt: serverTimestamp() })
}
