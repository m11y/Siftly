import { describe, it, expect } from 'vitest'
import { extractEntities, displayEntities, ENTITIES_VERSION } from '@/lib/rawjson-extractor'
import { tweetSegments, tweetTextLength } from '@/components/tweet-text'

const bili = 'https://www.bilibili.com/video/BV194Yk68Em3/?spm_id_from=x'
const raw = {
  rest_id: '2099425560866980052',
  legacy: {
    full_text: '续集来了。\n\n前作也推荐看。\n\nhttps://t.co/EzsRGsLlHL https://t.co/slM9dICYsc',
    entities: {
      urls: [{ url: 'https://t.co/EzsRGsLlHL', expanded_url: bili, display_url: 'bilibili.com/video/BV194Yk…' }],
      media: [{ url: 'https://t.co/slM9dICYsc', type: 'photo' }],
    },
    quoted_status_id_str: '2079484671075950652',
  },
  quoted_status_result: { result: {
    __typename: 'Tweet',
    rest_id: '2079484671075950652',
    core: { user_results: { result: { core: { name: 'taresky', screen_name: 'taresky' } } } },
    legacy: {
      full_text: '这期韩大爷好看。\n\nhttps://t.co/a0mYhlbLL6',
      entities: { urls: [{ url: 'https://t.co/a0mYhlbLL6', expanded_url: 'https://www.bilibili.com/video/BV1diN86ZEKx/', display_url: 'bilibili.com/video/BV1diN8…' }] },
    },
  } },
}

describe('entities links and quoted tweet', () => {
  const e = extractEntities(JSON.stringify(raw))

  it('maps t.co to the expanded URL and keeps the quoted tweet', () => {
    expect(e.v).toBe(ENTITIES_VERSION)
    expect(e.links).toEqual([{ url: 'https://t.co/EzsRGsLlHL', expandedUrl: bili, displayUrl: 'bilibili.com/video/BV194Yk…' }])
    expect(e.quoted).toMatchObject({ tweetId: '2079484671075950652', authorHandle: 'taresky', text: '这期韩大爷好看。\n\nhttps://t.co/a0mYhlbLL6' })
    expect(e.quoted?.links[0].expandedUrl).toBe('https://www.bilibili.com/video/BV1diN86ZEKx/')
    expect(JSON.stringify(e).startsWith(`{"v":${ENTITIES_VERSION},`)).toBe(true) // backfill marker
  })

  it('renders the expanded link and drops the media t.co', () => {
    const { links } = displayEntities(JSON.stringify(e))
    const segs = tweetSegments(raw.legacy.full_text, links)
    expect(segs).toEqual([
      { text: '续集来了。\n\n前作也推荐看。\n\n' },
      { link: links[0] },
    ])
    expect(tweetTextLength(segs)).toBe('续集来了。\n\n前作也推荐看。\n\n'.length + 'bilibili.com/video/BV194Yk…'.length)
  })

  it('treats missing or old entities as no links', () => {
    expect(displayEntities(null)).toEqual({ links: [], quoted: null })
    expect(displayEntities('{"hashtags":[]}')).toEqual({ links: [], quoted: null })
    expect(tweetSegments('photo https://t.co/abc', [])).toEqual([{ text: 'photo' }])
  })
})

describe('mentions', () => {
  it('links @handles to profiles but leaves e-mail addresses alone', () => {
    const segs = tweetSegments('@Isalmwp 一个破工作，cc @bob_1. mail a@b.com', [])
    expect(segs).toEqual([
      { mention: 'Isalmwp' },
      { text: ' 一个破工作，cc ' },
      { mention: 'bob_1' },
      { text: '. mail a@b.com' },
    ])
    expect(tweetTextLength(segs)).toBe('@Isalmwp 一个破工作，cc @bob_1. mail a@b.com'.length)
  })
})
