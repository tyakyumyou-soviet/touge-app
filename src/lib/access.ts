import type { User } from 'firebase/auth'

export const WAYPOINT_LIMIT = 25
const ADMIN_EMAIL = 'taizu61zx@gmail.com'

/** The designated administrator can build long editorial routes without the
 * public editor's waypoint cap. Firebase provides the signed-in email; do not
 * derive this from a form field or other user-controlled route data. */
export function canUseUnlimitedWaypoints(user: Pick<User, 'email' | 'emailVerified'> | null | undefined): boolean {
  return user?.emailVerified === true && user.email?.trim().toLocaleLowerCase() === ADMIN_EMAIL
}

export function isAdministrator(user: Pick<User, 'email' | 'emailVerified'> | null | undefined): boolean {
  return canUseUnlimitedWaypoints(user)
}

export function exceedsWaypointLimit(pointCount: number, canUseUnlimited: boolean): boolean {
  return !canUseUnlimited && pointCount > WAYPOINT_LIMIT
}
