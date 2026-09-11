import { describe, expect, it } from 'vitest'
import { nowPlayingFromMediaMetadata, postEmbedUrl, postUrlsFromText } from './profile'

describe('profile social helpers', () => {
  it('converts supported social posts into safe embed endpoints', () => {
    expect(postEmbedUrl('https://youtu.be/abc123')).toBe('https://www.youtube.com/embed/abc123')
    expect(postEmbedUrl('https://x.com/driver/status/123456')).toBe('https://platform.twitter.com/embed/Tweet.html?id=123456')
  })

  it('keeps only up to three http(s) post URLs', () => {
    expect(postUrlsFromText('https://x.com/a/status/1\nnot-a-url, https://instagram.com/p/a/ https://youtu.be/one https://tiktok.com/@a/video/1')).toHaveLength(3)
  })

  it('normalizes automatically detected media metadata', () => {
    expect(nowPlayingFromMediaMetadata({ title: '  Night Drive  ', artist: ' DJ Touge ' }, '2026-09-11T00:00:00.000Z')).toEqual({ title: 'Night Drive', artist: 'DJ Touge', updatedAt: '2026-09-11T00:00:00.000Z' })
    expect(nowPlayingFromMediaMetadata({ title: '   ', artist: 'Nobody' })).toBeNull()
  })
})
