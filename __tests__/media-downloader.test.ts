import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'

const dir = mkdtempSync(path.join(tmpdir(), 'siftly-media-'))
let started: string[] = []
let active = 0
let maxActive = 0

beforeAll(() => {
  process.env.MEDIA_DIR = dir
  vi.stubGlobal('fetch', async (url: string) => {
    started.push(url)
    active++
    maxActive = Math.max(maxActive, active)
    await new Promise((r) => setTimeout(r, 150))
    active--
    return new Response('x'.repeat(600))
  })
})

afterAll(() => {
  vi.unstubAllGlobals()
  rmSync(dir, { recursive: true, force: true })
})

const target = (name: string) => ({ name, candidates: [`https://pbs.twimg.com/media/${name}`], timeoutMs: 5000 })

describe('ensureMedia', () => {
  it('limits concurrency to 2, shares one download per file, and skips files on disk', async () => {
    vi.resetModules()
    const { ensureMedia } = await import('@/lib/media-store')
    started = []; maxActive = 0

    const results = await Promise.all([
      ensureMedia('1', target('a.jpg')),
      ensureMedia('1', target('a.jpg')), // same file, concurrent caller
      ensureMedia('1', target('b.jpg')),
      ensureMedia('2', target('c.jpg')),
      ensureMedia('2', target('d.jpg')),
    ])
    expect(results).toEqual(['downloaded', 'downloaded', 'downloaded', 'downloaded', 'downloaded'])
    expect(started).toHaveLength(4)
    expect(maxActive).toBe(2)
    expect(existsSync(path.join(dir, '1', 'a.jpg'))).toBe(true)
    expect(existsSync(path.join(dir, '1', 'a.jpg.part'))).toBe(false)

    expect(await ensureMedia('1', target('a.jpg'))).toBe('kept')
    expect(started).toHaveLength(4)
  })

  it('lets urgent (page) requests jump ahead of queued pipeline downloads', async () => {
    vi.resetModules()
    const { ensureMedia } = await import('@/lib/media-store')
    started = []

    const jobs = ['p1', 'p2', 'p3', 'p4'].map((n) => ensureMedia('3', target(`${n}.jpg`)))
    // wait until p1/p2 hold both slots; p3/p4 cannot start before one of them ends
    while (started.length < 2) await new Promise((r) => setTimeout(r, 1))
    const urgent = ensureMedia('3', target('page.jpg'), { urgent: true })
    await Promise.all([...jobs, urgent])
    const order = started.map((u) => u.split('/').pop())
    expect(order.indexOf('page.jpg')).toBe(2)
  })
})
