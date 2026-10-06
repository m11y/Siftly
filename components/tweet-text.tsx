import React from 'react'
import type { TweetLink } from '@/lib/types'
import { mentionUrl } from '@/lib/platform'

const TCO_REGEX = /https?:\/\/t\.co\/\w+/g
// X handles: 1–15 of [A-Za-z0-9_]; not preceded by a handle char, so e-mail
// addresses (a@b.com) are left alone.
const MENTION_REGEX = /(?<![A-Za-z0-9_])@([A-Za-z0-9_]{1,15})(?![A-Za-z0-9_])/g

type Segment = { text: string } | { link: TweetLink } | { mention: string }

function splitMentions(text: string): Segment[] {
  const out: Segment[] = []
  let last = 0
  for (const m of text.matchAll(MENTION_REGEX)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) })
    out.push({ mention: m[1] })
    last = m.index + m[0].length
  }
  if (last < text.length) out.push({ text: text.slice(last) })
  return out
}

/**
 * Split tweet text the way X renders it: a t.co URL that X expanded (see
 * entities `links`) becomes a link labeled with X's display URL and pointing
 * straight at the target, so no click goes through t.co. Any other t.co URL is
 * the trailing media link and is dropped, since the media renders on its own.
 * @handles become links to the user's X profile, like on X.
 */
export function tweetSegments(text: string, links: TweetLink[] = []): Segment[] {
  const byUrl = new Map(links.map((l) => [l.url, l]))
  const segments: Segment[] = []
  let last = 0
  for (const m of text.matchAll(TCO_REGEX)) {
    if (m.index > last) segments.push({ text: text.slice(last, m.index) })
    const link = byUrl.get(m[0])
    if (link) segments.push({ link })
    last = m.index + m[0].length
  }
  if (last < text.length) segments.push({ text: text.slice(last) })

  // Trim the whitespace left behind by dropped trailing/leading media links.
  const first = segments[0]
  if (first && 'text' in first) first.text = first.text.trimStart()
  const end = segments[segments.length - 1]
  if (end && 'text' in end) end.text = end.text.trimEnd()
  return segments
    .filter((s) => !('text' in s) || s.text)
    .flatMap((s) => ('text' in s ? splitMentions(s.text) : [s]))
}

// Weibo text: plain URLs (t.cn and others), #话题# and @nickname. Nicknames are
// 1–30 of CJK, letters, digits, _ and -, so "//@name:" ends at the colon.
const WEIBO_TOKEN_REGEX = /(https?:\/\/[A-Za-z0-9./?=&%_~:#+-]+)|#([^#\n]{1,64})#|@([\u4e00-\u9fa5A-Za-z0-9_-]{1,30})/g

/**
 * Split Weibo text the way Weibo renders it: links (to url_struct's target when
 * known), #话题# to its Weibo search and @nicknames to the user's page. Emoji
 * codes like [doge] stay as text.
 */
export function weiboSegments(text: string, links: TweetLink[] = []): Segment[] {
  const byUrl = new Map(links.map((l) => [l.url, l]))
  const segments: Segment[] = []
  let last = 0
  for (const m of text.matchAll(WEIBO_TOKEN_REGEX)) {
    if (m.index > last) segments.push({ text: text.slice(last, m.index) })
    if (m[1]) {
      segments.push({ link: byUrl.get(m[1]) ?? { url: m[1], expandedUrl: m[1], displayUrl: m[1].replace(/^https?:\/\//, '') } })
    } else if (m[2]) {
      const topic = `#${m[2]}#`
      segments.push({ link: { url: topic, expandedUrl: `https://s.weibo.com/weibo?q=${encodeURIComponent(topic)}`, displayUrl: topic } })
    } else {
      segments.push({ mention: m[3] })
    }
    last = m.index + m[0].length
  }
  if (last < text.length) segments.push({ text: text.slice(last) })
  return segments
}

/** Segments for a post's text by its platform. */
export function postSegments(platform: string | undefined, text: string, links: TweetLink[] = []): Segment[] {
  return platform === 'weibo' ? weiboSegments(text, links) : tweetSegments(text, links)
}

function segmentLength(s: Segment): number {
  if ('text' in s) return s.text.length
  return 'link' in s ? s.link.displayUrl.length : s.mention.length + 1
}

export function tweetTextLength(segments: Segment[]): number {
  return segments.reduce((n, s) => n + segmentLength(s), 0)
}

/** Render segments, cut to `limit` visible characters when given. */
export function TweetText({ segments, limit, platform }: { segments: Segment[]; limit?: number; platform?: string }) {
  const nodes: React.ReactNode[] = []
  let budget = limit ?? Infinity
  for (const [i, s] of segments.entries()) {
    if (budget <= 0) break
    if ('text' in s) {
      nodes.push(s.text.slice(0, budget))
    } else if ('mention' in s) {
      nodes.push(
        <a
          key={i}
          href={mentionUrl(platform, s.mention)}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-indigo-400 hover:text-indigo-300 hover:underline"
        >
          @{s.mention}
        </a>,
      )
    } else {
      nodes.push(
        <a
          key={i}
          href={s.link.expandedUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-indigo-400 hover:text-indigo-300 hover:underline break-all"
          title={s.link.expandedUrl}
        >
          {s.link.displayUrl}
        </a>,
      )
    }
    budget -= segmentLength(s)
  }
  return <>{nodes}</>
}
