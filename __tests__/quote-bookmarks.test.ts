import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execSync } from 'child_process'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'

// A real SQLite DB: these tests cover the row-level contract of quote saving.
const dir = mkdtempSync(path.join(tmpdir(), 'siftly-quote-'))
process.env.DATABASE_URL = `file:${path.join(dir, 'test.db')}`

type Mods = {
  prisma: typeof import('@/lib/db').default
  store: typeof import('@/lib/bookmark-store')
  parser: typeof import('@/lib/parser')
  dto: typeof import('@/lib/bookmark-dto')
}
let m: Mods

beforeAll(async () => {
  execSync('./node_modules/.bin/prisma migrate deploy', { env: process.env, stdio: 'ignore' })
  m = {
    prisma: (await import('@/lib/db')).default,
    store: await import('@/lib/bookmark-store'),
    parser: await import('@/lib/parser'),
    dto: await import('@/lib/bookmark-dto'),
  }
})

afterAll(async () => {
  await m?.prisma.$disconnect()
  rmSync(dir, { recursive: true, force: true })
})

const user = (h: string) => ({ core: { user_results: { result: { core: { screen_name: h, name: h.toUpperCase() } } } } })
const quotedB = {
  __typename: 'Tweet', rest_id: '200', ...user('bob'),
  legacy: {
    full_text: 'B text https://t.co/m', quoted_status_id_str: '300',
    extended_entities: { media: [{ type: 'photo', media_url_https: 'https://pbs.twimg.com/media/Bpic.jpg' }] },
  },
}
const tweetA = (id: string) => ({
  __typename: 'Tweet', rest_id: id, ...user('alice'),
  legacy: { full_text: 'A quotes B', quoted_status_id_str: '200' },
  quoted_status_result: { result: quotedB },
})

describe('quoted tweets as transitive bookmarks', () => {
  it('parses the quoted tweet and its id', () => {
    const a = m.parser.parseGraphqlTweet(tweetA('100'))!
    expect(a.quotedTweetId).toBe('200')
    expect(a.quoted?.tweetId).toBe('200')
    expect(a.quoted?.quotedTweetId).toBe('300') // B quotes C, sent as an id only
    expect(a.quoted?.quoted).toBeNull()
  })

  it('saves B as a "quote" row and links A to it', async () => {
    const a = m.parser.parseGraphqlTweet(tweetA('100'))!
    expect(await m.store.saveBookmark(a, 'like')).toBe('imported')
    const rows = await m.prisma.bookmark.findMany({ orderBy: { tweetId: 'asc' }, select: { tweetId: true, source: true, quotedTweetId: true } })
    expect(rows).toEqual([
      { tweetId: '100', source: 'like', quotedTweetId: '200' },
      { tweetId: '200', source: 'quote', quotedTweetId: '300' },
    ])
    expect(await m.prisma.mediaItem.count({ where: { bookmark: { tweetId: '200' } } })).toBe(1)
    expect(await m.store.saveBookmark(a, 'like')).toBe('skipped')
  })

  it('upgrades a quote row when the user saves that tweet directly, never downgrades', async () => {
    const b = m.parser.parseGraphqlTweet(quotedB)!
    expect(await m.store.saveBookmark(b, 'bookmark')).toBe('imported')
    expect(await m.store.saveBookmark(b, 'quote')).toBe('skipped')
    expect((await m.prisma.bookmark.findUnique({ where: { tweetId: '200' } }))?.source).toBe('bookmark')
  })

  it('links quotes of rows saved before quotedTweetId existed, once', async () => {
    const old = { ...tweetA('101'), quoted_status_result: { result: { ...quotedB, rest_id: '201' } } }
    old.legacy = { ...old.legacy, quoted_status_id_str: '201' }
    await m.prisma.bookmark.create({ data: { tweetId: '101', text: 'old', authorHandle: 'alice', authorName: 'A', rawJson: JSON.stringify(old), source: 'like' } })
    expect(await m.store.linkQuotedTweets()).toBe(1)
    expect(await m.store.linkQuotedTweets()).toBe(0)
    expect((await m.prisma.bookmark.findUnique({ where: { tweetId: '101' } }))?.quotedTweetId).toBe('201')
    expect((await m.prisma.bookmark.findUnique({ where: { tweetId: '201' } }))?.source).toBe('quote')
  })

  it('cards show the quoted row with its media, else the entities snapshot', async () => {
    const rows = await m.prisma.bookmark.findMany({ where: { tweetId: { in: ['100', '102'] } }, include: { mediaItems: true, categories: { include: { category: true } } } })
    await m.prisma.bookmark.create({ data: {
      tweetId: '102', text: 'quotes a deleted tweet', authorHandle: 'alice', authorName: 'A', rawJson: '{}', quotedTweetId: '999',
      entities: JSON.stringify({ v: 2, links: [], quoted: { tweetId: '999', authorName: 'Z', authorHandle: 'z', text: 'snap', links: [] } }),
    } })
    const all = await m.prisma.bookmark.findMany({ where: { tweetId: { in: ['100', '102'] } }, include: { mediaItems: true, categories: { include: { category: true } } } })
    const cards = await m.dto.toBookmarkCards(all)
    const a = cards.find((c) => c.tweetId === '100')!
    expect(a.quoted?.tweetId).toBe('200')
    expect(a.quoted?.media?.map((x) => x.url)).toEqual(['https://pbs.twimg.com/media/Bpic.jpg'])
    expect(a.quoted?.quotedTweetId).toBe('300')
    const c = cards.find((x) => x.tweetId === '102')!
    expect(c.quoted).toMatchObject({ tweetId: '999', text: 'snap' })
    expect(rows.length).toBe(1)
  })
})

