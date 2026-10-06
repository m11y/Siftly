import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execSync } from 'child_process'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'

// A real SQLite DB: a saved Weibo post comes back as a card with its platform data.
const dir = mkdtempSync(path.join(tmpdir(), 'siftly-weibo-'))
process.env.DATABASE_URL = `file:${path.join(dir, 'test.db')}`

let prisma: typeof import('@/lib/db').default

beforeAll(async () => {
  execSync('./node_modules/.bin/prisma migrate deploy', { env: process.env, stdio: 'ignore' })
  prisma = (await import('@/lib/db')).default
})

afterAll(async () => {
  await prisma?.$disconnect()
  rmSync(dir, { recursive: true, force: true })
})

describe('saved Weibo post as a card', () => {
  it('saves the repost and its original, and maps both to the card', async () => {
    const { parseWeiboStatus } = await import('@/lib/weibo')
    const { repost } = await import('./fixtures/weibo')
    const { saveBookmark } = await import('@/lib/bookmark-store')
    const { toBookmarkCards } = await import('@/lib/bookmark-dto')
    const { backfillEntities } = await import('@/lib/rawjson-extractor')

    expect(await saveBookmark(parseWeiboStatus(repost), 'bookmark')).toBe('imported')
    await backfillEntities() // X-only: must not overwrite the Weibo entities

    const rows = await prisma.bookmark.findMany({ orderBy: { tweetId: 'asc' }, include: { mediaItems: true, categories: { include: { category: true } } } })
    expect(rows.map((r) => [r.tweetId, r.platform, r.source])).toEqual([
      ['5000000000000001', 'weibo', 'bookmark'],
      ['5000000000000002', 'weibo', 'quote'],
    ])

    const [card] = await toBookmarkCards(rows.filter((r) => r.tweetId === '5000000000000001'))
    expect(card.platform).toBe('weibo')
    expect(card.weibo).toEqual({ mblogid: 'Rxyz', source: null, region: null })
    expect(card.quoted).toMatchObject({ tweetId: '5000000000000002', authorName: '原作者', mblogid: 'Pabc' })
    expect(card.quoted?.media?.map((m) => m.url)).toEqual(['https://wx1.sinaimg.cn/large/p1.jpg', 'https://wx1.sinaimg.cn/large/p2.jpg'])
  })
})
