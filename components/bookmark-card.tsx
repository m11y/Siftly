'use client'

import React, { useRef, useEffect, useState } from 'react'
import { BookOpen, ExternalLink, Download, FileText, Play, Pencil, X, Check, ImageOff, Bookmark, Globe } from 'lucide-react'
import type { BookmarkWithMedia, Category } from '@/lib/types'
import { TweetText, postSegments, tweetTextLength } from '@/components/tweet-text'
import TweetReader from '@/components/tweet-reader'
import { postUrl } from '@/lib/platform'
import { ArticlePreviewNote, AuthorAvatar, DeleteButton, WeiboSubline, ProfileLink, QuotedTweetBlock, QuotesAnotherLink, formatDate, isVideoUrl, previewImageSrc, proxyUrl } from '@/components/tweet-parts'

// ── URL helpers ────────────────────────────────────────────────────────────────

const URL_REGEX = /https?:\/\/[^\s]+/g
// Twitter always shortens links to t.co
const TCO_REGEX = /https?:\/\/t\.co\/[^\s]+/g

function extractUrls(text: string): string[] {
  return text.match(URL_REGEX) ?? []
}

// ── Link preview ───────────────────────────────────────────────────────────────

interface LinkPreviewData {
  title: string
  description: string
  image: string
  siteName: string
  domain: string
  url: string
}

// Module-level cache: url → preview data (or null on error)
const previewCache = new Map<string, LinkPreviewData | null>()

function LinkPreview({ url, tweetUrl, tweetId, prominent = false }: { url: string; tweetUrl: string; tweetId?: string; prominent?: boolean }) {
  const [data, setData] = useState<LinkPreviewData | null | 'loading'>('loading')

  useEffect(() => {
    const cacheKey = tweetId ? `${url}:${tweetId}` : url
    if (previewCache.has(cacheKey)) {
      setData(previewCache.get(cacheKey) ?? null)
      return
    }
    let cancelled = false
    fetch(`/api/link-preview?url=${encodeURIComponent(url)}${tweetId ? `&tweetId=${tweetId}` : ''}`)
      .then((r) => r.json())
      .then((d: LinkPreviewData & { error?: string }) => {
        if (cancelled) return
        const result = d.error || !d.title ? null : d
        previewCache.set(cacheKey, result)
        setData(result)
      })
      .catch(() => {
        if (!cancelled) { previewCache.set(cacheKey, null); setData(null) }
      })
    return () => { cancelled = true }
  }, [url, tweetId])

  if (data === 'loading') {
    return (
      <div className="mt-2 rounded-xl border border-zinc-800 bg-zinc-800/40 h-16 animate-pulse" />
    )
  }

  // Fallback: OG fetch failed or returned no title — show a minimal link chip
  if (!data) {
    return (
      <a
        href={tweetUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className={`${prominent ? 'mt-1' : 'mt-2'} inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-zinc-800 bg-zinc-800/40 hover:border-zinc-700 hover:bg-zinc-800/70 transition-all text-xs text-zinc-400 hover:text-zinc-200 max-w-full overflow-hidden`}
      >
        <Globe size={11} className="shrink-0 text-zinc-600" />
        <span className="truncate">{url.replace(/^https?:\/\//, '')}</span>
        <ExternalLink size={10} className="shrink-0 text-zinc-600 ml-auto" />
      </a>
    )
  }

  // X article pages return useless OG data — show a styled "View article" card instead
  const isGenericXArticle = (data.domain === 'x.com' || data.domain === 'twitter.com') && !data.image && !data.description

  const href = data.url || url

  // X article / generic X link with no useful OG data — show a clean "View on X" card
  if (isGenericXArticle) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className={`${prominent ? 'mt-1' : 'mt-2'} flex items-center gap-3 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-800/40 hover:border-zinc-700 hover:bg-zinc-800/70 transition-all group/link px-4 py-3`}
      >
        <div className="w-10 h-10 rounded-lg bg-zinc-700/60 flex items-center justify-center shrink-0">
          <svg viewBox="0 0 24 24" className="w-5 h-5 text-zinc-400" fill="currentColor">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-zinc-200 group-hover/link:text-white transition-colors">
            {data.title?.includes('Article') ? 'View Article on X' : data.title || 'View on X'}
          </p>
          <p className="text-xs text-zinc-500 truncate">{data.domain}{data.url ? new URL(data.url).pathname : ''}</p>
        </div>
        <ExternalLink size={14} className="text-zinc-600 group-hover/link:text-zinc-400 transition-colors shrink-0" />
      </a>
    )
  }

  // Prominent mode: vertical layout with large image — used for link-only bookmarks
  if (prominent) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="mt-1 flex flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-800/40 hover:border-zinc-700 hover:bg-zinc-800/70 transition-all group/link"
      >
        {data.image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={previewImageSrc(data.image, tweetId)}
            alt=""
            className="w-full h-40 object-cover border-b border-zinc-800"
            loading="lazy"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
          />
        )}
        <div className="flex flex-col px-3 py-2.5 min-w-0 gap-1">
          <p className="text-sm font-semibold text-zinc-200 line-clamp-2 group-hover/link:text-white transition-colors leading-snug">
            {data.title}
          </p>
          {data.description && (
            <p className="text-xs text-zinc-400 line-clamp-3 leading-relaxed">
              {data.description}
            </p>
          )}
          <div className="flex items-center gap-1 mt-0.5">
            <Globe size={10} className="text-zinc-600 shrink-0" />
            <span className="text-[10px] text-zinc-600 truncate">
              {data.siteName || data.domain}
            </span>
          </div>
        </div>
      </a>
    )
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="mt-2 flex overflow-hidden rounded-xl border border-zinc-800 bg-zinc-800/40 hover:border-zinc-700 hover:bg-zinc-800/70 transition-all group/link"
    >
      {data.image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={previewImageSrc(data.image, tweetId)}
          alt=""
          className="w-24 h-full object-cover shrink-0 border-r border-zinc-800"
          loading="lazy"
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
        />
      )}
      <div className="flex flex-col justify-center px-3 py-2.5 min-w-0 gap-0.5">
        <p className="text-xs font-semibold text-zinc-200 line-clamp-1 group-hover/link:text-white transition-colors">
          {data.title}
        </p>
        {data.description && (
          <p className="text-xs text-zinc-500 line-clamp-2 leading-snug">
            {data.description}
          </p>
        )}
        <div className="flex items-center gap-1 mt-1">
          <Globe size={10} className="text-zinc-600 shrink-0" />
          <span className="text-[10px] text-zinc-600 truncate">
            {data.siteName || data.domain}
          </span>
        </div>
      </div>
    </a>
  )
}

