/**
 * Writing tweets into the Bookmark table. A tweet that another saved tweet
 * quotes is saved as its own row with source "quote" — a transitive bookmark:
 * it goes through the same pipeline (media, vision, tags, categories), counts and
 * filters like any other row, and only its source label differs.
 */
import prisma from '@/lib/db'
import { parseGraphqlTweet, type GraphqlTweet, type ParsedBookmark } from '@/lib/parser'

export type BookmarkSource = 'bookmark' | 'like' | 'quote'

/**
 * Save one parsed tweet (and, first, the tweet it quotes). Returns 'skipped' when
 * the tweet is already saved. A row that only existed as a quote is upgraded to
 * the new source when the user saves that tweet directly; never the reverse.
 */
export async function saveBookmark(b: ParsedBookmark, source: BookmarkSource): Promise<'imported' | 'skipped'> {
  if (b.quoted) await saveBookmark(b.quoted, 'quote')

  const existing = await prisma.bookmark.findUnique({
    where: { tweetId: b.tweetId },
    select: { id: true, source: true },
  })
  if (existing) {
    if (existing.source === 'quote' && source !== 'quote') {
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
