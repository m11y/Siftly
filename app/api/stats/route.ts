import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { toBookmarkCards } from '@/lib/bookmark-dto'

export async function GET(): Promise<NextResponse> {
  try {
    const [
      totalBookmarks,
      bookmarkCount,
      likeCount,
      totalCategories,
      totalMedia,
      uncategorizedCount,
      recentBookmarks,
      topCategoriesRaw,
    ] = await Promise.all([
      prisma.bookmark.count(),
      prisma.bookmark.count({ where: { source: 'bookmark' } }),
      prisma.bookmark.count({ where: { source: 'like' } }),
      prisma.category.count(),
      prisma.mediaItem.count(),
      prisma.bookmark.count({ where: { enrichedAt: null } }),
      prisma.bookmark.findMany({
        take: 5,
        orderBy: { importedAt: 'desc' },
        include: {
          mediaItems: {
            select: { id: true, type: true, url: true, thumbnailUrl: true },
          },
          categories: {
            include: {
              category: {
                select: { id: true, name: true, slug: true, color: true },
              },
            },
          },
        },
      }),
      prisma.category.findMany({
        include: {
          _count: { select: { bookmarks: true } },
        },
        orderBy: {
          bookmarks: { _count: 'desc' },
        },
        take: 5,
      }),
    ])

    const formattedRecent = await toBookmarkCards(recentBookmarks)

    const topCategories = topCategoriesRaw.map((cat) => ({
      name: cat.name,
      slug: cat.slug,
      color: cat.color,
      count: cat._count.bookmarks,
    }))

    return NextResponse.json({
      totalBookmarks,
      bookmarkCount,
      likeCount,
      totalCategories,
      totalMedia,
      uncategorizedCount,
      recentBookmarks: formattedRecent,
      topCategories,
    })
  } catch (err) {
    console.error('Stats fetch error:', err)
    return NextResponse.json(
      { error: `Failed to fetch stats: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    )
  }
}