// Module-level cache so all cards share the same fetched list
let cachedCategories: Category[] | null = null
let cacheFetchPromise: Promise<Category[]> | null = null

async function fetchAllCategories(): Promise<Category[]> {
  if (cachedCategories !== null) return cachedCategories
  if (cacheFetchPromise !== null) return cacheFetchPromise

  cacheFetchPromise = fetch('/api/categories')
    .then((res) => {
      if (!res.ok) throw new Error(`Failed to fetch categories: ${res.status}`)
      return res.json()
    })
    .then((data: { categories: Category[] }) => {
      cachedCategories = data.categories
      cacheFetchPromise = null
      return data.categories
    })
    .catch((err) => {
      cacheFetchPromise = null
      throw err
    })

  return cacheFetchPromise
}

// ── Top media slot (no margins — rendered full-bleed at top of card) ────────

interface TopMediaSlotProps {
  item: BookmarkWithMedia['mediaItems'][number]
  tweetUrl: string
  tweetId: string
}

/** Placeholder shown when no thumbnail is available — styled as a proper video preview */
function MediaPlaceholder({ onClick, label, isVideo }: { onClick?: (e: React.MouseEvent) => void; label: string; isVideo?: boolean }) {
  if (isVideo) {
    return (
      <div
        className="h-48 flex flex-col items-center justify-center gap-3 bg-gradient-to-br from-zinc-800 to-zinc-900 hover:from-zinc-750 hover:to-zinc-850 transition-colors cursor-pointer select-none"
        onClick={onClick}
      >
        <div className="w-14 h-14 rounded-full bg-white/10 hover:bg-white/20 transition-colors flex items-center justify-center border border-white/10">
          <Play size={22} className="text-white fill-white ml-1" />
        </div>
        <span className="text-xs text-zinc-400 font-medium">{label}</span>
      </div>
    )
  }
  return (
    <div
      className="h-48 flex items-center justify-center bg-zinc-800/70 hover:bg-zinc-800 transition-colors cursor-pointer"
      onClick={onClick}
    >
      <span className="px-3 py-1.5 rounded-full bg-zinc-700 text-zinc-300 text-xs font-semibold">
        {label}
      </span>
    </div>
  )
}

