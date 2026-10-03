export interface ParsedMedia {
  type: 'photo' | 'video' | 'gif'
  url: string
  thumbnailUrl?: string
}

export interface ParsedBookmark {
  tweetId: string
  text: string
  authorHandle: string
  authorName: string
  tweetCreatedAt: Date | null
  hashtags: string[]
  urls: string[]
  media: ParsedMedia[]
  rawJson: string
  /** Tweet this one quotes (from X GraphQL data only). */
  quotedTweetId?: string | null
  /** The quoted tweet itself, when X sent its content; saved as a "quote" row. */
  quoted?: ParsedBookmark | null
}

interface TwitterMediaVariant {
  content_type?: string
  bitrate?: number
  url?: string
}

interface TwitterMediaEntity {
  type?: string
  media_url_https?: string
  media_url?: string
  video_info?: {
    variants?: TwitterMediaVariant[]
  }
}

interface TwitterUrlEntity {
  expanded_url?: string
  url?: string
}

interface TwitterHashtagEntity {
  text?: string
}

interface TwitterEntities {
  hashtags?: TwitterHashtagEntity[]
  urls?: TwitterUrlEntity[]
  media?: TwitterMediaEntity[]
}

interface TwitterUser {
  screen_name?: string
  name?: string
}

interface RawTweet {
  id_str?: string
  id?: string | number
  full_text?: string
  text?: string
  created_at?: string
  user?: TwitterUser
  entities?: TwitterEntities
  extended_entities?: {
    media?: TwitterMediaEntity[]
  }
  [key: string]: unknown
}

function extractTweetId(tweet: RawTweet): string | null {
  const raw = tweet.id_str ?? tweet.id
  if (raw == null) return null
  return String(raw)
}

function extractText(tweet: RawTweet): string {
  return tweet.full_text ?? tweet.text ?? ''
}

function extractAuthorHandle(tweet: RawTweet): string {
  return tweet.user?.screen_name ?? 'unknown'
}

function extractAuthorName(tweet: RawTweet): string {
  return tweet.user?.name ?? 'Unknown'
}

function extractCreatedAt(tweet: RawTweet): Date | null {
  if (!tweet.created_at) return null
  const parsed = new Date(tweet.created_at)
  return isNaN(parsed.getTime()) ? null : parsed
}

function extractHashtags(tweet: RawTweet): string[] {
  const tags = tweet.entities?.hashtags ?? []
  return tags
    .map((h) => h.text ?? '')
    .filter((t) => t.length > 0)
}

function extractUrls(tweet: RawTweet): string[] {
  const urlEntities = tweet.entities?.urls ?? []
  return urlEntities
    .map((u) => u.expanded_url ?? u.url ?? '')
    .filter((u) => u.length > 0)
}

function pickHighestBitrateVariant(variants: TwitterMediaVariant[]): string | null {
  const videoVariants = variants.filter(
    (v) => v.content_type === 'video/mp4' && v.url
  )
  if (videoVariants.length === 0) return null

  const sorted = [...videoVariants].sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))
  return sorted[0].url ?? null
}

function mediaTypeFromString(type: string | undefined): 'photo' | 'video' | 'gif' {
  if (type === 'video') return 'video'
  if (type === 'animated_gif') return 'gif'
  return 'photo'
}

function extractMedia(tweet: RawTweet): ParsedMedia[] {
  const mediaEntities =
    tweet.extended_entities?.media ??
    tweet.entities?.media ??
    []

  return mediaEntities
    .map((m): ParsedMedia | null => {
      const mediaType = mediaTypeFromString(m.type)
      const thumbnailUrl = m.media_url_https ?? m.media_url ?? undefined

      if (mediaType === 'video' || mediaType === 'gif') {
        const variants = m.video_info?.variants ?? []
        const url = pickHighestBitrateVariant(variants) ?? thumbnailUrl ?? ''
        if (!url) return null
        return { type: mediaType, url, thumbnailUrl }
      }

      const url = thumbnailUrl ?? ''
      if (!url) return null
      return { type: 'photo', url, thumbnailUrl }
    })
    .filter((m): m is ParsedMedia => m !== null)
}

function parseSingleTweet(tweet: RawTweet): ParsedBookmark | null {
  const tweetId = extractTweetId(tweet)
  if (!tweetId) return null

  return {
    tweetId,
    text: extractText(tweet),
    authorHandle: extractAuthorHandle(tweet),
    authorName: extractAuthorName(tweet),
    tweetCreatedAt: extractCreatedAt(tweet),
    hashtags: extractHashtags(tweet),
    urls: extractUrls(tweet),
    media: extractMedia(tweet),
    rawJson: JSON.stringify(tweet),
  }
}

