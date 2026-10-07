/**
 * The platform a saved post comes from, and its links there. Every link to a
 * post, a profile or a mention goes through here instead of hard-coding x.com,
 * so a platform's URL rules live in one place.
 */

export type Platform = 'x' | 'weibo'

export const PLATFORMS: readonly Platform[] = ['x', 'weibo']

/** Rows saved before the platform column existed are X posts. */
export function asPlatform(value: string | null | undefined): Platform {
  return value === 'weibo' ? 'weibo' : 'x'
}

export interface PostRef {
  platform?: string | null
  tweetId: string
  /** X: the @handle ('unknown' when not known). Weibo: the user's numeric uid. */
  authorHandle: string
  /** Weibo's short post id (as in weibo.com/<uid>/<mblogid>); X has none. */
  mblogid?: string | null
}

/** The post on its platform. */
export function postUrl(p: PostRef): string {
  if (asPlatform(p.platform) === 'weibo') {
    return p.mblogid && p.authorHandle !== 'unknown'
      ? `https://weibo.com/${p.authorHandle}/${p.mblogid}`
      : postUrlById('weibo', p.tweetId)
  }
  return p.authorHandle && p.authorHandle !== 'unknown'
    ? `https://x.com/${p.authorHandle}/status/${p.tweetId}`
    : `https://x.com/i/web/status/${p.tweetId}`
}

/** A post known only by its id (e.g. one a quoted post quotes). weibo.com/detail/<id> redirects to the post. */
export function postUrlById(platform: string | null | undefined, tweetId: string): string {
  return asPlatform(platform) === 'weibo'
    ? `https://weibo.com/detail/${tweetId}`
    : `https://x.com/i/web/status/${tweetId}`
}

/** The author's profile: X by @handle, Weibo by uid. */
export function profileUrl(platform: string | null | undefined, authorHandle: string): string {
  return asPlatform(platform) === 'weibo'
    ? `https://weibo.com/u/${authorHandle}`
    : `https://x.com/${authorHandle}`
}

/** An @mention in post text: X mentions a handle, Weibo a nickname. */
export function mentionUrl(platform: string | null | undefined, name: string): string {
  return asPlatform(platform) === 'weibo'
    ? `https://weibo.com/n/${encodeURIComponent(name)}`
    : `https://x.com/${name}`
}
