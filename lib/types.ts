export interface MediaItem {
  id: string
  type: string
  url: string
  thumbnailUrl: string | null
  imageTags?: string | null
}

export interface BookmarkCategory {
  id: string
  name: string
  slug: string
  color: string
  confidence: number | null
}

import type { QuotedTweet, TweetLink } from '@/lib/rawjson-extractor'
export type { QuotedTweet, TweetLink }

export interface BookmarkWithMedia {
  id: string
  tweetId: string
  text: string
  authorHandle: string
  authorName: string
  tweetCreatedAt: string | null
  importedAt?: string
  source?: string
  /** 'x' | 'weibo' (lib/platform.ts); absent means X. */
  platform?: string
  mediaItems: MediaItem[]
  categories: BookmarkCategory[]
  links?: TweetLink[]
  /** X Article with only its preview saved; open it on X (panel on) to fill in the body. */
  articlePreview?: boolean
  /** Tweet this one quotes; set even when its content is unknown (link to X then). */
  quotedTweetId?: string | null
  quoted?: QuotedTweetView | null
  /** The user's own note on this bookmark. */
  note?: string | null
}

/** A quoted tweet as shown inside another card: its own row when saved, else a snapshot. */
export interface QuotedTweetView extends QuotedTweet {
  media?: MediaItem[]
  /** The tweet the quoted tweet itself quotes (X sends only its id). */
  quotedTweetId?: string | null
}

export interface Category {
  id: string
  name: string
  slug: string
  color: string
  description: string | null
  isAiGenerated: boolean
  createdAt: string
  bookmarkCount: number
}

export interface StatsResponse {
  totalBookmarks: number
  totalCategories: number
  totalMedia: number
  recentBookmarks: BookmarkWithMedia[]
  topCategories: { name: string; slug: string; color: string; count: number }[]
}

export interface BookmarksResponse {
  bookmarks: BookmarkWithMedia[]
  total: number
  page: number
  limit: number
}
