/**
 * Writing tweets into the Bookmark table. A tweet that another saved tweet
 * quotes is saved as its own row with source "quote" — a transitive bookmark:
 * it goes through the same pipeline (media, vision, tags, categories), counts and
 * filters like any other row, and only its source label differs.
 */
import prisma from '@/lib/db'
import { hasArticleBody, parseGraphqlTweet, type GraphqlTweet, type ParsedBookmark } from '@/lib/parser'

export type BookmarkSource = 'bookmark' | 'like' | 'quote'

export type SaveResult = 'imported' | 'updated' | 'skipped'

/** X web GraphQL tweet JSON (what the bookmarklet sends) vs. the old flattened export rows. */
function isGraphqlJson(rawJson: string): boolean {
  try {
    const o = JSON.parse(rawJson) as Record<string, unknown>
    return typeof o?.rest_id === 'string'
  } catch {
    return false
  }
}

/**
 * Save one parsed tweet (and, first, the tweet it quotes).
 * - New tweet: 'imported'.
 * - Already saved from the old flattened file export, now arriving as X GraphQL
 *   JSON: the row is refreshed from it ('updated'), because the old format lost
 *   the t.co → URL mapping, long-post text, avatar, card, poster and quote.
 * - Otherwise 'skipped'. A row that only existed as a quote is upgraded to the
 *   new source when the user saves that tweet directly; never the reverse.
 */
export async function saveBookmark(b: ParsedBookmark, source: BookmarkSource): Promise<SaveResult> {
  if (b.quoted) await saveBookmark(b.quoted, 'quote')

  const existing = await prisma.bookmark.findUnique({
    where: { tweetId: b.tweetId },
    select: { id: true, source: true, rawJson: true },
  })
  if (existing) {
    const upgrade = existing.source === 'quote' && source !== 'quote'
    if (isGraphqlJson(b.rawJson) && !isGraphqlJson(existing.rawJson)) {
      await refreshFromGraphql(existing.id, b, upgrade ? source : undefined)
      return 'updated'
    }
    if (upgrade) {
      await prisma.bookmark.update({ where: { id: existing.id }, data: { source } })
      return 'imported'
    }
    return 'skipped'
  }

  const created = await prisma.bookmark.create({
    data: {
      tweetId: b.tweetId,
      text: b.text,
      authorHandle: b.authorHandle,
      authorName: b.authorName,
      tweetCreatedAt: b.tweetCreatedAt,
      rawJson: b.rawJson,
      source,
      quotedTweetId: b.quotedTweetId ?? null,
    },
  })
  if (b.media.length > 0) {
    await prisma.mediaItem.createMany({
      data: b.media.map((m) => ({
        bookmarkId: created.id,
        type: m.type,
        url: m.url,
        thumbnailUrl: m.thumbnailUrl ?? null,
      })),
    })
  }
  return 'imported'
}

function rawHasArticleBody(rawJson: string): boolean {
  try { return hasArticleBody(JSON.parse(rawJson) as GraphqlTweet) } catch { return false }
}

/**
 * Fill in an X Article's full body, captured when the user opened the article on
 * X (timelines only carry its preview). Only updates a row that is already saved
 * and still has just the preview — opening an article never creates a bookmark.
 */
export async function completeArticle(b: ParsedBookmark): Promise<'updated' | 'skipped'> {
  if (!rawHasArticleBody(b.rawJson)) return 'skipped'
  const existing = await prisma.bookmark.findUnique({ where: { tweetId: b.tweetId }, select: { id: true, rawJson: true } })
  if (!existing || rawHasArticleBody(existing.rawJson)) return 'skipped'
  await refreshFromGraphql(existing.id, b, undefined, { resetAi: true })
  return 'updated'
}

/**
 * Replace an old-format row's tweet data with the GraphQL version. AI results stay:
 * semantic tags, categories and vision on photos whose URL is unchanged. Entities
 * are cleared so the pipeline re-extracts them (links, quote), and the media stage
 * then fetches whatever was missing (avatar, poster, card image).
 */
async function refreshFromGraphql(
  id: string,
  b: ParsedBookmark,
  source?: BookmarkSource,
  opts: { resetAi?: boolean } = {},
): Promise<void> {
  const oldMedia = await prisma.mediaItem.findMany({ where: { bookmarkId: id }, select: { id: true, url: true } })
  const newUrls = new Set(b.media.map((m) => m.url))
  const keptByUrl = new Map(oldMedia.filter((m) => newUrls.has(m.url)).map((m) => [m.url, m.id]))

  await prisma.$transaction([
    prisma.bookmark.update({
      where: { id },
      data: {
        text: b.text,
        authorHandle: b.authorHandle,
        authorName: b.authorName,
        tweetCreatedAt: b.tweetCreatedAt,
        rawJson: b.rawJson,
        quotedTweetId: b.quotedTweetId ?? null,
        entities: null,
        ...(source ? { source } : {}),
        // The text changed substantially (preview → full article): redo tags and categories.
        ...(opts.resetAi ? { semanticTags: null, enrichmentMeta: null, enrichedAt: null } : {}),
      },
    }),
    prisma.mediaItem.deleteMany({ where: { bookmarkId: id, id: { notIn: [...keptByUrl.values()] } } }),
    ...b.media.map((m) => {
      const keptId = keptByUrl.get(m.url)
      return keptId
        ? prisma.mediaItem.update({ where: { id: keptId }, data: { type: m.type, thumbnailUrl: m.thumbnailUrl ?? null } })
        : prisma.mediaItem.create({ data: { bookmarkId: id, type: m.type, url: m.url, thumbnailUrl: m.thumbnailUrl ?? null } })
    }),
  ])
}

/**
 * Pipeline step for rows saved before quotedTweetId existed: read the quote from
 * rawJson, save the quoted tweet as a "quote" row and set quotedTweetId.
 * Idempotent — rows that already have quotedTweetId are not selected again.
 */
export async function linkQuotedTweets(shouldAbort?: () => boolean): Promise<number> {
  const rows = await prisma.bookmark.findMany({
    where: { quotedTweetId: null, rawJson: { contains: '"quoted_status_' } },
    select: { id: true, rawJson: true },
  })
  let linked = 0
  for (const row of rows) {
    if (shouldAbort?.()) break
    let parsed: ParsedBookmark | null = null
    try { parsed = parseGraphqlTweet(JSON.parse(row.rawJson) as GraphqlTweet) } catch { /* not GraphQL JSON */ }
    if (!parsed?.quotedTweetId) continue
    if (parsed.quoted) await saveBookmark(parsed.quoted, 'quote')
    await prisma.bookmark.update({ where: { id: row.id }, data: { quotedTweetId: parsed.quotedTweetId } })
    linked++
  }
  return linked
}