interface FlatExportRow {
  'Tweet Id'?: string
  'Full Text'?: string
  'Created At'?: string
  'User Screen Name'?: string
  'User Name'?: string
  'Media URLs'?: string
  'Media Types'?: string
  'Hashtags'?: string
  'Expanded URLs'?: string
  [key: string]: unknown
}

function isFlatExportFormat(item: unknown): item is FlatExportRow {
  if (typeof item !== 'object' || item === null) return false
  return 'Tweet Id' in item || 'Full Text' in item
}

function convertFlatExportRow(row: FlatExportRow): RawTweet {
  const mediaUrls = row['Media URLs'] ? row['Media URLs'].split(',').map((u) => u.trim()).filter(Boolean) : []
  const mediaTypes = row['Media Types'] ? row['Media Types'].split(',').map((t) => t.trim()).filter(Boolean) : []
  const mediaEntities: TwitterMediaEntity[] = mediaUrls.map((url, i) => {
    const rawType = mediaTypes[i] ?? 'photo'
    const type = rawType === 'video' ? 'video' : rawType === 'gif' ? 'animated_gif' : 'photo'
    if (type === 'video' || type === 'animated_gif') {
      return { type, media_url_https: url, video_info: { variants: [{ content_type: 'video/mp4', bitrate: 0, url }] } }
    }
    return { type, media_url_https: url }
  })

  const hashtags = row['Hashtags'] ? row['Hashtags'].split(',').map((h) => ({ text: h.trim() })).filter((h) => h.text) : []
  const urls = row['Expanded URLs'] ? row['Expanded URLs'].split(',').map((u) => ({ expanded_url: u.trim() })).filter((u) => u.expanded_url) : []

  return {
    id_str: row['Tweet Id'],
    full_text: row['Full Text'],
    created_at: row['Created At'],
    user: { screen_name: row['User Screen Name'], name: row['User Name'] },
    entities: { hashtags, urls, media: mediaEntities.length > 0 ? mediaEntities : undefined },
    extended_entities: mediaEntities.length > 0 ? { media: mediaEntities } : undefined,
  }
}

interface ConsoleExportBookmark {
  id?: string
  author?: string
  handle?: string
  timestamp?: string
  text?: string
  media?: { type?: string; url?: string }[]
  hashtags?: string[]
  urls?: string[]
}

function isConsoleExportFormat(obj: unknown): obj is { bookmarks: ConsoleExportBookmark[] } {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'bookmarks' in obj &&
    Array.isArray((obj as Record<string, unknown>).bookmarks)
  )
}

function convertConsoleExportRow(row: ConsoleExportBookmark): RawTweet {
  const mediaEntities: TwitterMediaEntity[] = (row.media ?? [])
    .filter((m) => m.url)
    .map((m) => {
      const type = m.type === 'video' ? 'video' : m.type === 'gif' ? 'animated_gif' : 'photo'
      if (type === 'video' || type === 'animated_gif') {
        return { type, media_url_https: m.url, video_info: { variants: [{ content_type: 'video/mp4', bitrate: 0, url: m.url! }] } }
      }
      return { type, media_url_https: m.url }
    })

  const handle = (row.handle ?? '').replace(/^@/, '')

  return {
    id_str: row.id,
    full_text: row.text,
    created_at: row.timestamp,
    user: { screen_name: handle || 'unknown', name: row.author || handle || 'Unknown' },
    entities: {
      hashtags: (row.hashtags ?? []).map((h) => ({ text: h })),
      urls: (row.urls ?? []).map((u) => ({ expanded_url: u })),
      media: mediaEntities.length > 0 ? mediaEntities : undefined,
    },
    extended_entities: mediaEntities.length > 0 ? { media: mediaEntities } : undefined,
  }
}

interface SiftlyExportItem {
  tweetId?: string
  text?: string
  authorHandle?: string
  authorName?: string
  tweetCreatedAt?: string
  mediaItems?: { type?: string; url?: string; thumbnailUrl?: string }[]
  [key: string]: unknown
}

function isSiftlyExportFormat(item: unknown): item is SiftlyExportItem {
  if (typeof item !== 'object' || item === null) return false
  return 'tweetId' in item && 'text' in item
}

