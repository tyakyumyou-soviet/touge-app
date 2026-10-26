import { useState } from 'react'

interface Props {
  name: string
  photoURL?: string | null
  className?: string
}

export function UserAvatar({ name, photoURL, className = 'friend-avatar' }: Props) {
  const [failedURL, setFailedURL] = useState<string | null>(null)
  const showImage = Boolean(photoURL && failedURL !== photoURL)
  return <span className={className} aria-hidden="true">
    {showImage ? <img src={photoURL!} alt="" onError={() => setFailedURL(photoURL!)} /> : name.slice(0, 1)}
  </span>
}
