import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execSync } from 'child_process'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { NextRequest } from 'next/server'

// A real SQLite DB: X-only pipeline steps must leave posts from other platforms alone.
const dir = mkdtempSync(path.join(tmpdir(), 'siftly-platform-'))
process.env.DATABASE_URL = `file:${path.join(dir, 'test.db')}`

type Mods = {
  prisma: typeof import('@/lib/db').default
  store: typeof import('@/lib/bookmark-store')
  parser: typeof import('@/lib/parser')
  extractor: typeof import('@/lib/rawjson-extractor')
  list: typeof import('@/app/api/bookmarks/route')
}
let m: Mods

beforeAll(async () => {
  execSync('./node_modules/.bin/prisma migrate deploy', { env: process.env, stdio: 'ignore' })
  m = {
    prisma: (await import('@/lib/db')).default,
    store: await import('@/lib/bookmark-store'),
    parser: await import('@/lib/parser'),
    extractor: await import('@/lib/rawjson-extractor'),
    list: await import('@/app/api/bookmarks/route'),
  }
  await m.store.saveBookmark(m.parser.parseGraphqlTweet({
    __typename: 'Tweet', rest_id: '1900000000000000001',
    core: { user_results: { result: { core: { screen_name: 'alice', name: 'Alice' } } } },
    legacy: { full_text: 'an X post' },
  })!, 'like')
  // A Weibo row whose JSON happens to contain what the X steps look for.
  await m.prisma.bookmark.create({
    data: {
      tweetId: '5000000000000001', platform: 'weibo', text: '一条微博',
      authorHandle: '1801840295', authorName: '来去之间', source: 'bookmark',
      rawJson: JSON.stringify({ id: 5000000000000001, quoted_status_id_str: '1' }),
    },
  })
})

afterAll(async () => {
  await m?.prisma.$disconnect()
  rmSync(dir, { recursive: true, force: true })
})

const ids = async (query: string) => {
  const res = await m.list.GET(new NextRequest(`http://localhost/api/bookmarks?${query}`))
  return ((await res.json()).bookmarks as { tweetId: string; platform: string }[]).map((b) => `${b.platform}:${b.tweetId}`)
}

describe('platform column', () => {
  it('defaults to x for posts saved by the X importers', async () => {
    const row = await m.prisma.bookmark.findUniqueOrThrow({ where: { tweetId: '1900000000000000001' } })
    expect(row.platform).toBe('x')
  })

  it('X entity extraction and quote linking skip Weibo rows', async () => {
    await m.extractor.backfillEntities()
    await m.store.linkQuotedTweets()
    const weibo = await m.prisma.bookmark.findUniqueOrThrow({ where: { tweetId: '5000000000000001' } })
    expect(weibo.entities).toBeNull()
    expect(weibo.quotedTweetId).toBeNull()
    const x = await m.prisma.bookmark.findUniqueOrThrow({ where: { tweetId: '1900000000000000001' } })
    expect(x.entities).toContain('"v":')
  })

  it('the list filters by platform and returns it on each card', async () => {
    expect(await ids('platform=weibo')).toEqual(['weibo:5000000000000001'])
    expect(await ids('platform=x')).toEqual(['x:1900000000000000001'])
    expect((await ids('platform=bogus')).sort()).toEqual(['weibo:5000000000000001', 'x:1900000000000000001'])
  })
})