function TopMediaSlot({ item, tweetUrl, tweetId }: TopMediaSlotProps) {
  const [imgError, setImgError] = useState(false)
  const [videoError, setVideoError] = useState(false)

  // ── Photo: show inline ─────────────────────────────────────────────────────
  if (item.type === 'photo') {
    if (imgError) {
      return (
        <a href={tweetUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
          <div className="h-48 flex flex-col items-center justify-center gap-2 bg-zinc-800/50 hover:bg-zinc-800/70 transition-colors">
            <ImageOff size={18} className="text-zinc-600" />
            <span className="px-3 py-1.5 rounded-full bg-zinc-700 text-zinc-400 text-xs font-semibold">
              View on X ↗
            </span>
          </div>
        </a>
      )
    }
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={proxyUrl(item.url, tweetId)}
        alt="Bookmark media"
        className="w-full h-48 object-cover"
        loading="lazy"
        onError={() => setImgError(true)}
      />
    )
  }

  // ── Video/GIF: play the local copy inline (saved by the pipeline's media stage) ──
  // Posters exist only for imports that carried one; otherwise `#t=0.1` makes the
  // browser render an early frame as the preview, with no extra file to keep.
  const poster = item.thumbnailUrl && !isVideoUrl(item.thumbnailUrl) ? proxyUrl(item.thumbnailUrl, tweetId) : undefined
  const isGif = item.type === 'gif'

  if (videoError) {
    return (
      <a href={tweetUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
        <MediaPlaceholder label="Watch on X ↗" isVideo={!isGif} />
      </a>
    )
  }
  return (
    <video
      src={`${proxyUrl(item.url, tweetId)}${poster ? '' : '#t=0.1'}`}
      poster={poster}
      className="w-full h-48 object-contain bg-black"
      preload={isGif ? 'auto' : 'metadata'}
      controls={!isGif}
      autoPlay={isGif}
      loop={isGif}
      muted={isGif}
      playsInline
      onClick={(e) => e.stopPropagation()}
      onError={() => setVideoError(true)}
    />
  )
}

// ── Category chip ──────────────────────────────────────────────────────────────

function CategoryChip({
  category,
  onRemove,
}: {
  category: BookmarkWithMedia['categories'][number]
  onRemove?: (id: string) => void
}) {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
      style={{
        backgroundColor: `${category.color}18`,
        color: category.color,
        border: `1px solid ${category.color}30`,
      }}
    >
      <Bookmark
        size={9}
        className="flex-shrink-0"
        style={{ color: category.color, fill: category.color }}
      />
      {category.name}
      {onRemove && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onRemove(category.id)
          }}
          className="ml-0.5 opacity-50 hover:opacity-100 transition-opacity"
          aria-label={`Remove ${category.name}`}
        >
          <X size={10} />
        </button>
      )}
    </span>
  )
}

// ── Inline category editor ─────────────────────────────────────────────────────

interface CategoryEditorProps {
  bookmarkId: string
  currentCategoryIds: Set<string>
  onSave: (newIds: string[]) => void
  onClose: () => void
}

