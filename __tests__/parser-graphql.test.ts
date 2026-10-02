import { describe, it, expect } from 'vitest'
import { parseGraphqlTweet, parseBookmarksJson } from '@/lib/parser'

const user = { core: { screen_name: 'alice', name: 'Alice' }, legacy: {} }

function tweet(extra: Record<string, unknown> = {}) {
  return {
    __typename: 'Tweet',
    rest_id: '1800000000000000001',
    core: { user_results: { result: user } },
    legacy: {
      full_text: 'short prefix… https://t.co/x',
      created_at: 'Wed Oct 01 12:00:00 +0000 2026',
      entities: { hashtags: [{ text: 'ai' }], urls: [{ expanded_url: 'https://example.com' }] },
    },
    ...extra,
  }
}

describe('parseGraphqlTweet', () => {
  it('uses the complete note_tweet text for long posts', () => {
    const full = 'x'.repeat(1200)
    const b = parseGraphqlTweet(tweet({ note_tweet: { note_tweet_results: { result: { text: full } } } }))
    expect(b?.text).toBe(full)
  })

  it('uses article title and body for X Articles, with the cover as media', () => {
    const b = parseGraphqlTweet(tweet({
      article: { article_results: { result: {
        title: 'Title', preview_text: 'Body preview',
        cover_media: { media_info: { original_img_url: 'https://pbs.twimg.com/media/cover.jpg' } },
      } } },
    }))
    expect(b?.text).toBe('Title\n\nBody preview')
    expect(b?.media).toEqual([{ type: 'photo', url: 'https://pbs.twimg.com/media/cover.jpg', thumbnailUrl: 'https://pbs.twimg.com/media/cover.jpg' }])
  })

  it('falls back to legacy.full_text for ordinary posts', () => {
    expect(parseGraphqlTweet(tweet())?.text).toBe('short prefix… https://t.co/x')
  })

  it('reads the author from user_results.result.core, then legacy', () => {
    expect(parseGraphqlTweet(tweet())).toMatchObject({ authorHandle: 'alice', authorName: 'Alice' })
    const legacyOnly = tweet({ core: { user_results: { result: { legacy: { screen_name: 'bob', name: 'Bob' } } } } })
    expect(parseGraphqlTweet(legacyOnly)).toMatchObject({ authorHandle: 'bob', authorName: 'Bob' })
  })

  it('unwraps TweetWithVisibilityResults and keeps hashtags, urls, date', () => {
    const b = parseGraphqlTweet({ __typename: 'TweetWithVisibilityResults', tweet: tweet() })
    expect(b?.tweetId).toBe('1800000000000000001')
    expect(b?.hashtags).toEqual(['ai'])
    expect(b?.urls).toEqual(['https://example.com'])
    expect(b?.tweetCreatedAt?.toISOString()).toBe('2026-10-01T12:00:00.000Z')
  })

  it('stores the video mp4 as url and the poster image as thumbnailUrl', () => {
    const b = parseGraphqlTweet(tweet({
      legacy: {
        full_text: 'video',
        extended_entities: { media: [{
          type: 'video',
          media_url_https: 'https://pbs.twimg.com/poster.jpg',
          video_info: { variants: [
            { content_type: 'video/mp4', bitrate: 256000, url: 'https://video.twimg.com/low.mp4' },
            { content_type: 'video/mp4', bitrate: 2176000, url: 'https://video.twimg.com/high.mp4' },
          ] },
        }] },
      },
    }))
    expect(b?.media).toEqual([{ type: 'video', url: 'https://video.twimg.com/high.mp4', thumbnailUrl: 'https://pbs.twimg.com/poster.jpg' }])
  })

  it('returns null without rest_id', () => {
    expect(parseGraphqlTweet({ legacy: { full_text: 'x' } })).toBeNull()
  })
})

describe('parseBookmarksJson with bookmarklet fallback files', () => {
  it('parses { source, tweets: [GraphQL tweets] }', () => {
    const full = 'y'.repeat(600)
    const json = JSON.stringify({ source: 'like', tweets: [tweet({ note_tweet: { note_tweet_results: { result: { text: full } } } })] })
    const [b] = parseBookmarksJson(json)
    expect(b.text).toBe(full)
    expect(b.authorHandle).toBe('alice')
  })
})
