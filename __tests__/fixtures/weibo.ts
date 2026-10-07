import type { WeiboStatus } from '@/lib/weibo'

/** A repost of a post with two photos; the repost itself has a video. */
export const original: WeiboStatus = {
  id: 5000000000000002,
  mblogid: 'Pabc',
  created_at: '2026-04-01T08:00:00.000Z',
  text_raw: '原微博 #话题# 看图',
  source: '<a href="https://app.weibo.com/t/feed/1" rel="nofollow">iPhone客户端</a>',
  region_name: '发布于 北京',
  user: { id: 222, screen_name: '原作者', avatar_hd: 'https://tvax1.sinaimg.cn/large/av222.jpg' },
  pic_ids: ['p1', 'p2'],
  pic_infos: {
    p2: { largest: { url: 'https://wx1.sinaimg.cn/large/p2.jpg' } },
    p1: { largest: { url: 'https://wx1.sinaimg.cn/large/p1.jpg' } },
  },
}

export const repost: WeiboStatus = {
  id: 5000000000000001,
  mblogid: 'Rxyz',
  created_at: '2026-04-02T08:00:00.000Z',
  text_raw: '转发理由 //@中间人-A:好 http://t.cn/A6abc',
  user: { id: 111, screen_name: '我关注的人' },
  page_info: { object_type: 'video', media_info: { mp4_sd_url: 'https://f.video.weibocdn.com/o0/sd.mp4?x=1', mp4_hd_url: 'https://f.video.weibocdn.com/o0/hd.mp4?x=1' } },
  retweeted_status: original,
}
