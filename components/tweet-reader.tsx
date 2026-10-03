'use client'

import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { ExternalLink, X } from 'lucide-react'
import type { BookmarkCategory, BookmarkWithMedia } from '@/lib/types'
import { TweetText, tweetSegments } from '@/components/tweet-text'
import { AuthorAvatar, QuotedTweetBlock, formatDate, isVideoUrl, proxyUrl } from '@/components/tweet-parts'

/**
 * Full view of one tweet: complete text with its line breaks, every photo and
 * video (local copies), and the full quoted tweet. Cards truncate; this doesn't.
 * Rendered into document.body so card hover/overflow styles can't clip it.
 */
export default function TweetReader({
  bookmark,
  categories = bookmark.categories,
  onClose,
}: {
  bookmark: BookmarkWithMedia
  categories?: BookmarkCategory[]
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [onClose])

  const isKnownAuthor = bookmark.authorHandle !== 'unknown'
  const tweetUrl = isKnownAuthor
    ? `https://x.com/${bookmark.authorHandle}/status/${bookmark.tweetId}`
    : `https://x.com/i/web/status/${bookmark.tweetId}`
  const segments = tweetSegments(bookmark.text, bookmark.links)
  const media = bookmark.mediaItems

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="relative flex flex-col w-full max-w-2xl max-h-[85vh] rounded-2xl border border-zinc-800 bg-zinc-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-zinc-800">
          <AuthorAvatar name={bookmark.authorName} handle={bookmark.authorHandle} tweetId={bookmark.tweetId} size={10} />
          <div className="min-w-0 flex-1">
            {isKnownAuthor && <p className="text-sm font-semibold text-zinc-100 truncate">{bookmark.authorName}</p>}
            <p className="text-xs text-zinc-500 truncate">
              {isKnownAuthor && `@${bookmark.authorHandle} · `}
              {formatDate(bookmark.tweetCreatedAt ?? bookmark.importedAt ?? null)}
            </p>
          </div>
          <a
            href={tweetUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="p-2 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
            title="Open on X"
          >
            <ExternalLink size={16} />
          </a>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body — scrolls inside the dialog */}
        <div className="overflow-y-auto px-5 py-4 space-y-4">
          {segments.length > 0 && (
            <p className="text-[15px] text-zinc-100 leading-relaxed whitespace-pre-wrap break-words">
              <TweetText segments={segments} />
            </p>
          )}

          {media.length > 0 && (
            <div className={`grid gap-2 ${media.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
              {media.map((m) => m.type === 'photo' ? (
                <a
                  key={m.id}
                  href={proxyUrl(m.url, bookmark.tweetId)}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Open full size"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={proxyUrl(m.url, bookmark.tweetId)}
                    alt=""
                    className="w-full max-h-[70vh] object-contain rounded-xl bg-black"
                    loading="lazy"
                  />
                </a>
              ) : (
                <video
                  key={m.id}
                  src={proxyUrl(m.url, bookmark.tweetId)}
                  poster={m.thumbnailUrl && !isVideoUrl(m.thumbnailUrl) ? proxyUrl(m.thumbnailUrl, bookmark.tweetId) : undefined}
                  className="w-full max-h-[70vh] object-contain rounded-xl bg-black"
                  preload="metadata"
                  controls={m.type !== 'gif'}
                  autoPlay={m.type === 'gif'}
                  loop={m.type === 'gif'}
                  muted={m.type === 'gif'}
                  playsInline
                />
              ))}
            </div>
          )}

          {bookmark.quoted && <QuotedTweetBlock quoted={bookmark.quoted} full />}

          {categories.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {categories.map((c) => (
                <span
                  key={c.id}
                  className="px-2 py-0.5 rounded-full text-xs font-medium"
                  style={{ backgroundColor: `${c.color}18`, color: c.color, border: `1px solid ${c.color}30` }}
                >
                  {c.name}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
