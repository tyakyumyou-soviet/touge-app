import { initializeApp } from 'firebase/app'
import {
  browserLocalPersistence,
  getAuth,
  GoogleAuthProvider,
  setPersistence,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth'
import {
  addDoc,
  collection,
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
import type { Course, RatingSubmission } from '../types'

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

export async function loginWithGoogle(): Promise<User> {
  await setPersistence(auth, browserLocalPersistence)
  const provider = new GoogleAuthProvider()
  const result = await signInWithPopup(auth, provider)
  await setDoc(doc(db, 'users', result.user.uid), {
    displayName: result.user.displayName ?? 'ドライバー',
    photoURL: result.user.photoURL,
    updatedAt: serverTimestamp(),
  }, { merge: true })
  return result.user
}

export const logout = () => signOut(auth)

export async function loadPublicCourses(): Promise<Course[]> {
  const snapshot = await getDocs(query(collection(db, 'courses'), where('visibility', '==', 'public')))
  return snapshot.docs
    .map((item) => ({ id: item.id, ...item.data() }) as Course)
    .filter((course) => course.visibility === 'public')
}

export async function loadCourseById(courseId: string): Promise<Course | null> {
  const snapshot = await getDoc(doc(db, 'courses', courseId))
  return snapshot.exists() ? ({ id: snapshot.id, ...snapshot.data() } as Course) : null
}

export async function createCourse(course: Omit<Course, 'id'>): Promise<string> {
  const result = await addDoc(collection(db, 'courses'), {
    ...course,
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
