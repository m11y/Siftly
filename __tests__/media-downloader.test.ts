import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'

const dir = mkdtempSync(path.join(tmpdir(), 'siftly-media-'))
let started: string[] = []
let active = 0
let maxActive = 0
// Per-URL gates: a gated download blocks until its gate is released, so a test
// controls exactly when a slot frees up instead of relying on timings.
const gates = new Map<string, Promise<void>>()

beforeAll(() => {
  process.env.MEDIA_DIR = dir
  vi.stubGlobal('fetch', async (url: string) => {
    started.push(url)
    active++
    maxActive = Math.max(maxActive, active)
    await (gates.get(url) ?? new Promise((r) => setTimeout(r, 30)))
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
    const { ensureMedia, queuedDownloads } = await import('@/lib/media-store')
    started = []

    const releases = new Map<string, () => void>()
    for (const n of ['p1', 'p2', 'p3', 'p4', 'page']) {
      const url = `https://pbs.twimg.com/media/${n}.jpg`
      gates.set(url, new Promise<void>((r) => releases.set(n, r)))
    }
    const jobs = ['p1', 'p2', 'p3', 'p4'].map((n) => ensureMedia('3', target(`${n}.jpg`)))
    const urgent = ensureMedia('3', target('page.jpg'), { urgent: true })
    // Wait until two downloads hold both slots and the other three are queued.
    while (started.length < 2 || queuedDownloads() < 3) await new Promise((r) => setTimeout(r, 5))
    const first = started.map((u) => u.split('/').pop()!.replace('.jpg', ''))
    // Free exactly one slot: the next download to start must be the urgent one,
    // unless page itself won a slot initially.
    releases.get(first[0])!()
    while (started.length < 3) await new Promise((r) => setTimeout(r, 5))
    for (const r of releases.values()) r()
    await Promise.all([...jobs, urgent])
    gates.clear()
    const order = started.map((u) => u.split('/').pop())
    expect(order.indexOf('page.jpg'), order.join(',')).toBeLessThanOrEqual(2)
  })
})
