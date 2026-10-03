'use client'

// Pieces shared by <BookmarkCard> and <TweetReader>.

import React, { useState } from 'react'
import { Play } from 'lucide-react'
import type { MediaItem, QuotedTweetView } from '@/lib/types'
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

// ── Author profile link ───────────────────────────────────────────────────────

/** Name / @handle linking to the author's X profile, like on X. */
export function ProfileLink({ handle, className, children }: { handle: string; className?: string; children: React.ReactNode }) {
  return (
    <a
      href={`https://x.com/${handle}`}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className={`hover:underline ${className ?? ''}`}
      title={`@${handle} on X`}
    >
      {children}
    </a>
  )
}

// ── X Article preview ─────────────────────────────────────────────────────────

/** X sends only an article's preview in timelines; opening it on X with the Siftly panel on saves the rest. */
export function ArticlePreviewNote({ tweetUrl }: { tweetUrl: string }) {
  return (
    <a
      href={tweetUrl}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="mt-1.5 inline-block text-xs text-indigo-400 hover:text-indigo-300 hover:underline"
      title="Siftly has only the preview. Open it on X with the Siftly panel running to save the full article."
    >
      X 文章预览 · 在 X 上阅读全文 ↗
    </a>
  )
}

// ── Quoted tweet ───────────────────────────────────────────────────────────────
// Kept visually below the main tweet: cards show one small thumbnail, the
// reader a compact grid. `full` (the reader) also shows every line of text.

function tweetUrlFor(handle: string, tweetId: string): string {
  return handle !== 'unknown' ? `https://x.com/${handle}/status/${tweetId}` : `https://x.com/i/web/status/${tweetId}`
}

/** X sends only one level of quoted tweet; deeper quotes are a link out. */
export function QuotesAnotherLink({ tweetId }: { tweetId: string }) {
  return (
    <a
      href={`https://x.com/i/web/status/${tweetId}`}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="mt-1.5 inline-block text-xs text-zinc-500 hover:text-zinc-300 hover:underline"
    >
      引用了另一条推文 ↗
    </a>
  )
}

function QuotedMediaThumb({ item, tweetId, extra }: { item: MediaItem; tweetId: string; extra: number }) {
  const poster = item.thumbnailUrl && !isVideoUrl(item.thumbnailUrl) ? item.thumbnailUrl : null
  return (
    <div className="relative shrink-0 w-14 h-14 rounded-lg overflow-hidden bg-black">
      {item.type === 'photo' || poster ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={proxyUrl(poster ?? item.url, tweetId)} alt="" className="w-full h-full object-cover" loading="lazy" />
      ) : (
        <video src={`${proxyUrl(item.url, tweetId)}#t=0.1`} className="w-full h-full object-cover" preload="metadata" muted playsInline />
      )}
      {item.type !== 'photo' && (
        <span className="absolute inset-0 flex items-center justify-center">
          <Play size={14} className="text-white fill-white drop-shadow" />
        </span>
      )}
      {extra > 0 && (
        <span className="absolute bottom-0.5 right-0.5 px-1 rounded bg-black/70 text-[10px] text-white">+{extra}</span>
      )}
    </div>
  )
}

type OpenPhotos = (srcs: string[], index: number) => void

function QuotedMediaGrid({ media, tweetId, onOpenPhotos }: { media: MediaItem[]; tweetId: string; onOpenPhotos?: OpenPhotos }) {
  const photoSrcs = media.filter((m) => m.type === 'photo').map((m) => proxyUrl(m.url, tweetId))
  return (
    <div className={`mt-2 grid gap-1.5 ${media.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
      {media.map((m) => m.type === 'photo' ? (
        <button
          key={m.id}
          type="button"
          onClick={() => onOpenPhotos?.(photoSrcs, photoSrcs.indexOf(proxyUrl(m.url, tweetId)))}
          className="block cursor-zoom-in"
          title="View full size"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={proxyUrl(m.url, tweetId)} alt="" className="w-full max-h-60 object-contain rounded-lg bg-black" loading="lazy" />
        </button>
      ) : (
        <video
          key={m.id}
          src={proxyUrl(m.url, tweetId)}
          poster={m.thumbnailUrl && !isVideoUrl(m.thumbnailUrl) ? proxyUrl(m.thumbnailUrl, tweetId) : undefined}
          className="w-full max-h-60 object-contain rounded-lg bg-black"
          preload="metadata"
          controls={m.type !== 'gif'}
          autoPlay={m.type === 'gif'}
          loop={m.type === 'gif'}
          muted={m.type === 'gif'}
          playsInline
        />
      ))}
    </div>
  )
}

export function QuotedTweetBlock({ quoted, full = false, onOpenPhotos }: { quoted: QuotedTweetView; full?: boolean; onOpenPhotos?: OpenPhotos }) {
  const segments = tweetSegments(quoted.text, quoted.links)
  const media = quoted.media ?? []
  const header = (
    <a
      href={tweetUrlFor(quoted.authorHandle, quoted.tweetId)}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="flex items-baseline gap-1.5 text-xs hover:underline min-w-0"
    >
      <span className="font-semibold text-zinc-300 truncate">{quoted.authorName}</span>
      <span className="text-zinc-500 truncate">@{quoted.authorHandle}</span>
    </a>
  )
  const text = segments.length > 0 && (
    <p className={full ? 'mt-1 text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap break-words' : 'mt-1 text-xs text-zinc-400 leading-relaxed line-clamp-4'}>
      <TweetText segments={segments} />
    </p>
  )
  return (
    <div className="mt-2 rounded-xl border border-zinc-800 bg-zinc-800/30 px-3 py-2">
      {full ? (
        <>
          {header}
          {text}
          {media.length > 0 && <QuotedMediaGrid media={media} tweetId={quoted.tweetId} onOpenPhotos={onOpenPhotos} />}
        </>
      ) : (
        <div className="flex gap-2.5">
          {media.length > 0 && <QuotedMediaThumb item={media[0]} tweetId={quoted.tweetId} extra={media.length - 1} />}
          <div className="min-w-0 flex-1">
            {header}
            {text}
          </div>
        </div>
      )}
      {quoted.quotedTweetId && <QuotesAnotherLink tweetId={quoted.quotedTweetId} />}
    </div>
  )
}
