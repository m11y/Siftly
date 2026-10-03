import { displayEntities } from '@/lib/rawjson-extractor'
import type { BookmarkWithMedia } from '@/lib/types'

/** The Prisma bookmark shape every card-feeding query loads (via include or select). */
export interface BookmarkRow {
  id: string
  tweetId: string
  text: string
  authorHandle: string
  authorName: string
  source?: string
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
export function toBookmarkWithMedia(b: BookmarkRow): BookmarkWithMedia {
  return {
    id: b.id,
    tweetId: b.tweetId,
    text: b.text,
    authorHandle: b.authorHandle,
    authorName: b.authorName,
    ...(b.source !== undefined ? { source: b.source } : {}),
    tweetCreatedAt: b.tweetCreatedAt?.toISOString() ?? null,
    importedAt: b.importedAt.toISOString(),
    ...displayEntities(b.entities),
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
