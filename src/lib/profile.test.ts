import { describe, expect, it } from 'vitest'
import { postEmbedUrl, postUrlsFromText } from './profile'

describe('profile social helpers', () => {
  it('converts supported social posts into safe embed endpoints', () => {
    expect(postEmbedUrl('https://youtu.be/abc123')).toBe('https://www.youtube.com/embed/abc123')
    expect(postEmbedUrl('https://x.com/driver/status/123456')).toBe('https://platform.twitter.com/embed/Tweet.html?id=123456')
  })

  it('keeps only up to three http(s) post URLs', () => {
    expect(postUrlsFromText('https://x.com/a/status/1\nnot-a-url, https://instagram.com/p/a/ https://youtu.be/one https://tiktok.com/@a/video/1')).toHaveLength(3)
  })
})
