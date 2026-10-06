import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execSync } from 'child_process'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { NextRequest } from 'next/server'

// A real SQLite DB: notes are a plain column matched by the list search.
const dir = mkdtempSync(path.join(tmpdir(), 'siftly-note-'))
process.env.DATABASE_URL = `file:${path.join(dir, 'test.db')}`

type Mods = {
  prisma: typeof import('@/lib/db').default
  store: typeof import('@/lib/bookmark-store')
  parser: typeof import('@/lib/parser')
  list: typeof import('@/app/api/bookmarks/route')
}
let m: Mods

beforeAll(async () => {
  execSync('./node_modules/.bin/prisma migrate deploy', { env: process.env, stdio: 'ignore' })
  m = {
    prisma: (await import('@/lib/db')).default,
    store: await import('@/lib/bookmark-store'),
    parser: await import('@/lib/parser'),
    list: await import('@/app/api/bookmarks/route'),
  }
})

afterAll(async () => {
  await m?.prisma.$disconnect()
  rmSync(dir, { recursive: true, force: true })
})

const graphqlTweet = (id: string, text: string) => ({
  __typename: 'Tweet', rest_id: id,
  core: { user_results: { result: { core: { screen_name: 'alice', name: 'Alice' } } } },
  legacy: { full_text: text },
})

async function search(q: string): Promise<{ tweetId: string; note?: string | null }[]> {
  const res = await m.list.GET(new NextRequest(`http://localhost/api/bookmarks?q=${encodeURIComponent(q)}`))
  return (await res.json()).bookmarks
}

describe('bookmark notes', () => {
  it('stores a trimmed note, clears on blank, and reports a missing bookmark', async () => {
    await m.store.saveBookmark(m.parser.parseGraphqlTweet(graphqlTweet('1', 'only a picture'))!, 'like')
    const { id } = await m.prisma.bookmark.findUniqueOrThrow({ where: { tweetId: '1' } })

    expect(await m.store.setNote(id, '  cat meme  ')).toBe('cat meme')
    expect((await m.prisma.bookmark.findUniqueOrThrow({ where: { id } })).note).toBe('cat meme')
    expect(await m.store.setNote(id, '   ')).toBeNull()
    expect((await m.prisma.bookmark.findUniqueOrThrow({ where: { id } })).note).toBeNull()
    expect(await m.store.setNote('no-such-id', 'x')).toBeUndefined()
  })

  it('is matched by the list search, alongside the tweet text', async () => {
    const { id } = await m.prisma.bookmark.findUniqueOrThrow({ where: { tweetId: '1' } })
    await m.store.setNote(id, 'funny cat meme')

    const byNote = await search('cat meme')
    expect(byNote.map((b) => b.tweetId)).toEqual(['1'])
    expect(byNote[0].note).toBe('funny cat meme')
    expect((await search('picture')).map((b) => b.tweetId)).toEqual(['1'])
    expect(await search('dog')).toEqual([])
  })

  it('survives the tweet being refreshed from X', async () => {
    // An old flattened-export row gets refreshed when X GraphQL JSON arrives.
    const row = await m.prisma.bookmark.create({
      data: { tweetId: '2', text: 'old', authorHandle: 'alice', authorName: 'Alice', rawJson: '{"id":"2"}', source: 'like', note: 'mine' },
    })
    expect(await m.store.saveBookmark(m.parser.parseGraphqlTweet(graphqlTweet('2', 'new text'))!, 'like')).toBe('updated')
    const after = await m.prisma.bookmark.findUniqueOrThrow({ where: { id: row.id } })
    expect(after.text).toBe('new text')
    expect(after.note).toBe('mine')
  })
})
