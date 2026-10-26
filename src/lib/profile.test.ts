import { describe, expect, it } from 'vitest'
import { nowPlayingFromMediaMetadata, nowPlayingFromMediaSession, postEmbedUrl, postUrlsFromText } from './profile'
import { buildMusicRecognitionShortcutUrl, isMusicRecognitionRequestFresh, parseMusicRecognitionResult } from './iosMusicRecognition'

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

  it('shares a track only while the browser media session is playing', () => {
    const metadata = { title: 'Night Drive', artist: 'DJ Touge' }
    expect(nowPlayingFromMediaSession({ metadata, playbackState: 'playing' }, '2026-09-11T00:00:00.000Z')).toEqual({ title: 'Night Drive', artist: 'DJ Touge', updatedAt: '2026-09-11T00:00:00.000Z' })
    expect(nowPlayingFromMediaSession({ metadata, playbackState: 'paused' })).toBeNull()
    expect(nowPlayingFromMediaSession({ metadata: null, playbackState: 'playing' })).toBeNull()
  })
})

describe('iOS music recognition shortcut bridge', () => {
  it('builds an encoded Shortcuts callback that returns to the app origin', () => {
    const url = new URL(buildMusicRecognitionShortcutUrl('https://touge.example/app/', 'request-123'))
    expect(url.protocol).toBe('shortcuts:')
    expect(url.hostname).toBe('x-callback-url')
    expect(url.searchParams.get('name')).toBe('Touge曲認識')
    expect(url.searchParams.get('x-success')).toBe('https://touge.example/app/?tougeMusicRequest=request-123')
  })

  it('parses the title and optional artist returned by the shortcut', () => {
    expect(parseMusicRecognitionResult('request-123', '夜に駆ける\nYOASOBI')).toEqual({ id: 'request-123', title: '夜に駆ける', artist: 'YOASOBI' })
    expect(parseMusicRecognitionResult('request-123', '  環境音  ')).toEqual({ id: 'request-123', title: '環境音' })
    expect(parseMusicRecognitionResult('request-123', '  \n  ')).toBeNull()
  })

  it('rejects expired or future-dated shortcut requests', () => {
    expect(isMusicRecognitionRequestFresh({ id: 'a', createdAt: 1_000 }, 2_000)).toBe(true)
    expect(isMusicRecognitionRequestFresh({ id: 'a', createdAt: 1_000 }, 302_000)).toBe(false)
    expect(isMusicRecognitionRequestFresh({ id: 'a', createdAt: 3_000 }, 2_000)).toBe(false)
  })
})
