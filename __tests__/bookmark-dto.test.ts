import { describe, it, expect } from 'vitest'
import { toBookmarkWithMedia } from '@/lib/bookmark-dto'

describe('toBookmarkWithMedia', () => {
  it('carries links and the quoted tweet from entities to every card', () => {
    const entities = JSON.stringify({
      v: 2,
      links: [{ url: 'https://t.co/a', expandedUrl: 'https://example.com/x', displayUrl: 'example.com/x' }],
      quoted: { tweetId: '2', authorName: 'A', authorHandle: 'a', text: 'q', links: [] },
    })
    const dto = toBookmarkWithMedia({
      id: 'b1', tweetId: '1', text: 't https://t.co/a', authorHandle: 'h', authorName: 'H',
      tweetCreatedAt: new Date('2026-10-01T00:00:00Z'), importedAt: new Date('2026-10-02T00:00:00Z'),
      entities,
      mediaItems: [{ id: 'm1', type: 'photo', url: 'u', thumbnailUrl: null }],
      categories: [{ confidence: 0.9, category: { id: 'c1', name: 'C', slug: 'c', color: '#fff' } }],
    })
    expect(dto.links).toEqual([{ url: 'https://t.co/a', expandedUrl: 'https://example.com/x', displayUrl: 'example.com/x' }])
    expect(dto.quoted?.tweetId).toBe('2')
    expect(dto.tweetCreatedAt).toBe('2026-10-01T00:00:00.000Z')
    expect(dto.mediaItems[0]).toEqual({ id: 'm1', type: 'photo', url: 'u', thumbnailUrl: null })
    expect(dto.categories[0]).toEqual({ id: 'c1', name: 'C', slug: 'c', color: '#fff', confidence: 0.9 })
  })
})
