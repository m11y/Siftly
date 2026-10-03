import { NextRequest, NextResponse } from 'next/server'
import { createReadStream } from 'fs'
import { stat } from 'fs/promises'
import path from 'path'
import { Readable } from 'stream'
import prisma from '@/lib/db'
import { avatarUrlFromRaw, ensureMedia, fileExists, largeAvatarUrl, localPathFor, targetForUrl } from '@/lib/media-store'

const ALLOWED_HOSTS = new Set([
  'pbs.twimg.com',
  'video.twimg.com',
  'ton.twimg.com',
  'abs.twimg.com',
  'unavatar.io',
])

function isAllowedUrl(urlStr: string): boolean {
  try {
    const { protocol, hostname } = new URL(urlStr)
    return protocol === 'https:' && ALLOWED_HOSTS.has(hostname)
  } catch {
    return false
  }
}

function getFilename(urlStr: string, contentType: string): string {
  try {
    const pathname = new URL(urlStr).pathname
    const last = pathname.split('/').pop()?.split('?')[0] ?? ''
    if (last.includes('.')) return last
  } catch { /* ignore */ }
  if (contentType.includes('mp4')) return 'video.mp4'
  if (contentType.includes('jpeg') || contentType.includes('jpg')) return 'photo.jpg'
  if (contentType.includes('png')) return 'photo.png'
  if (contentType.includes('gif')) return 'animation.gif'
  if (contentType.includes('webp')) return 'photo.webp'
  return 'media.bin'
}

const CONTENT_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.webp': 'image/webp', '.mp4': 'video/mp4',
}

/** Serve a local media copy, honoring a single `bytes=` range for video seeking. */
async function serveLocalFile(filePath: string, rangeHeader: string | null, isDownload: boolean): Promise<NextResponse> {
  const { size } = await stat(filePath)
  const headers: Record<string, string> = {
    'Content-Type': CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream',
    'Cache-Control': 'public, max-age=86400',
    'Accept-Ranges': 'bytes',
  }
  if (isDownload) headers['Content-Disposition'] = `attachment; filename="${path.basename(filePath)}"`

  const range = rangeHeader?.match(/^bytes=(\d*)-(\d*)$/)
  if (range && (range[1] || range[2])) {
    // "bytes=-N" means the last N bytes
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]))
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1
    if (start >= size || start > end) {
      return new NextResponse(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
    }
    headers['Content-Range'] = `bytes ${start}-${end}/${size}`
    headers['Content-Length'] = String(end - start + 1)
    const body = Readable.toWeb(createReadStream(filePath, { start, end })) as ReadableStream
    return new NextResponse(body, { status: 206, headers })
  }

  headers['Content-Length'] = String(size)
  return new NextResponse(Readable.toWeb(createReadStream(filePath)) as ReadableStream, { status: 200, headers })
}

/** ?tweetId=…&kind=avatar resolves the author avatar from the stored tweet JSON. */
async function avatarUrlForTweet(tweetId: string): Promise<string | null> {
  const b = await prisma.bookmark.findUnique({ where: { tweetId }, select: { rawJson: true } })
  if (!b) return null
  try {
    const url = avatarUrlFromRaw(JSON.parse(b.rawJson))
    return url ? largeAvatarUrl(url) : null
  } catch {
    return null
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url)
  const tweetId = searchParams.get('tweetId')
  const isDownload = searchParams.get('download') === '1'
  const mediaUrl = searchParams.get('kind') === 'avatar' && tweetId
    ? await avatarUrlForTweet(tweetId)
    : searchParams.get('url')

  if (!mediaUrl) {
    return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 })
  }

  if (!isAllowedUrl(mediaUrl)) {
    return NextResponse.json({ error: 'URL not allowed' }, { status: 403 })
  }

  // Range header: forwarded upstream, or applied to the local file, so video seeking works
  const rangeHeader = request.headers.get('range')

  // A bookmark's own media is always served from disk. When the file is missing,
  // download it now and only then respond: single-user local setup, so a page
  // showing an image guarantees it is saved (see MediaDownloader in lib/media-store.ts).
  const localPath = tweetId ? localPathFor(tweetId, mediaUrl) : null
  if (localPath && tweetId) {
    if (await fileExists(localPath)) return serveLocalFile(localPath, rangeHeader, isDownload)
    const target = await targetForUrl(tweetId, mediaUrl)
    if (target) {
      const result = await ensureMedia(tweetId, target, { urgent: true })
      return result === 'failed'
        ? NextResponse.json({ error: 'Media download failed' }, { status: 502 })
        : serveLocalFile(localPath, rangeHeader, isDownload)
    }
  }

  // Not one of the bookmark's media (or no tweetId): plain proxy, nothing saved.

  try {

    const upstream = await fetch(mediaUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Referer': 'https://twitter.com/',
        'Origin': 'https://twitter.com',
        'Accept': '*/*',
        ...(rangeHeader ? { 'Range': rangeHeader } : {}),
      },
    })

    // 206 Partial Content is success for range requests
    if (!upstream.ok) {
      return new NextResponse(null, { status: upstream.status })
    }

    const contentType = upstream.headers.get('content-type') ?? 'application/octet-stream'
    const responseHeaders: Record<string, string> = {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=86400',
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*',
    }

    // Forward range-related headers so browser can seek into videos
    const contentRange = upstream.headers.get('content-range')
    if (contentRange) responseHeaders['Content-Range'] = contentRange
    const contentLength = upstream.headers.get('content-length')
    if (contentLength) responseHeaders['Content-Length'] = contentLength

    if (isDownload) {
      const filename = getFilename(mediaUrl, contentType)
      responseHeaders['Content-Disposition'] = `attachment; filename="${filename}"`
    }

    // Preserve upstream status (200 or 206) — critical for video range requests
    return new NextResponse(upstream.body, { status: upstream.status, headers: responseHeaders })
  } catch (err) {
    console.error('Media proxy error:', err)
    return NextResponse.json({ error: 'Upstream fetch failed' }, { status: 502 })
  }
}