function convertSiftlyExportRow(row: SiftlyExportItem): RawTweet {
  const mediaEntities: TwitterMediaEntity[] = (row.mediaItems ?? [])
    .filter((m) => m.url)
    .map((m) => {
      const type = m.type === 'video' ? 'video' : m.type === 'gif' ? 'animated_gif' : 'photo'
      if (type === 'video' || type === 'animated_gif') {
        return { type, media_url_https: m.url, video_info: { variants: [{ content_type: 'video/mp4', bitrate: 0, url: m.url! }] } }
      }
      return { type, media_url_https: m.url }
    })

  return {
    id_str: row.tweetId,
    full_text: row.text,
    created_at: row.tweetCreatedAt,
    user: { screen_name: row.authorHandle || 'unknown', name: row.authorName || 'Unknown' },
    entities: { media: mediaEntities.length > 0 ? mediaEntities : undefined },
    extended_entities: mediaEntities.length > 0 ? { media: mediaEntities } : undefined,
  }
}

// ── X web GraphQL tweet objects (tweet_results.result) ─────────────────────────
// Sent by the bookmarklet as { source, tweets: [...] }. Unlike the flattened
// export rows, these keep the fields that carry a post's complete text.

interface GraphqlUser {
  legacy?: { screen_name?: string; name?: string }
  core?: { screen_name?: string; name?: string }
}

// X Article bodies are Draft.js content. Timelines send only title + preview_text;
// the article/detail page also sends content_state (the full body) and the inline
// images in media_entities.
interface DraftEntity { key?: string | number; value?: { type?: string; data?: { url?: string; caption?: string } } }
interface DraftBlock { type?: string; text?: string; entityRanges?: { key: number; offset: number; length: number }[] }

interface GraphqlArticle {
  title?: string
  preview_text?: string
  content?: string
  content_state?: { blocks?: DraftBlock[]; entityMap?: DraftEntity[] | Record<string, DraftEntity['value']> }
  preview_image?: { url?: string }
  cover_media?: { media_info?: { original_img_url?: string } }
  media_entities?: { media_info?: { original_img_url?: string } }[]
}

/** True when the tweet carries an X Article's full body, not just its preview. */
export function hasArticleBody(tweet: GraphqlTweet): boolean {
  return !!tweet.article?.article_results?.result?.content_state?.blocks?.length
}

/**
 * Plain text of a Draft.js article body: one paragraph per block. Image blocks
 * contribute their caption (the image itself becomes a media item); a link keeps
 * its anchor text and gets the URL appended when the text doesn't already show it.
 */
export function articleBodyText(state: NonNullable<GraphqlArticle['content_state']>): string {
  const raw = state.entityMap ?? []
  const entities = new Map<string, DraftEntity['value']>(
    Array.isArray(raw) ? raw.map((e) => [String(e.key), e.value]) : Object.entries(raw),
  )
  const paragraphs: string[] = []
  for (const block of state.blocks ?? []) {
    const ranges = block.entityRanges ?? []
    if (block.type === 'atomic') {
      const caption = ranges.map((r) => entities.get(String(r.key))?.data?.caption).find(Boolean)
      if (caption) paragraphs.push(caption)
      continue
    }
    let text = block.text ?? ''
    // Insert link URLs from the end so earlier offsets stay valid.
    for (const r of [...ranges].sort((a, b) => b.offset - a.offset)) {
      const e = entities.get(String(r.key))
      const url = e?.type === 'LINK' ? e.data?.url : undefined
      if (url && !text.includes(url)) {
        const end = r.offset + r.length
        text = `${text.slice(0, end)} (${url})${text.slice(end)}`
      }
    }
    if (text.trim()) paragraphs.push(text)
  }
  return paragraphs.join('\n\n')
}

export interface GraphqlTweet {
  __typename?: string
  rest_id?: string
  tweet?: GraphqlTweet
  legacy?: {
    full_text?: string
    created_at?: string
    entities?: TwitterEntities
    extended_entities?: { media?: TwitterMediaEntity[] }
    quoted_status_id_str?: string
  }
  core?: { user_results?: { result?: GraphqlUser } }
  quoted_status_result?: { result?: GraphqlTweet }
  note_tweet?: { note_tweet_results?: { result?: { text?: string } } }
  article?: { article_results?: { result?: GraphqlArticle } }
}

function graphqlFullText(tweet: GraphqlTweet): string {
  // Posts over 280 chars keep only a truncated prefix in legacy.full_text;
  // the complete text lives in note_tweet.
  const note = tweet.note_tweet?.note_tweet_results?.result?.text
  if (note) return note

  const article = tweet.article?.article_results?.result
  if (article) {
    const body = article.content_state?.blocks?.length
      ? articleBodyText(article.content_state)
      : article.content ?? article.preview_text
    const parts = [article.title, body].filter((p): p is string => !!p)
    if (parts.length > 0) return parts.join('\n\n')
  }

  return tweet.legacy?.full_text ?? ''
}

