/**
 * Weibo posts. A Weibo row's rawJson is the post as Weibo's API returns it (the
 * fields Siftly reads are typed below). Rows migrated from weibo_backup carry
 * the same shape rebuilt from its tables, marked `_from: "weibo_backup"`; that
 * project kept parsed fields only, not the API JSON.
 */
import type { ParsedBookmark, ParsedMedia } from '@/lib/parser'
import { ENTITIES_VERSION, type ExtractedEntities, type QuotedTweet, type TweetLink } from '@/lib/rawjson-extractor'

export interface WeiboUser {
  id: number | string
  screen_name?: string
  location?: string
  description?: string
  url?: string
  created_at?: string
  avatar_hd?: string
}

interface WeiboPicInfo {
  largest?: { url?: string }
  original?: { url?: string }
}

export interface WeiboStatus {
  id: number | string
  idstr?: string
  mblogid?: string
  created_at?: string
  /** Plain text (the web API's `text` is HTML, its plain text is `text_raw`). */
  text_raw?: string
  text?: string
  isLongText?: boolean
  longText?: { content?: string }
  /** HTML link naming the client, e.g. <a …>iPhone客户端</a>. */
  source?: string
  region_name?: string
  deleted?: boolean | number | string
  user?: WeiboUser | null
  pic_ids?: string[]
  pic_infos?: Record<string, WeiboPicInfo>
  page_info?: {
    object_type?: string
    media_info?: Record<string, unknown>
    page_pic?: { url?: string } | string
  }
  url_struct?: { short_url?: string; long_url?: string; url_title?: string }[]
  retweeted_status?: WeiboStatus | null
  _from?: string
}

/** What the card shows in place of X's @handle line. */
export interface WeiboMeta {
  mblogid: string | null
  /** Client name without its HTML, e.g. "iPhone客户端". */
  source: string | null
  region: string | null
}

/** Best quality first, the order weibo_backup used. Live streams (m3u8) are skipped. */
const VIDEO_SPECS = ['hevc_mp4_720p', 'mp4_720p_mp4', 'h265_mp4_hd', 'mp4_hd_url', 'mp4_sd_url', 'stream_url']

const TOPIC_REGEX = /#([^#\n]{1,64})#/g
const MENTION_REGEX = /@([\u4e00-\u9fa5A-Za-z0-9_-]{1,30})/g
const URL_REGEX = /https?:\/\/[A-Za-z0-9./?=&%_~:#+-]+/g

export function weiboId(s: WeiboStatus): string {
  return String(s.idstr ?? s.id)
}

export function weiboText(s: WeiboStatus): string {
  return s.longText?.content ?? s.text_raw ?? s.text ?? ''
}

function stripTags(html: string | undefined): string | null {
  const text = html?.replace(/<[^>]*>/g, '').trim()
  return text || null
}

export function weiboMeta(s: WeiboStatus): WeiboMeta {
  return {
    mblogid: s.mblogid || null,
    source: stripTags(s.source),
    region: s.region_name?.replace(/^发布于\s*/, '').trim() || null,
  }
}

function parseDate(value: string | undefined): Date | null {
  if (!value) return null
  const d = new Date(value) // "Tue May 31 17:46:55 +0800 2022", like X's created_at
  return isNaN(d.getTime()) ? null : d
}

export function weiboMedia(s: WeiboStatus): ParsedMedia[] {
  const media: ParsedMedia[] = []
  for (const pid of s.pic_ids ?? []) {
    const info = s.pic_infos?.[pid]
    const url = info?.largest?.url ?? info?.original?.url
    if (url) media.push({ type: 'photo', url })
  }
  const mediaInfo = s.page_info?.media_info
  if (mediaInfo) {
    const url = VIDEO_SPECS.map((k) => mediaInfo[k]).find((v): v is string => typeof v === 'string' && v.length > 0)
    if (url && !url.includes('.m3u8')) {
      const pic = s.page_info?.page_pic
      const poster = typeof pic === 'string' ? pic : pic?.url
      media.push({ type: 'video', url, thumbnailUrl: poster || undefined })
    }
  }
  return media
}

/** URLs in the text; Weibo's url_struct (when present) says where a t.cn link goes. */
export function weiboLinks(s: WeiboStatus): TweetLink[] {
  const longUrl = new Map((s.url_struct ?? []).filter((u) => u.short_url && u.long_url).map((u) => [u.short_url!, u.long_url!]))
  const seen = new Set<string>()
  const links: TweetLink[] = []
  for (const [url] of weiboText(s).matchAll(URL_REGEX)) {
    if (seen.has(url)) continue
    seen.add(url)
    links.push({ url, expandedUrl: longUrl.get(url) ?? url, displayUrl: url.replace(/^https?:\/\//, '') })
  }
  return links
}

function quotedSnapshot(r: WeiboStatus): QuotedTweet {
  return {
    tweetId: weiboId(r),
    authorName: r.user?.screen_name ?? '',
    authorHandle: r.user ? String(r.user.id) : 'unknown',
    text: weiboText(r),
    links: weiboLinks(r),
  }
}

export function weiboEntities(s: WeiboStatus): ExtractedEntities {
  const text = weiboText(s)
  const media = weiboMedia(s)
  const links = weiboLinks(s)
  const retweet = s.retweeted_status
  return {
    v: ENTITIES_VERSION,
    hashtags: [...new Set([...text.matchAll(TOPIC_REGEX)].map((m) => m[1].trim()))],
    urls: links.map((l) => l.expandedUrl),
    mentions: [...new Set([...text.matchAll(MENTION_REGEX)].map((m) => m[1]))],
    tools: [],
    tweetType: retweet ? 'quote' : 'original',
    hasMedia: media.length > 0,
    mediaTypes: [...new Set(media.map((m) => m.type))],
    links,
    quoted: retweet ? quotedSnapshot(retweet) : null,
    articlePreview: false,
    weibo: weiboMeta(s),
  }
}

/** A Weibo post as Siftly saves it; a repost's original comes along as `quoted`. */
export function parseWeiboStatus(s: WeiboStatus): ParsedBookmark {
  const retweet = s.retweeted_status
  const entities = weiboEntities(s)
  return {
    platform: 'weibo',
    tweetId: weiboId(s),
    text: weiboText(s),
    authorHandle: s.user ? String(s.user.id) : 'unknown',
    authorName: s.user?.screen_name ?? '',
    tweetCreatedAt: parseDate(s.created_at),
    hashtags: entities.hashtags,
    urls: entities.urls,
    media: weiboMedia(s),
    rawJson: JSON.stringify(s),
    entities: JSON.stringify(entities),
    quotedTweetId: retweet ? weiboId(retweet) : null,
    quoted: retweet ? parseWeiboStatus(retweet) : null,
  }
}

/** The avatar URL a Weibo post's JSON names. */
export function weiboAvatarUrl(raw: unknown): string | null {
  const url = (raw as WeiboStatus | null)?.user?.avatar_hd
  return typeof url === 'string' && url ? url : null
}
