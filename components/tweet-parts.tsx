'use client'

// Pieces shared by <BookmarkCard> and <TweetReader>.

import React, { useState } from 'react'
import type { QuotedTweet } from '@/lib/types'
import { TweetText, tweetSegments } from '@/components/tweet-text'

const COLOR_PALETTE = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f59e0b',
  '#10b981', '#3b82f6', '#ef4444', '#14b8a6',
]

function stringToColor(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash)
  }
  return COLOR_PALETTE[Math.abs(hash) % COLOR_PALETTE.length]
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export function formatDate(dateStr: string | null): string {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

// ── Author Avatar ──────────────────────────────────────────────────────────────

export function AuthorAvatar({ name, handle, tweetId, size = 8 }: { name: string; handle: string; tweetId: string; size?: 8 | 10 }) {
  const [failures, setFailures] = useState(0)
  const bg = stringToColor(handle)
  const initials = getInitials(name)

  // The avatar from the tweet JSON (local copy when saved), then unavatar.io for
  // older imports that lack it, then initials.
  const cleanHandle = handle.replace(/^@/, '')
  const sources = [
    `/api/media?tweetId=${tweetId}&kind=avatar`,
    ...(cleanHandle && cleanHandle !== 'unknown' ? [`https://unavatar.io/twitter/${cleanHandle}`] : []),
  ]
  const src = sources[failures]

  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={name}
        className={`flex-shrink-0 ${size === 10 ? 'w-10 h-10' : 'w-8 h-8'} rounded-full object-cover select-none`}
        loading="lazy"
        onError={() => setFailures((n) => n + 1)}
      />
    )
  }

  return (
    <div
      className={`flex-shrink-0 ${size === 10 ? 'w-10 h-10' : 'w-8 h-8'} rounded-full flex items-center justify-center text-white text-xs font-bold select-none`}
      style={{ backgroundColor: bg }}
      aria-hidden="true"
    >
      {initials}
    </div>
  )
}

/** With tweetId, /api/media serves the pipeline's local copy when it exists. */
export function proxyUrl(url: string, tweetId?: string): string {
  return `/api/media?url=${encodeURIComponent(url)}${tweetId ? `&tweetId=${tweetId}` : ''}`
}

/** X card images may have a local copy; other sites' og:image load as before. */
export function previewImageSrc(image: string, tweetId?: string): string {
  return tweetId && image.startsWith('https://pbs.twimg.com/') ? proxyUrl(image, tweetId) : image
}

/** Returns true if the URL points to an actual video file (not a thumbnail JPEG) */
export function isVideoUrl(url: string): boolean {
  return url.includes('video.twimg.com') || url.includes('.mp4')
}

// ── Quoted tweet ───────────────────────────────────────────────────────────────
// Text only for now: the quoted tweet's media is not downloaded or shown.
// `full` (the reader) shows every line; cards clamp to four.

export function QuotedTweetBlock({ quoted, full = false }: { quoted: QuotedTweet; full?: boolean }) {
  const url = quoted.authorHandle !== 'unknown'
    ? `https://x.com/${quoted.authorHandle}/status/${quoted.tweetId}`
    : `https://x.com/i/web/status/${quoted.tweetId}`
  const segments = tweetSegments(quoted.text, quoted.links)
  return (
    <div className="mt-2 rounded-xl border border-zinc-800 bg-zinc-800/30 px-3 py-2">
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="flex items-baseline gap-1.5 text-xs hover:underline"
      >
        <span className="font-semibold text-zinc-300 truncate">{quoted.authorName}</span>
        <span className="text-zinc-500 truncate">@{quoted.authorHandle}</span>
      </a>
      {segments.length > 0 && (
        <p className={full ? 'mt-1 text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap' : 'mt-1 text-xs text-zinc-400 leading-relaxed line-clamp-4'}>
          <TweetText segments={segments} />
        </p>
      )}
    </div>
  )
}
