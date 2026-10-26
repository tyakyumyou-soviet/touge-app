export const MUSIC_RECOGNITION_SHORTCUT_NAME = 'Touge曲認識'
export const MUSIC_RECOGNITION_PENDING_KEY = 'touge-music-recognition-pending'

export interface MusicRecognitionRequest {
  id: string
  createdAt: number
}

export interface MusicRecognitionResult {
  id: string
  title: string
  artist?: string
}

/** Build the iOS Shortcuts x-callback URL for a user-installed Shazam shortcut. */
export function buildMusicRecognitionShortcutUrl(origin: string, id: string, shortcutName = MUSIC_RECOGNITION_SHORTCUT_NAME) {
  const callback = new URL(origin)
  callback.search = ''
  callback.hash = ''
  callback.searchParams.set('tougeMusicRequest', id)

  const shortcut = new URL('shortcuts://x-callback-url/run-shortcut')
  shortcut.searchParams.set('name', shortcutName)
  shortcut.searchParams.set('x-success', callback.toString())
  shortcut.searchParams.set('x-cancel', `${callback.toString()}&tougeMusicCancelled=1`)
  shortcut.searchParams.set('x-error', `${callback.toString()}&tougeMusicError=1`)
  return shortcut.toString()
}

/** Parse the textual output expected from the shortcut: title on line one, artist on line two. */
export function parseMusicRecognitionResult(id: string, value: string | null | undefined): MusicRecognitionResult | null {
  const lines = value?.split(/\r?\n/).map((line) => line.trim()).filter(Boolean) ?? []
  const title = lines[0]?.slice(0, 160)
  if (!title) return null
  const artist = lines.slice(1).join(' ').slice(0, 160)
  return { id, title, ...(artist ? { artist } : {}) }
}

export function isMusicRecognitionRequestFresh(request: MusicRecognitionRequest | null, now = Date.now()) {
  return Boolean(request?.id && request.createdAt <= now && now - request.createdAt <= 5 * 60_000)
}
