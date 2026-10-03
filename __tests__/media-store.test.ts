import { describe, it, expect } from 'vitest'
import { collectTargets, largeAvatarUrl, localName } from '@/lib/media-store'

describe('localName', () => {
  it('keeps the X file name and drops the size query', () => {
    expect(localName('https://pbs.twimg.com/media/HN0ctzRbkAAnMkk.jpg?name=orig')).toBe('HN0ctzRbkAAnMkk.jpg')
    expect(localName('https://video.twimg.com/amplify_video/1/vid/avc1/1080x1364/uwNHNkiI40Pos5uy.mp4?tag=29')).toBe('uwNHNkiI40Pos5uy.mp4')
  })

  it('takes the extension from ?format= when the path has none', () => {
    expect(localName('https://pbs.twimg.com/card_img/2105/1VY97btX?format=jpg&name=800x419')).toBe('1VY97btX.jpg')
  })

  it('rejects non-X hosts', () => {
    expect(localName('https://example.com/a.jpg')).toBeNull()
  })
})

describe('largeAvatarUrl', () => {
  it('upgrades the 48px avatar to 400x400', () => {
    expect(largeAvatarUrl('https://pbs.twimg.com/profile_images/1/BckjXqU0_normal.jpg'))
      .toBe('https://pbs.twimg.com/profile_images/1/BckjXqU0_400x400.jpg')
  })
})

describe('collectTargets', () => {
  const raw = {
    core: { user_results: { result: { avatar: { image_url: 'https://pbs.twimg.com/profile_images/1/Av_normal.jpg' } } } },
    legacy: { extended_entities: { media: [{
      type: 'video',
      media_url_https: 'https://pbs.twimg.com/amplify_video_thumb/9/img/Poster.jpg',
      video_info: { variants: [
        { content_type: 'application/x-mpegURL', url: 'https://video.twimg.com/amplify_video/9/pl/list.m3u8' },
        { content_type: 'video/mp4', bitrate: 256000, url: 'https://video.twimg.com/amplify_video/9/vid/avc1/320x180/Low.mp4' },
        { content_type: 'video/mp4', bitrate: 2176000, url: 'https://video.twimg.com/amplify_video/9/vid/avc1/1280x720/High.mp4' },
      ] },
    }] } },
    card: { legacy: { binding_values: [
      { key: 'thumbnail_image_original', value: { image_value: { url: 'https://pbs.twimg.com/card_img/5/Card?format=jpg&name=orig' } } },
    ] } },
  }

  it('lists photo sizes largest first, video bitrates best first, poster, avatar and card', () => {
    const targets = collectTargets({
      rawJson: JSON.stringify(raw),
      mediaItems: [
        { type: 'photo', url: 'https://pbs.twimg.com/media/Pic.jpg', thumbnailUrl: 'https://pbs.twimg.com/media/Pic.jpg' },
        { type: 'video', url: 'https://video.twimg.com/amplify_video/9/vid/avc1/1280x720/High.mp4', thumbnailUrl: 'https://pbs.twimg.com/amplify_video_thumb/9/img/Poster.jpg' },
      ],
    })
    expect(targets.map((t) => t.name)).toEqual(['Pic.jpg', 'High.mp4', 'Poster.jpg', 'Av_400x400.jpg', 'Card.jpg'])
    expect(targets[0].candidates.map((u) => new URL(u).searchParams.get('name')))
      .toEqual(['orig', '4096x4096', 'large', 'medium', null])
    expect(targets[1].candidates).toEqual([
      'https://video.twimg.com/amplify_video/9/vid/avc1/1280x720/High.mp4',
      'https://video.twimg.com/amplify_video/9/vid/avc1/320x180/Low.mp4',
    ])
    expect(targets[3].candidates).toEqual([
      'https://pbs.twimg.com/profile_images/1/Av_400x400.jpg',
      'https://pbs.twimg.com/profile_images/1/Av_normal.jpg',
    ])
  })

  it('handles old file imports without GraphQL JSON', () => {
    const targets = collectTargets({
      rawJson: '{"id_str":"1"}',
      mediaItems: [{ type: 'video', url: 'https://video.twimg.com/ext_tw_video/1/pu/vid/V.mp4', thumbnailUrl: 'https://video.twimg.com/ext_tw_video/1/pu/vid/V.mp4' }],
    })
    expect(targets.map((t) => t.name)).toEqual(['V.mp4'])
  })
})
