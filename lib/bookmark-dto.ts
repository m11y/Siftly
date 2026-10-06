import prisma from '@/lib/db'
import { displayEntities } from '@/lib/rawjson-extractor'
import type { BookmarkWithMedia, QuotedTweetView } from '@/lib/types'

/** The Prisma bookmark shape every card-feeding query loads (via include or select). */
export interface BookmarkRow {
  id: string
  tweetId: string
  text: string
  authorHandle: string
  authorName: string
  source?: string
  platform?: string
  quotedTweetId?: string | null
  note?: string | null
  tweetCreatedAt: Date | null
  importedAt: Date
  entities: string | null
  mediaItems: { id: string; type: string; url: string; thumbnailUrl: string | null; imageTags?: string | null }[]
  categories: { confidence: number; category: { id: string; name: string; slug: string; color: string } }[]
}

/**
 * The one mapping from a database row to what <BookmarkCard> renders. Every page
 * and API that shows cards must go through it, so a new card field (e.g. links,
 * quoted tweet) reaches all of them at once instead of only the ones remembered.
 */
export function toBookmarkWithMedia(b: BookmarkRow, quotedRow?: QuotedRow): BookmarkWithMedia {
  const { links, quoted: snapshot, articlePreview } = displayEntities(b.entities)
  return {
    id: b.id,
    tweetId: b.tweetId,
    text: b.text,
    authorHandle: b.authorHandle,
    authorName: b.authorName,
    ...(b.source !== undefined ? { source: b.source } : {}),
    ...(b.platform !== undefined ? { platform: b.platform } : {}),
    tweetCreatedAt: b.tweetCreatedAt?.toISOString() ?? null,
    importedAt: b.importedAt.toISOString(),
    links,
    articlePreview,
    quotedTweetId: b.quotedTweetId ?? null,
    quoted: quotedRow ? quotedView(quotedRow) : snapshot,
    note: b.note ?? null,
    mediaItems: b.mediaItems.map((m) => ({
      id: m.id,
      type: m.type,
      url: m.url,
      thumbnailUrl: m.thumbnailUrl,
      ...(m.imageTags !== undefined ? { imageTags: m.imageTags } : {}),
    })),
    categories: b.categories.map((bc) => ({
      id: bc.category.id,
      name: bc.category.name,
      slug: bc.category.slug,
      color: bc.category.color,
      confidence: bc.confidence,
    })),
  }
}

const QUOTED_SELECT = {
  tweetId: true,
  text: true,
  authorHandle: true,
  authorName: true,
  entities: true,
  quotedTweetId: true,
  mediaItems: { select: { id: true, type: true, url: true, thumbnailUrl: true } },
} as const

type QuotedRow = {
  tweetId: string
  text: string
  authorHandle: string
  authorName: string
  entities: string | null
  quotedTweetId: string | null
  mediaItems: { id: string; type: string; url: string; thumbnailUrl: string | null }[]
}

function quotedView(q: QuotedRow): QuotedTweetView {
  return {
    tweetId: q.tweetId,
    authorName: q.authorName,
    authorHandle: q.authorHandle,
    text: q.text,
    links: displayEntities(q.entities).links,
    media: q.mediaItems,
    quotedTweetId: q.quotedTweetId,
  }
}

/**
 * Map rows to cards, loading each quoted tweet's own row (when saved) in one
 * query, so a quote shows the quoted tweet's media and stays in sync with it.
 * Rows without a saved quoted row fall back to the snapshot in their entities.
 */
export async function toBookmarkCards(rows: BookmarkRow[]): Promise<BookmarkWithMedia[]> {
  const ids = [...new Set(rows.map((r) => r.quotedTweetId).filter((id): id is string => !!id))]
  const quotedRows = ids.length
    ? await prisma.bookmark.findMany({ where: { tweetId: { in: ids } }, select: QUOTED_SELECT })
    : []
  const byId = new Map(quotedRows.map((q) => [q.tweetId, q]))
  return rows.map((r) => toBookmarkWithMedia(r, r.quotedTweetId ? byId.get(r.quotedTweetId) : undefined))
}
