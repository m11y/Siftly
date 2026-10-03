/**
 * Local copies of X media: tweet photos, videos (+ posters), author avatars and
 * link-card images, stored as MEDIA_DIR/<tweetId>/<X's own file name>.
 *
 * File existence is the only state: a download writes `<name>.part` and renames
 * it on success, so a present file is always complete. Every pipeline run tries
 * the missing ones again; nothing is marked as failed.
 */
import { createWriteStream } from 'fs'
import { access, mkdir, rename, rm } from 'fs/promises'
import path from 'path'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import type { ReadableStream as WebReadableStream } from 'stream/web'
import prisma from '@/lib/db'
import { runWithConcurrency } from '@/lib/concurrency'

export const MEDIA_DIR = process.env.MEDIA_DIR || path.join(process.cwd(), 'media')

// Reliability over speed: X's CDN may throttle bursts, and videos are large.
const DOWNLOAD_CONCURRENCY = 2
const PHOTO_TIMEOUT_MS = 60_000
const VIDEO_TIMEOUT_MS = 15 * 60_000

const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  Referer: 'https://twitter.com/',
}

const TWIMG_HOSTS = new Set(['pbs.twimg.com', 'video.twimg.com'])

/** One file to keep locally: candidate URLs tried in order, saved under `name`. */
export interface MediaTarget {
  name: string
  candidates: string[]
  timeoutMs: number
}

/**
 * Local file name for an X media URL: the last path segment, plus the extension
 * from `?format=` when the path has none (pbs.twimg.com/media/ID?format=jpg).
 * Variants of one image (name=orig/large/…) therefore share a file name.
 */
export function localName(url: string): string | null {
  let u: URL
  try { u = new URL(url) } catch { return null }
  if (!TWIMG_HOSTS.has(u.hostname)) return null
  let name = u.pathname.split('/').pop() ?? ''
  if (!name.includes('.')) {
    const format = u.searchParams.get('format')
    if (!format) return null
    name = `${name}.${format}`
  }
  return /^[\w.-]+$/.test(name) ? name : null
}

export function localPathFor(tweetId: string, url: string): string | null {
  const name = localName(url)
  if (!name || !/^\d+$/.test(tweetId)) return null
  return path.join(MEDIA_DIR, tweetId, name)
}

export async function fileExists(p: string): Promise<boolean> {
  try { await access(p); return true } catch { return false }
}

/** pbs.twimg.com image URL at each size, largest first, then the URL as stored. */
function imageCandidates(url: string): string[] {
  let u: URL
  try { u = new URL(url) } catch { return [] }
  const sized = ['orig', '4096x4096', 'large', 'medium'].map((size) => {
    const v = new URL(u)
    v.searchParams.set('name', size)
    return v.toString()
  })
  return [...new Set([...sized, url])]
}

// ── Collect targets from a bookmark ───────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */
function videoVariantUrls(raw: any, posterUrl: string | null): string[] {
  const media: any[] = raw?.legacy?.extended_entities?.media ?? raw?.legacy?.entities?.media ?? []
  const m = media.find((x) => x?.media_url_https === posterUrl)
  const variants: any[] = m?.video_info?.variants ?? []
  return variants
    .filter((v) => v?.content_type === 'video/mp4' && v.url)
    .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))
    .map((v) => String(v.url))
}

export function avatarUrlFromRaw(raw: any): string | null {
  const user = raw?.core?.user_results?.result
  const url: unknown = user?.avatar?.image_url ?? user?.legacy?.profile_image_url_https
  return typeof url === 'string' && url ? url : null
}