describe('refreshing rows saved by the old flattened file export', () => {
  it('replaces the tweet data, keeps AI results on unchanged photos, clears entities', async () => {
    const legacy = {
      id_str: '400', full_text: 'old text https://t.co/x https://t.co/m',
      entities: { urls: [{ expanded_url: 'https://example.com/' }] },
    }
    const row = await m.prisma.bookmark.create({ data: {
      tweetId: '400', text: legacy.full_text, authorHandle: 'unknown', authorName: 'Unknown',
      rawJson: JSON.stringify(legacy), source: 'bookmark', entities: '{"v":2,"links":[]}', semanticTags: '["kept"]',
      mediaItems: { create: [
        { type: 'photo', url: 'https://pbs.twimg.com/media/Keep.jpg', imageTags: '{"tags":["kept"]}' },
        { type: 'video', url: 'https://video.twimg.com/old.mp4', thumbnailUrl: 'https://video.twimg.com/old.mp4' },
      ] },
    } })
    const fresh = m.parser.parseGraphqlTweet({
      __typename: 'Tweet', rest_id: '400', ...user('carol'),
      legacy: {
        full_text: 'old text https://t.co/x https://t.co/m',
        entities: { urls: [{ url: 'https://t.co/x', expanded_url: 'https://example.com/', display_url: 'example.com' } as never] },
        extended_entities: { media: [
          { type: 'photo', media_url_https: 'https://pbs.twimg.com/media/Keep.jpg' },
          { type: 'video', media_url_https: 'https://pbs.twimg.com/poster.jpg', video_info: { variants: [{ content_type: 'video/mp4', bitrate: 1, url: 'https://video.twimg.com/new.mp4' }] } },
        ] },
      },
    })!
    expect(await m.store.saveBookmark(fresh, 'bookmark')).toBe('updated')
    expect(await m.store.saveBookmark(fresh, 'bookmark')).toBe('skipped') // now GraphQL: no second refresh

    const after = await m.prisma.bookmark.findUnique({ where: { id: row.id }, include: { mediaItems: { orderBy: { url: 'asc' } } } })
    expect(after).toMatchObject({ authorHandle: 'carol', entities: null, semanticTags: '["kept"]', source: 'bookmark' })
    expect(after!.mediaItems.map((x) => [x.url, x.thumbnailUrl, x.imageTags])).toEqual([
      ['https://pbs.twimg.com/media/Keep.jpg', 'https://pbs.twimg.com/media/Keep.jpg', '{"tags":["kept"]}'],
      ['https://video.twimg.com/new.mp4', 'https://pbs.twimg.com/poster.jpg', null],
    ])
  })
})
