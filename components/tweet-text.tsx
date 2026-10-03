import React from 'react'
import type { TweetLink } from '@/lib/types'

const TCO_REGEX = /https?:\/\/t\.co\/\w+/g

type Segment = { text: string } | { link: TweetLink }

/**
 * Split tweet text the way X renders it: a t.co URL that X expanded (see
 * entities `links`) becomes a link labeled with X's display URL and pointing
 * straight at the target, so no click goes through t.co. Any other t.co URL is
 * the trailing media link and is dropped, since the media renders on its own.
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
  return segments.filter((s) => !('text' in s) || s.text)
}

function segmentLength(s: Segment): number {
  return 'text' in s ? s.text.length : s.link.displayUrl.length
}

export function tweetTextLength(segments: Segment[]): number {
  return segments.reduce((n, s) => n + segmentLength(s), 0)
}

/** Render segments, cut to `limit` visible characters when given. */
export function TweetText({ segments, limit }: { segments: Segment[]; limit?: number }) {
  const nodes: React.ReactNode[] = []
  let budget = limit ?? Infinity
  for (const [i, s] of segments.entries()) {
    if (budget <= 0) break
    if ('text' in s) {
      nodes.push(s.text.slice(0, budget))
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
