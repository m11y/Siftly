import { describe, it, expect } from 'vitest'
import { asPlatform, mentionUrl, postUrl, postUrlById, profileUrl } from '@/lib/platform'

describe('platform links', () => {
  it('treats anything but weibo as X (rows saved before the column existed)', () => {
    expect(asPlatform(undefined)).toBe('x')
    expect(asPlatform(null)).toBe('x')
    expect(asPlatform('x')).toBe('x')
    expect(asPlatform('weibo')).toBe('weibo')
  })

  it('keeps the X links the UI used before', () => {
    expect(postUrl({ tweetId: '123', authorHandle: 'alice' })).toBe('https://x.com/alice/status/123')
    expect(postUrl({ platform: 'x', tweetId: '123', authorHandle: 'unknown' })).toBe('https://x.com/i/web/status/123')
    expect(postUrlById('x', '123')).toBe('https://x.com/i/web/status/123')
    expect(profileUrl(undefined, 'alice')).toBe('https://x.com/alice')
    expect(mentionUrl(undefined, 'alice')).toBe('https://x.com/alice')
  })

  it('builds Weibo links from uid, mblogid and nickname', () => {
    expect(postUrl({ platform: 'weibo', tweetId: '5292638225040846', authorHandle: '1801840295', mblogid: 'Q9abcDEF' }))
      .toBe('https://weibo.com/1801840295/Q9abcDEF')
    expect(postUrl({ platform: 'weibo', tweetId: '5292638225040846', authorHandle: '1801840295' }))
      .toBe('https://weibo.com/detail/5292638225040846')
    expect(profileUrl('weibo', '1801840295')).toBe('https://weibo.com/u/1801840295')
    expect(mentionUrl('weibo', '来去之间')).toBe('https://weibo.com/n/%E6%9D%A5%E5%8E%BB%E4%B9%8B%E9%97%B4')
  })
})
