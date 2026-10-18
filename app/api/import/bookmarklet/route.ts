import { NextRequest, NextResponse } from 'next/server'
import { completeArticle, saveBookmark } from '@/lib/bookmark-store'
import { downloadBookmarkMedia } from '@/lib/media-store'
import { GraphqlTweet, ParsedBookmark, parseGraphqlTweet } from '@/lib/parser'
import { parseWeiboStatus, weiboId, WeiboStatus } from '@/lib/weibo'

const ALLOWED_ORIGINS = new Set(['https://x.com', 'https://twitter.com', 'https://weibo.com', 'https://www.weibo.com'])

function corsHeaders(request: NextRequest) {
  const origin = request.headers.get('Origin') ?? ''
  const allowed = ALLOWED_ORIGINS.has(origin) ? origin : 'https://x.com'
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  }
}

function isWeiboStatus(raw: unknown): raw is WeiboStatus {
  return !!raw && typeof raw === 'object' && /^\d+$/.test(weiboId(raw as WeiboStatus))
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) })
}

// Receives raw posts captured by the bookmarklet (relayed via /import/receive):
// X GraphQL tweet objects, or Weibo web API statuses when platform is 'weibo'.
// Same-origin callers ignore the CORS headers.
export async function POST(request: NextRequest): Promise<NextResponse> {
  const cors = corsHeaders(request)
  let body: { tweets?: unknown[]; source?: string; platform?: string } = {}
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400, headers: cors })
  }

  const weibo = body.platform === 'weibo'
  // 'complete': X Article bodies captured on article pages; update saved rows only.
  const complete = !weibo && body.source === 'complete'
  const source = body.source === 'like' ? 'like' : 'bookmark'
  const tweets = body.tweets ?? []
  if (!Array.isArray(tweets) || tweets.length === 0) {
    return NextResponse.json({ error: 'No tweets provided' }, { status: 400, headers: cors })
  }

  let imported = 0
  let updated = 0
  let skipped = 0

  const weiboIds: string[] = []
  for (const raw of tweets) {
    const bookmark: ParsedBookmark | null = weibo
      ? isWeiboStatus(raw) ? parseWeiboStatus(raw) : null
      : parseGraphqlTweet(raw as GraphqlTweet)
    if (!bookmark) continue

    const result = complete ? await completeArticle(bookmark) : await saveBookmark(bookmark, source)
    if (result === 'imported') imported++
    else if (result === 'updated') updated++
    else skipped++
    if (weibo) weiboIds.push(bookmark.tweetId, ...(bookmark.quoted ? [bookmark.quoted.tweetId] : []))
  }

  // Weibo's video URLs are signed and (we assume) expire within hours, while the
  // pipeline's media stage may only run after a long AI run already going: fetch
  // now, in the background. Files already on disk are skipped; failures are
  // retried by the media stage.
  for (const id of weiboIds) {
    downloadBookmarkMedia(id).catch((err) => console.warn(`[media] weibo download error tweet=${id}`, err))
  }

  return NextResponse.json({ imported, updated, skipped }, { headers: cors })
}
