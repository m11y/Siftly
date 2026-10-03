import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'

const MAX_IDS = 500

/**
 * Which of these tweet ids are saved in Siftly. Used by the bookmarklet (via the
 * /import/receive relay) to mark saved tweets while browsing X.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: { tweetIds?: unknown } = {}
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const ids = Array.isArray(body.tweetIds)
    ? [...new Set(body.tweetIds.filter((id): id is string => typeof id === 'string' && /^\d+$/.test(id)))].slice(0, MAX_IDS)
    : []
  if (ids.length === 0) return NextResponse.json({ existing: [] })

  const rows = await prisma.bookmark.findMany({ where: { tweetId: { in: ids } }, select: { tweetId: true } })
  return NextResponse.json({ existing: rows.map((r) => r.tweetId) })
}