function cardImageUrlFromRaw(raw: any): string | null {
  const values: any[] = raw?.card?.legacy?.binding_values ?? []
  for (const key of ['photo_image_full_size_original', 'thumbnail_image_original', 'summary_photo_image_original']) {
    const url = values.find((v) => v?.key === key)?.value?.image_value?.url
    if (typeof url === 'string' && url) return url
  }
  return null
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** X serves `_normal` (48px) avatars; the 400x400 variant is the largest public one. */
export function largeAvatarUrl(url: string): string {
  return url.replace(/_normal(\.\w+)$/, '_400x400$1')
}

function isVideoUrl(url: string): boolean {
  return url.includes('video.twimg.com') || /\.mp4(\?|$)/.test(url)
}

export function collectTargets(b: {
  rawJson: string
  mediaItems: { type: string; url: string; thumbnailUrl: string | null }[]
}): MediaTarget[] {
  let raw: unknown = null
  try { raw = JSON.parse(b.rawJson) } catch { /* old imports may not be GraphQL JSON */ }

  const targets: MediaTarget[] = []
  const add = (candidates: string[], timeoutMs: number) => {
    const name = candidates.length ? localName(candidates[0]) : null
    if (name && !targets.some((t) => t.name === name)) targets.push({ name, candidates, timeoutMs })
  }

  for (const m of b.mediaItems) {
    if (m.type === 'photo') {
      add(imageCandidates(m.url), PHOTO_TIMEOUT_MS)
      continue
    }
    // video / gif: the mp4 itself (best bitrate first) and its poster image
    const poster = m.thumbnailUrl && !isVideoUrl(m.thumbnailUrl) ? m.thumbnailUrl : null
    const variants = videoVariantUrls(raw, poster)
    add(variants.length ? variants : [m.url], VIDEO_TIMEOUT_MS)
    if (poster) add(imageCandidates(poster), PHOTO_TIMEOUT_MS)
  }

  const avatar = avatarUrlFromRaw(raw)
  if (avatar) add([...new Set([largeAvatarUrl(avatar), avatar])], PHOTO_TIMEOUT_MS)

  const card = cardImageUrlFromRaw(raw)
  if (card) add(imageCandidates(card), PHOTO_TIMEOUT_MS)

  return targets
}

// ── Download ──────────────────────────────────────────────────────────────────

async function downloadTo(url: string, dest: string, timeoutMs: number): Promise<boolean> {
  const part = `${dest}.part`
  try {
    const res = await fetch(url, { headers: FETCH_HEADERS, signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok || !res.body) return false
    await pipeline(Readable.fromWeb(res.body as WebReadableStream), createWriteStream(part))
    await rename(part, dest)
    return true
  } catch {
    await rm(part, { force: true })
    return false
  }
}

/** Ensure one target exists locally. Returns 'kept' | 'downloaded' | 'failed'. */
async function ensureTarget(tweetId: string, t: MediaTarget): Promise<'kept' | 'downloaded' | 'failed'> {
  const dest = path.join(MEDIA_DIR, tweetId, t.name)
  if (await fileExists(dest)) return 'kept'
  await mkdir(path.dirname(dest), { recursive: true })
  for (const url of t.candidates) {
    if (await downloadTo(url, dest, t.timeoutMs)) return 'downloaded'
  }
  console.warn(`[media] download failed tweet=${tweetId} file=${t.name} candidates=${t.candidates.length}`)
  return 'failed'
}

/**
 * Download every missing media file for all bookmarks. Idempotent: files already
 * on disk are skipped, failures are simply retried by the next run.
 */
export async function downloadMissingMedia(
  onProgress?: (downloaded: number) => void,
  shouldAbort?: () => boolean,
): Promise<{ downloaded: number; failed: number }> {
  const CHUNK = 50
  let downloaded = 0
  let failed = 0
  let cursor: string | undefined

  while (!shouldAbort?.()) {
    const rows = await prisma.bookmark.findMany({
      ...(cursor ? { where: { id: { gt: cursor } } } : {}),
      orderBy: { id: 'asc' },
      take: CHUNK,
      select: {
        id: true,
        tweetId: true,
        rawJson: true,
        mediaItems: { select: { type: true, url: true, thumbnailUrl: true } },
      },
    })
    if (rows.length === 0) break
    cursor = rows[rows.length - 1].id

    const tasks = rows
      .filter((b) => /^\d+$/.test(b.tweetId))
      .flatMap((b) => collectTargets(b).map((t) => async () => {
        if (shouldAbort?.()) return
        const result = await ensureTarget(b.tweetId, t)
        if (result === 'downloaded') { downloaded++; onProgress?.(downloaded) }
        if (result === 'failed') failed++
      }))
    await runWithConcurrency(tasks, DOWNLOAD_CONCURRENCY)

    if (rows.length < CHUNK) break
  }

  return { downloaded, failed }
}
