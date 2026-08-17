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
  serverTimestamp,
  setDoc,
  query,
  where,
} from 'firebase/firestore'
import { getStorage } from 'firebase/storage'
import { ratingLabels, type Coordinate, type Course, type CourseComment, type LiveRoadInfo, type RatingKey, type RatingSubmission, type Ratings, type UserProfile } from '../types'
import { combinedRatings, userRatingAverage } from './course'

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

function courseFromFirestore(id: string, value: Record<string, unknown>): Course {
  return { ...value, id, route: routeFromFirestore(value.route) } as Course
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

export async function loadPublicCourses(): Promise<Course[]> {
  const snapshot = await getDocs(query(collection(db, 'courses'), where('visibility', '==', 'public')))
  return Promise.all(snapshot.docs
    .map(async (item) => {
      const raw = courseFromFirestore(item.id, item.data())
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
    .then((items) => items.filter((course) => course.visibility === 'public'))
}

export async function loadCourseById(courseId: string): Promise<Course | null> {
  const snapshot = await getDoc(doc(db, 'courses', courseId))
  return snapshot.exists() ? courseFromFirestore(snapshot.id, snapshot.data()) : null
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

export async function addCourseComment(courseId: string, body: string, user: User): Promise<void> {
  await addDoc(collection(db, 'courses', courseId, 'comments'), { authorId: user.uid, authorName: user.displayName ?? 'ドライバー', body, likeCount: 0, createdAt: serverTimestamp() })
}

export async function loadLiveRoadInfo(courseId: string): Promise<LiveRoadInfo | null> {
  const snapshot = await getDoc(doc(db, 'courses', courseId, 'live', 'current'))
  return snapshot.exists() ? snapshot.data() as LiveRoadInfo : null
}

export async function submitAdminReport(courseId: string, type: 'discovery' | 'quality' | 'road', payload: Record<string, unknown>, user: User): Promise<void> {
  await addDoc(collection(db, 'reports'), { type, courseId, ...payload, authorId: user.uid, status: 'pending', createdAt: serverTimestamp() })
}
