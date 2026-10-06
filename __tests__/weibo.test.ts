import { describe, it, expect } from 'vitest'
import { parseWeiboStatus, weiboMeta } from '@/lib/weibo'
import { original, repost } from './fixtures/weibo'
import { weiboSegments } from '@/components/tweet-text'
import { localName } from '@/lib/media-store'

describe('parseWeiboStatus', () => {
  it('maps a repost and its original', () => {
    const p = parseWeiboStatus(repost)
    expect(p).toMatchObject({
      platform: 'weibo', tweetId: '5000000000000001', authorHandle: '111', authorName: '我关注的人',
      quotedTweetId: '5000000000000002',
    })
    expect(p.tweetCreatedAt?.toISOString()).toBe('2026-04-02T08:00:00.000Z')
    expect(p.media).toEqual([{ type: 'video', url: 'https://f.video.weibocdn.com/o0/hd.mp4?x=1', thumbnailUrl: undefined }])
    // Photos keep the post's order (pic_ids), not pic_infos' key order.
    expect(p.quoted?.media.map((m) => m.url)).toEqual(['https://wx1.sinaimg.cn/large/p1.jpg', 'https://wx1.sinaimg.cn/large/p2.jpg'])
    expect(p.quoted?.hashtags).toEqual(['话题'])

    const e = JSON.parse(p.entities!)
    expect(e.v).toBeGreaterThan(0)
    expect(e.tweetType).toBe('quote')
    expect(e.mentions).toEqual(['中间人-A'])
    expect(e.links).toEqual([{ url: 'http://t.cn/A6abc', expandedUrl: 'http://t.cn/A6abc', displayUrl: 't.cn/A6abc' }])
    expect(e.quoted).toMatchObject({ tweetId: '5000000000000002', authorName: '原作者', authorHandle: '222' })
  })

  it('takes the client name and region without their markup', () => {
    expect(weiboMeta(original)).toEqual({ mblogid: 'Pabc', source: 'iPhone客户端', region: '北京' })
  })

  it('handles a deleted post without an author', () => {
    const p = parseWeiboStatus({ id: 5000000000000003, text_raw: '抱歉，此微博已被作者删除。', deleted: true, user: null })
    expect(p).toMatchObject({ authorHandle: 'unknown', authorName: '', media: [], quotedTweetId: null })
  })
})

describe('weiboSegments', () => {
  it('links URLs, #话题# and @nicknames; keeps emoji codes as text', () => {
    const segs = weiboSegments('好 //@中间人-A:看 #话题# [doge] http://t.cn/A6abc')
    expect(segs).toEqual([
      { text: '好 //' },
      { mention: '中间人-A' },
      { text: ':看 ' },
      { link: { url: '#话题#', expandedUrl: 'https://s.weibo.com/weibo?q=%23%E8%AF%9D%E9%A2%98%23', displayUrl: '#话题#' } },
      { text: ' [doge] ' },
      { link: { url: 'http://t.cn/A6abc', expandedUrl: 'http://t.cn/A6abc', displayUrl: 't.cn/A6abc' } },
    ])
  })
})

describe('Weibo media file names', () => {
  it('names sinaimg and weibocdn files by their last path segment', () => {
    expect(localName('https://wx1.sinaimg.cn/large/p1.jpg')).toBe('p1.jpg')
    expect(localName('https://f.video.weibocdn.com/o0/hd.mp4?x=1')).toBe('hd.mp4')
    expect(localName('https://example.com/a.jpg')).toBeNull()
  })
})