function CategoryEditor({ bookmarkId, currentCategoryIds, onSave, onClose }: CategoryEditorProps) {
  const [allCategories, setAllCategories] = useState<Category[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set(currentCategoryIds))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const editorRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    fetchAllCategories()
      .then((cats) => {
        if (!cancelled) { setAllCategories(cats); setLoading(false) }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load categories')
          setLoading(false)
        }
      })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (editorRef.current && !editorRef.current.contains(event.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [onClose])

  function toggleCategory(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    const ids = Array.from(selected)
    try {
      const res = await fetch(`/api/bookmarks/${bookmarkId}/categories`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categoryIds: ids }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`)
      }
      onSave(ids)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      ref={editorRef}
      className="absolute left-0 right-0 bottom-full mb-2 z-50 bg-zinc-900 border border-zinc-700 rounded-xl p-3 shadow-2xl shadow-black/50"
      onClick={(e) => e.stopPropagation()}
    >
      <p className="text-xs font-semibold text-zinc-500 mb-2 uppercase tracking-wide">Edit categories</p>

      {loading && <p className="text-xs text-zinc-600 py-2">Loading…</p>}

      {!loading && allCategories.length === 0 && (
        <p className="text-xs text-zinc-600 py-2">No categories found.</p>
      )}

      {!loading && allCategories.length > 0 && (
        <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
          {allCategories.map((cat) => {
            const isSelected = selected.has(cat.id)
            return (
              <button
                key={cat.id}
                onClick={() => toggleCategory(cat.id)}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium transition-all"
                style={
                  isSelected
                    ? { backgroundColor: `${cat.color}33`, color: cat.color, border: `1px solid ${cat.color}88` }
                    : { backgroundColor: 'transparent', color: '#71717a', border: '1px solid #3f3f46' }
                }
              >
                {isSelected
                  ? <Check size={10} className="flex-shrink-0" />
                  : <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 opacity-40" style={{ backgroundColor: cat.color }} />
                }
                {cat.name}
              </button>
            )
          })}
        </div>
      )}

      {error && <p className="text-xs text-red-400 mt-2">{error}</p>}

      <div className="flex items-center justify-end gap-2 mt-3 pt-2 border-t border-zinc-800">
        <button onClick={onClose} className="px-2.5 py-1 text-xs rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors">
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-3 py-1 text-xs rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium transition-colors"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}

// ── Main card ──────────────────────────────────────────────────────────────────

interface BookmarkCardProps {
  bookmark: BookmarkWithMedia
}

export default function BookmarkCard({ bookmark }: BookmarkCardProps) {
  const [categories, setCategories] = useState(bookmark.categories)
  const [expanded, setExpanded] = useState(false)
  const [editingCategories, setEditingCategories] = useState(false)
  const [readerOpen, setReaderOpen] = useState(false)
  const [deleted, setDeleted] = useState(false)
  const [note, setNote] = useState(bookmark.note ?? null)

  // Like X: a click anywhere on the card opens the full tweet, except on
  // controls that do something themselves, or when the user is selecting text.
  function handleCardClick(e: React.MouseEvent) {
    const target = e.target as HTMLElement
    if (target.closest('a, button, video, input, textarea, select, [data-no-reader]')) return
    if (window.getSelection()?.toString()) return
    setReaderOpen(true)
  }

  const tweetUrl = postUrl({ ...bookmark, mblogid: bookmark.weibo?.mblogid })
  const firstMedia = bookmark.mediaItems[0] ?? null
  const hasMedia = bookmark.mediaItems.length > 0
  const dateStr = formatDate(bookmark.tweetCreatedAt ?? bookmark.importedAt ?? null)
  const isKnownAuthor = bookmark.authorHandle !== 'unknown'
  const isWeibo = bookmark.platform === 'weibo'

  const tcoUrls = bookmark.text.match(TCO_REGEX) ?? []
  // Expanded t.co links render inline like on X; the media t.co is dropped
  const segments = postSegments(bookmark.platform, bookmark.text, bookmark.links)
  const textLength = tweetTextLength(segments)
  // Show link preview only when there's no real media attached
  const previewUrl = !hasMedia && tcoUrls.length > 0 ? tcoUrls[tcoUrls.length - 1] : null

  const TEXT_LIMIT = 280
  const isLong = textLength > TEXT_LIMIT
  const hasText = textLength > 0

  const currentCategoryIds = new Set(categories.map((c) => c.id))

  function handleRemoveCategory(categoryId: string) {
    const newIds = categories.filter((c) => c.id !== categoryId).map((c) => c.id)
    setCategories((prev) => prev.filter((c) => c.id !== categoryId))
    fetch(`/api/bookmarks/${bookmark.id}/categories`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ categoryIds: newIds }),
    }).catch(() => { setCategories(bookmark.categories) })
  }

  function handleSaveCategories(newIds: string[]) {
    const allCats = cachedCategories ?? []
    const newCategories = newIds
      .map((id) => {
        const found = allCats.find((c) => c.id === id)
        if (!found) return null
        return { id: found.id, name: found.name, slug: found.slug, color: found.color, confidence: 1.0 }
      })
      .filter((c): c is NonNullable<typeof c> => c !== null)
    setCategories(newCategories)
    setEditingCategories(false)
  }

  function handleDownload() {
    if (!firstMedia) return
    const a = document.createElement('a')
    a.href = `${proxyUrl(firstMedia.url, bookmark.tweetId)}&download=1`
    a.download = ''
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  function handleDownloadMarkdown() {
    const lines: string[] = []

    // Header
    if (isKnownAuthor) {
      lines.push(`# Tweet by @${bookmark.authorHandle}`)
      lines.push('')
      lines.push(`**Author:** ${bookmark.authorName} (@${bookmark.authorHandle})`)
    } else {
      lines.push(`# Bookmarked Tweet`)
    }
    if (dateStr) lines.push(`**Date:** ${dateStr}`)
    lines.push(`**URL:** ${tweetUrl}`)
    if (categories.length > 0) {
      lines.push(`**Categories:** ${categories.map((c) => c.name).join(', ')}`)
    }
    lines.push('')
    lines.push('---')
    lines.push('')

    // Full stored text — keep URLs so truncated threads show the continuation link
    if (bookmark.text) lines.push(bookmark.text)

    // If text ends with a t.co link the tweet may be part of a longer thread
    if (TCO_REGEX.test(bookmark.text)) {
      lines.push('')
      lines.push(`> *This tweet may be part of a longer thread. [Read on X ↗](${tweetUrl})*`)
    }

    // Media
    if (bookmark.mediaItems.length > 0) {
      lines.push('')
      lines.push('---')
      lines.push('')
      for (const m of bookmark.mediaItems) {
        if (m.type === 'photo') {
          lines.push(`![Image](${m.url})`)
        } else {
          lines.push(`[${m.type === 'video' ? 'Video' : 'GIF'} — view on X](${tweetUrl})`)
        }
      }
    }

    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `tweet-${bookmark.tweetId}.md`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  // Only show download if media is a photo or a real video (not a thumbnail JPEG stored as video)
  const isDownloadable = firstMedia !== null &&
    (firstMedia.type === 'photo' || isVideoUrl(firstMedia.url))

  // The card hides itself once deleted (this also closes its reader); lists
  // don't refetch, so their totals stay as they were until the next load.
  async function handleDelete() {
    const res = await fetch(`/api/bookmarks/${bookmark.id}`, { method: 'DELETE' })
    if (!res.ok) {
      const body = await res.json().catch(() => null) as { error?: string } | null
      throw new Error(body?.error ?? `HTTP ${res.status}`)
    }
    setDeleted(true)
  }

  if (deleted) return null

  return (
    <div
      className="group relative bg-zinc-900 border border-zinc-800 rounded-2xl hover:border-zinc-700 hover:shadow-xl hover:shadow-black/30 transition-all duration-200 flex flex-col flex-1 cursor-pointer"
      onClick={handleCardClick}
    >

      {/* Top media — full bleed, no padding */}
      {firstMedia && (
        <div className="border-b border-zinc-800/60 rounded-t-2xl overflow-hidden shrink-0">
          <TopMediaSlot item={firstMedia} tweetUrl={tweetUrl} tweetId={bookmark.tweetId} />
        </div>
      )}

      {/* Card body */}
      <div className="p-4 flex flex-col flex-1">

        {/* Author row + hover actions */}
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex items-center gap-2.5 min-w-0">
            {isKnownAuthor && (
              <AuthorAvatar name={bookmark.authorName} handle={bookmark.authorHandle} tweetId={bookmark.tweetId} />
            )}
            <div className="min-w-0">
              {isKnownAuthor && (
                <p className="text-sm font-semibold text-zinc-100 truncate leading-tight">
                  <ProfileLink platform={bookmark.platform} handle={bookmark.authorHandle}>{bookmark.authorName}</ProfileLink>
                </p>
              )}
              <p className="text-xs text-zinc-500 truncate">
                {isWeibo
                  ? <WeiboSubline date={dateStr} source={bookmark.weibo?.source} href={tweetUrl} />
                  : isKnownAuthor
                    ? <ProfileLink platform={bookmark.platform} handle={bookmark.authorHandle}>@{bookmark.authorHandle}</ProfileLink>
                    : dateStr}
                {bookmark.source === 'quote' && (
                  <span
                    className="ml-1.5 px-1.5 py-px rounded bg-zinc-800 text-[10px] text-zinc-400"
                    title="Saved because a bookmarked tweet quotes it"
                  >
                    引用
                  </span>
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-0.5 flex-shrink-0 mt-0.5">
          {/* Actions — visible on hover */}
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={handleDownloadMarkdown}
              className="p-1.5 rounded-lg text-zinc-600 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
              title="Download as Markdown"
            >
              <FileText size={13} />
            </button>
            {isDownloadable && (
              <button
                onClick={handleDownload}
                className="p-1.5 rounded-lg text-zinc-600 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
                title="Download media"
              >
                <Download size={13} />
              </button>
            )}
            <a
              href={tweetUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="p-1.5 rounded-lg text-zinc-600 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
              title="Open on X"
            >
              <ExternalLink size={13} />
            </a>
            <DeleteButton onDelete={handleDelete} />
          </div>
          {/* Full tweet — always visible and colored, unlike the hover actions */}
          <button
            onClick={(e) => { e.stopPropagation(); setReaderOpen(true) }}
            className="p-1.5 rounded-lg text-indigo-400 bg-indigo-500/10 hover:text-indigo-300 hover:bg-indigo-500/20 transition-colors"
            title="Read full tweet"
          >
            <BookOpen size={13} />
          </button>
          </div>
        </div>

        {/* Tweet text */}
        <div className={`flex-1 ${previewUrl && !hasText ? '' : 'min-h-[4.5rem]'}`}>
          {hasText && (
            <p className="text-sm text-zinc-200 leading-relaxed">
              <TweetText segments={segments} limit={expanded ? undefined : TEXT_LIMIT} platform={bookmark.platform} />
              {isLong && !expanded && (
                <span>
                  {'… '}
                  <button
                    onClick={() => setExpanded(true)}
                    className="text-indigo-400 hover:text-indigo-300 transition-colors"
                  >
                    more
                  </button>
                </span>
              )}
              {isLong && expanded && (
                <span>
                  {' '}
                  <button
                    onClick={() => setExpanded(false)}
                    className="text-zinc-500 hover:text-zinc-400 transition-colors text-xs"
                  >
                    less
                  </button>
                </span>
              )}
            </p>
          )}
          {!hasText && !firstMedia && !previewUrl && !bookmark.quoted && !note && (
            <p className="text-xs text-zinc-700 italic">No text content</p>
          )}
          {bookmark.articlePreview && <ArticlePreviewNote tweetUrl={tweetUrl} />}
          {bookmark.quoted && <QuotedTweetBlock platform={bookmark.platform} quoted={bookmark.quoted} />}
          {!bookmark.quoted && bookmark.quotedTweetId && <QuotesAnotherLink platform={bookmark.platform} tweetId={bookmark.quotedTweetId} />}
          {previewUrl && (
            <LinkPreview url={previewUrl} tweetUrl={tweetUrl} tweetId={bookmark.tweetId} prominent={!hasText} />
          )}
          {note && (
            <p
              className="mt-2 px-2.5 py-1.5 rounded-lg border border-amber-500/20 bg-amber-500/10 text-xs text-amber-200/90 leading-relaxed whitespace-pre-wrap break-words line-clamp-3"
              title="备注"
            >
              {note}
            </p>
          )}
        </div>

        {/* Footer: categories + meta — fixed two-row structure keeps all cards aligned */}
        <div className="relative mt-auto pt-3 border-t border-zinc-800/50">
          {/* Row 1: chips + date — consistent height across all cards */}
          <div className="flex items-center gap-1.5 flex-wrap min-h-[1.5rem]">
            {categories.map((cat) => (
              <CategoryChip key={cat.id} category={cat} onRemove={handleRemoveCategory} />
            ))}
            {categories.length === 0 && (
              <span className="text-xs text-zinc-700 italic">Uncategorized</span>
            )}
            {isKnownAuthor && !isWeibo && dateStr && (
              <span className="ml-auto text-xs text-zinc-600 flex-shrink-0">
                {dateStr}
              </span>
            )}
          </div>

          {/* Row 2: edit button — always in DOM to reserve space; invisible until hover */}
          <div className="mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={() => setEditingCategories((v) => !v)}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs text-zinc-700 hover:text-zinc-300 hover:bg-zinc-800 border border-transparent hover:border-zinc-700 transition-all"
              title="Edit categories"
            >
              <Pencil size={10} />
              edit
            </button>
          </div>

          {editingCategories && (
            <div data-no-reader>
            <CategoryEditor
              bookmarkId={bookmark.id}
              currentCategoryIds={currentCategoryIds}
              onSave={handleSaveCategories}
              onClose={() => setEditingCategories(false)}
            />
            </div>
          )}
        </div>

      </div>
      {readerOpen && (
        <TweetReader
          bookmark={{ ...bookmark, note }}
          categories={categories}
          onClose={() => setReaderOpen(false)}
          onDelete={handleDelete}
          onNoteChange={setNote}
        />
      )}
    </div>
  )
}
