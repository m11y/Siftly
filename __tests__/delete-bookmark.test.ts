import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execSync } from 'child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'

// A real SQLite DB and media folder: the delete spans both inside one transaction.
const dir = mkdtempSync(path.join(tmpdir(), 'siftly-delete-'))
const mediaDir = path.join(dir, 'media')
process.env.DATABASE_URL = `file:${path.join(dir, 'test.db')}`
process.env.MEDIA_DIR = mediaDir

type Mods = {
  prisma: typeof import('@/lib/db').default
  store: typeof import('@/lib/bookmark-store')
  parser: typeof import('@/lib/parser')
  fts: typeof import('@/lib/fts')
}
let m: Mods

beforeAll(async () => {
  execSync('./node_modules/.bin/prisma migrate deploy', { env: process.env, stdio: 'ignore' })
  m = {
    prisma: (await import('@/lib/db')).default,
    store: await import('@/lib/bookmark-store'),
    parser: await import('@/lib/parser'),
    fts: await import('@/lib/fts'),
  }
})

afterAll(async () => {
  await m?.prisma.$disconnect()
  chmodSync(mediaDir, 0o755)
  rmSync(dir, { recursive: true, force: true })
})

const user = (h: string) => ({ core: { user_results: { result: { core: { screen_name: h, name: h } } } } })
const tweet = (id: string, extra: Record<string, unknown> = {}) => ({
  __typename: 'Tweet', rest_id: id, ...user('alice'),
  legacy: {
    full_text: `tweet ${id}`,
    extended_entities: { media: [{ type: 'photo', media_url_https: `https://pbs.twimg.com/media/P${id}.jpg` }] },
  },
  ...extra,
})

async function save(raw: Record<string, unknown>) {
  await m.store.saveBookmark(m.parser.parseGraphqlTweet(raw)!, 'like')
  const row = await m.prisma.bookmark.findUniqueOrThrow({ where: { tweetId: raw.rest_id as string } })
  const folder = path.join(mediaDir, row.tweetId)
  mkdirSync(folder, { recursive: true })
  writeFileSync(path.join(folder, `P${row.tweetId}.jpg`), 'x')
  return { id: row.id, folder }
}

const ftsIds = async () =>
  (await m.prisma.$queryRaw<{ bookmark_id: string }[]>`SELECT bookmark_id FROM bookmark_fts`).map((r) => r.bookmark_id)

describe('deleteBookmark', () => {
  it('removes the row, its media rows, FTS row and folder; leaves the quoted tweet', async () => {
    const quoted = tweet('20')
    const { id, folder } = await save(tweet('10', { legacy: { full_text: 'A', quoted_status_id_str: '20' }, quoted_status_result: { result: quoted } }))
    await m.fts.rebuildFts()
    expect(await ftsIds()).toContain(id)

    expect(await m.store.deleteBookmark(id)).toBe(true)

    expect(await m.prisma.bookmark.findUnique({ where: { id } })).toBeNull()
    expect(await m.prisma.mediaItem.count({ where: { bookmarkId: id } })).toBe(0)
    expect(await ftsIds()).not.toContain(id)
    expect(existsSync(folder)).toBe(false)
    expect(await m.prisma.bookmark.findUnique({ where: { tweetId: '20' } })).not.toBeNull()
  })

  it('is idempotent: deleting again reports false', async () => {
    const { id } = await save(tweet('30'))
    expect(await m.store.deleteBookmark(id)).toBe(true)
    expect(await m.store.deleteBookmark(id)).toBe(false)
  })

  it('rolls the rows back when the folder cannot be removed, and a retry succeeds', async () => {
    const { id, folder } = await save(tweet('40'))
    chmodSync(mediaDir, 0o555) // the folder's parent is read-only: rm fails
    try {
      await expect(m.store.deleteBookmark(id)).rejects.toThrow()
    } finally {
      chmodSync(mediaDir, 0o755)
    }
    expect(await m.prisma.bookmark.findUnique({ where: { id } })).not.toBeNull()
    expect(await m.prisma.mediaItem.count({ where: { bookmarkId: id } })).toBe(1)
    expect(existsSync(folder)).toBe(true)

    expect(await m.store.deleteBookmark(id)).toBe(true)
    expect(existsSync(folder)).toBe(false)
  })
})
