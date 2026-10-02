import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { GraphqlTweet, parseGraphqlTweet } from '@/lib/parser'

const ALLOWED_ORIGINS = new Set(['https://x.com', 'https://twitter.com'])

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

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) })
}

// Receives raw X GraphQL tweet objects captured by the bookmarklet (relayed via
// /import/receive). Same-origin callers ignore the CORS headers.
export async function POST(request: NextRequest): Promise<NextResponse> {
  const cors = corsHeaders(request)
  let body: { tweets?: GraphqlTweet[]; source?: string } = {}
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400, headers: cors })
  }

  const source = body.source === 'like' ? 'like' : 'bookmark'
  const tweets = body.tweets ?? []
  if (!Array.isArray(tweets) || tweets.length === 0) {
    return NextResponse.json({ error: 'No tweets provided' }, { status: 400, headers: cors })
  }

  let imported = 0
  let skipped = 0

  for (const raw of tweets) {
    const bookmark = parseGraphqlTweet(raw)
    if (!bookmark) continue

    const exists = await prisma.bookmark.findUnique({
      where: { tweetId: bookmark.tweetId },
      select: { id: true },
    })
    if (exists) {
      skipped++
      continue
    }

    const created = await prisma.bookmark.create({
      data: {
        tweetId: bookmark.tweetId,
        text: bookmark.text,
        authorHandle: bookmark.authorHandle,
        authorName: bookmark.authorName,
        tweetCreatedAt: bookmark.tweetCreatedAt,
        rawJson: bookmark.rawJson,
        source,
      },
    })

    if (bookmark.media.length > 0) {
      await prisma.mediaItem.createMany({
        data: bookmark.media.map((m) => ({
          bookmarkId: created.id,
          type: m.type,
          url: m.url,
          thumbnailUrl: m.thumbnailUrl ?? null,
        })),
      })
    }

    imported++
  }

  return NextResponse.json({ imported, skipped }, { headers: cors })
}
