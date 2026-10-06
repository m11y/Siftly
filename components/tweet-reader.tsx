'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ExternalLink, X } from 'lucide-react'
import type { BookmarkCategory, BookmarkWithMedia } from '@/lib/types'
import { TweetText, postSegments } from '@/components/tweet-text'
import { postUrl } from '@/lib/platform'
import MediaLightbox, { type LightboxState } from '@/components/media-lightbox'
import { ArticlePreviewNote, AuthorAvatar, DeleteButton, WeiboSubline, ProfileLink, QuotedTweetBlock, QuotesAnotherLink, formatDate, isVideoUrl, proxyUrl } from '@/components/tweet-parts'

/**
 * Full view of one tweet: complete text with its line breaks, every photo and
 * video (local copies), and the full quoted tweet. Cards truncate; this doesn't.
 * Rendered into document.body so card hover/overflow styles can't clip it.
 */
export default function TweetReader({
  bookmark,
  categories = bookmark.categories,
  onClose,
  onDelete,
  onNoteChange,
}: {
  bookmark: BookmarkWithMedia
  categories?: BookmarkCategory[]
  onClose: () => void
  /** Shown as a delete button when given; the owner unmounts the reader on success. */
  onDelete?: () => Promise<void>
  /** Told the stored note after a save, so the opener can show it. */
  onNoteChange?: (note: string | null) => void
}) {
  const [lightbox, setLightbox] = useState<LightboxState | null>(null)
  const [savedNote, setSavedNote] = useState(bookmark.note ?? '')
  const [draft, setDraft] = useState(savedNote)
  const [savingNote, setSavingNote] = useState(false)
  const [noteError, setNoteError] = useState<string | null>(null)
  const noteRef = useRef<HTMLTextAreaElement>(null)
  const noteDirty = draft.trim() !== savedNote

  async function saveNote() {
    if (!noteDirty || savingNote) return
    setSavingNote(true)
    setNoteError(null)
    try {
      const res = await fetch(`/api/bookmarks/${bookmark.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: draft }),
      })
      const body = await res.json().catch(() => null) as { note?: string | null; error?: string } | null
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`)
      const stored = body?.note ?? null
      setSavedNote(stored ?? '')
      setDraft(stored ?? '')
      onNoteChange?.(stored)
    } catch (err) {
      setNoteError(`保存失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSavingNote(false)
    }
  }
  // Esc while the lightbox is open closes only the lightbox, not this dialog.
  const lightboxOpen = useRef(false)
  useEffect(() => { lightboxOpen.current = lightbox !== null }, [lightbox])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || lightboxOpen.current) return
      // Esc in the note box only leaves it, so an unsaved note isn't lost.
      if (document.activeElement === noteRef.current) { noteRef.current?.blur(); return }
      onClose()
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [onClose])

  const isKnownAuthor = bookmark.authorHandle !== 'unknown'
  const tweetUrl = postUrl({ ...bookmark, mblogid: bookmark.weibo?.mblogid })
  const segments = postSegments(bookmark.platform, bookmark.text, bookmark.links)
  const media = bookmark.mediaItems
  const photoSrcs = media.filter((m) => m.type === 'photo').map((m) => proxyUrl(m.url, bookmark.tweetId))

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 cursor-default"
      // React bubbles portal events to the card, whose click opens this dialog;
      // stop here so closing via the backdrop doesn't immediately reopen it.
      onClick={(e) => { e.stopPropagation(); onClose() }}
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
            {isKnownAuthor && (
              <p className="text-sm font-semibold text-zinc-100 truncate">
                <ProfileLink platform={bookmark.platform} handle={bookmark.authorHandle}>{bookmark.authorName}</ProfileLink>
              </p>
            )}
            <p className="text-xs text-zinc-500 truncate">
              {bookmark.platform === 'weibo' ? (
                <WeiboSubline date={formatDate(bookmark.tweetCreatedAt ?? bookmark.importedAt ?? null)} source={bookmark.weibo?.source} href={tweetUrl} />
              ) : (
                <>
                  {isKnownAuthor && <><ProfileLink platform={bookmark.platform} handle={bookmark.authorHandle}>@{bookmark.authorHandle}</ProfileLink>{' · '}</>}
                  {formatDate(bookmark.tweetCreatedAt ?? bookmark.importedAt ?? null)}
                </>
              )}
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
          {onDelete && <DeleteButton onDelete={onDelete} size={16} />}
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
              <TweetText segments={segments} platform={bookmark.platform} />
            </p>
          )}

          {media.length > 0 && (
            <div className={`grid gap-2 ${media.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
              {media.map((m) => m.type === 'photo' ? (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setLightbox({ srcs: photoSrcs, index: photoSrcs.indexOf(proxyUrl(m.url, bookmark.tweetId)) })}
                  className="block cursor-zoom-in"
                  title="View full size"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={proxyUrl(m.url, bookmark.tweetId)}
                    alt=""
                    className="w-full max-h-[70vh] object-contain rounded-xl bg-black"
                    loading="lazy"
                  />
                </button>
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

          {bookmark.articlePreview && <ArticlePreviewNote tweetUrl={tweetUrl} />}
          {bookmark.quoted && <QuotedTweetBlock platform={bookmark.platform} quoted={bookmark.quoted} full onOpenPhotos={(srcs, index) => setLightbox({ srcs, index })} />}
          {!bookmark.quoted && bookmark.quotedTweetId && <QuotesAnotherLink platform={bookmark.platform} tweetId={bookmark.quotedTweetId} />}

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

          <div className="pt-1">
            <label htmlFor={`note-${bookmark.id}`} className="block mb-1.5 text-xs font-medium text-amber-300/80">备注</label>
            <textarea
              id={`note-${bookmark.id}`}
              ref={noteRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void saveNote() }
              }}
              rows={3}
              placeholder="写几句，方便以后搜到这条…"
              className="w-full resize-y rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-amber-500/50"
            />
            <div className="mt-1.5 flex items-center justify-end gap-2">
              {noteError && <span className="mr-auto text-xs text-red-400">{noteError}</span>}
              {noteDirty && !savingNote && <span className="text-xs text-zinc-500">⌘↵ 保存</span>}
              <button
                type="button"
                onClick={() => void saveNote()}
                disabled={!noteDirty || savingNote}
                className="px-3 py-1 rounded-lg text-xs font-medium bg-amber-500/15 text-amber-200 hover:bg-amber-500/25 transition-colors disabled:opacity-40 disabled:cursor-default"
              >
                {savingNote ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        </div>
        {/* Inside the dialog box: the lightbox portals elsewhere, but React bubbles
            its clicks through here, and this box stops them before the backdrop. */}
        <MediaLightbox state={lightbox} onClose={() => setLightbox(null)} />
      </div>
    </div>,
    document.body,
  )
}