function graphqlMedia(tweet: GraphqlTweet): ParsedMedia[] {
  const media = extractMedia({
    extended_entities: tweet.legacy?.extended_entities,
    entities: tweet.legacy?.entities,
  })
  if (media.length > 0) return media

  // Articles: the cover, then the images inside the body (full body only).
  const article = tweet.article?.article_results?.result
  const cover = article?.cover_media?.media_info?.original_img_url ?? article?.preview_image?.url
  const inline = (article?.media_entities ?? []).map((m) => m.media_info?.original_img_url)
  const urls = [...new Set([cover, ...inline].filter((u): u is string => !!u))]
  return urls.map((url) => ({ type: 'photo' as const, url, thumbnailUrl: url }))
}

export function parseGraphqlTweet(raw: GraphqlTweet): ParsedBookmark | null {
  const tweet = raw.__typename?.startsWith('TweetWithVisibilityResult') && raw.tweet ? raw.tweet : raw
  if (!tweet.rest_id) return null

  // X moved name/screen_name from user_results.result.legacy to .core; read both.
  const user = tweet.core?.user_results?.result
  const createdAt = tweet.legacy?.created_at ? new Date(tweet.legacy.created_at) : null
  // X embeds one level of quoted tweet; its own quote arrives as an id only.
  const quotedResult = tweet.quoted_status_result?.result
  const quoted = quotedResult ? parseGraphqlTweet(quotedResult) : null

  return {
    tweetId: tweet.rest_id,
    text: graphqlFullText(tweet),
    authorHandle: user?.core?.screen_name ?? user?.legacy?.screen_name ?? 'unknown',
    authorName: user?.core?.name ?? user?.legacy?.name ?? 'Unknown',
    tweetCreatedAt: createdAt && !isNaN(createdAt.getTime()) ? createdAt : null,
    hashtags: extractHashtags({ entities: tweet.legacy?.entities }),
    urls: extractUrls({ entities: tweet.legacy?.entities }),
    media: graphqlMedia(tweet),
    rawJson: JSON.stringify(tweet),
    quotedTweetId: tweet.legacy?.quoted_status_id_str ?? quoted?.tweetId ?? null,
    quoted,
  }
}

function isGraphqlExportFormat(obj: unknown): obj is { tweets: GraphqlTweet[] } {
  if (typeof obj !== 'object' || obj === null) return false
  const tweets = (obj as Record<string, unknown>).tweets
  return Array.isArray(tweets) && tweets.length > 0 &&
    typeof tweets[0] === 'object' && tweets[0] !== null && 'rest_id' in tweets[0]
}

function normalizeTweetArray(parsed: unknown): RawTweet[] {
  // Console script export format: { exportDate, totalBookmarks, bookmarks: [...] }
  if (isConsoleExportFormat(parsed)) {
    return parsed.bookmarks.map(convertConsoleExportRow)
  }

  if (Array.isArray(parsed)) {
    if (parsed.length > 0 && isFlatExportFormat(parsed[0])) {
      return parsed.map((row) => convertFlatExportRow(row as FlatExportRow))
    }
    // Siftly re-export format: [{ tweetId, text, authorHandle, ... }]
    if (parsed.length > 0 && isSiftlyExportFormat(parsed[0])) {
      return parsed.map((row) => convertSiftlyExportRow(row as SiftlyExportItem))
    }
    return parsed as RawTweet[]
  }

  if (typeof parsed === 'object' && parsed !== null) {
    const obj = parsed as Record<string, unknown>

    // twitter-web-exporter wraps in a top-level key
    for (const key of Object.keys(obj)) {
      const val = obj[key]
      if (Array.isArray(val)) {
        return val as RawTweet[]
      }
    }
  }

  return []
}

export function parseBookmarksJson(jsonString: string): ParsedBookmark[] {
  if (!jsonString || jsonString.trim() === '') {
    throw new Error('Empty JSON string provided')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(jsonString)
  } catch (err) {
    throw new Error(`Invalid JSON: ${err instanceof Error ? err.message : String(err)}`)
  }

  if (isGraphqlExportFormat(parsed)) {
    return parsed.tweets
      .map(parseGraphqlTweet)
      .filter((b): b is ParsedBookmark => b !== null)
  }

  const tweets = normalizeTweetArray(parsed)

  const results: ParsedBookmark[] = []
  for (const tweet of tweets) {
    const bookmark = parseSingleTweet(tweet)
    if (bookmark !== null) {
      results.push(bookmark)
    }
  }

  return results
}
