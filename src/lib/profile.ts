export function postEmbedUrl(value: string) {
  try {
    const url = new URL(value)
    const host = url.hostname.replace(/^www\./, '').toLowerCase()
    if (host === 'youtu.be') {
      const id = url.pathname.split('/').filter(Boolean)[0]
      return id ? `https://www.youtube.com/embed/${id}` : null
    }
    if (host === 'youtube.com' || host === 'm.youtube.com') {
      const id = url.searchParams.get('v') ?? url.pathname.match(/\/embed\/([^/]+)/)?.[1] ?? url.pathname.match(/\/shorts\/([^/]+)/)?.[1]
      return id ? `https://www.youtube.com/embed/${id}` : null
    }
    if (host === 'instagram.com' || host === 'm.instagram.com') {
      const match = url.pathname.match(/\/(p|reel)\/([^/?#]+)/)
      return match ? `https://www.instagram.com/${match[1]}/${match[2]}/embed` : null
    }
    if (host === 'tiktok.com' || host === 'm.tiktok.com') {
      const id = url.pathname.match(/\/video\/(\d+)/)?.[1]
      return id ? `https://www.tiktok.com/embed/v2/${id}` : null
    }
    if (host === 'x.com' || host === 'twitter.com' || host === 'mobile.twitter.com') {
      const id = url.pathname.match(/\/status(?:es)?\/(\d+)/)?.[1]
      return id ? `https://platform.twitter.com/embed/Tweet.html?id=${id}` : null
    }
  } catch { /* A normal link card remains available for invalid/unsupported URLs. */ }
  return null
}

export function postUrlsFromText(value: string) {
  return [...new Set(value.split(/[\n,、\s]+/).map((item) => item.trim()).filter((item) => /^https?:\/\//i.test(item)))].slice(0, 3)
}
