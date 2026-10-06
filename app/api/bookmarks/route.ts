import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { toBookmarkCards } from '@/lib/bookmark-dto'

const DEFAULT_PAGE = 1
const DEFAULT_LIMIT = 24
const MAX_LIMIT = 100

function parseIntParam(value: string | null, defaultValue: number): number {
  if (!value) return defaultValue
  const parsed = parseInt(value, 10)
  return isNaN(parsed) || parsed < 1 ? defaultValue : parsed
}

export async function DELETE(): Promise<NextResponse> {
  try {
    // Delete media items and category links first (cascade), then bookmarks
    await prisma.$transaction([
      prisma.bookmarkCategory.deleteMany({}),
      prisma.mediaItem.deleteMany({}),
      prisma.bookmark.deleteMany({}),
      prisma.category.deleteMany({}),
    ])
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Clear bookmarks error:', err)
    return NextResponse.json(
      { error: `Failed to clear bookmarks: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url)

  const q = searchParams.get('q')?.trim() ?? ''
  const source = searchParams.get('source')?.trim() ?? ''
  const categorySlug = searchParams.get('category')?.trim() ?? ''
  const mediaType = searchParams.get('mediaType')?.trim() ?? ''
  const tweetId = searchParams.get('tweetId')?.trim() ?? ''
  const uncategorized = searchParams.get('uncategorized') === 'true'
  const sortParam = searchParams.get('sort')?.trim() ?? 'newest'
  const page = parseIntParam(searchParams.get('page'), DEFAULT_PAGE)
  const limit = Math.min(parseIntParam(searchParams.get('limit'), DEFAULT_LIMIT), MAX_LIMIT)
  const skip = (page - 1) * limit
  const orderDir = sortParam === 'oldest' ? 'asc' : 'desc'

  const where: Record<string, unknown> = {}

  // One bookmark by tweet id (e.g. a mindmap node opening the full-tweet dialog)
  if (tweetId) where.tweetId = tweetId

  if (source === 'bookmark' || source === 'like') {
    where.source = source
  }

  if (q) {
    where.OR = [{ text: { contains: q } }, { note: { contains: q } }]
  }

  if (uncategorized) {
    where.categories = { none: {} }
  } else if (categorySlug) {
    where.categories = {
      some: {
        category: { slug: categorySlug },
      },
    }
  }

  if (mediaType === 'photo' || mediaType === 'video') {
    where.mediaItems = {
      some: { type: mediaType },
    }
  }

  try {
    const [bookmarks, total] = await Promise.all([
      prisma.bookmark.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ tweetCreatedAt: orderDir }, { importedAt: orderDir }],
        include: {
          mediaItems: true,
          categories: {
            include: {
              category: {
                select: {
                  id: true,
                  name: true,
                  slug: true,
                  color: true,
                },
              },
            },
          },
        },
      }),
      prisma.bookmark.count({ where }),
    ])

    const formatted = await toBookmarkCards(bookmarks)

    return NextResponse.json({
      bookmarks: formatted,
      total,
      page,
      limit,
    })
  } catch (err) {
    console.error('Bookmarks fetch error:', err)
    return NextResponse.json(
      { error: `Failed to fetch bookmarks: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    )
  }
}
