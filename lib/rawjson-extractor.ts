/**
 * Zero-cost entity extraction from stored rawJson tweet data.
 * No AI calls — pure data mining from already-stored JSON.
 */
import prisma from '@/lib/db'

/** A t.co link in the tweet text and what X says it points to. */
export interface TweetLink {
  url: string          // the t.co URL as it appears in the text
  expandedUrl: string
  displayUrl: string   // X's shortened label, e.g. "bilibili.com/video/BV19…"
}

export interface QuotedTweet {
  tweetId: string
  authorName: string
  authorHandle: string
  text: string
  links: TweetLink[]
}

/**
 * Bump when the extracted shape changes: backfillEntities re-extracts rows whose
 * stored JSON lacks the current marker (rawJson stays the source of truth).
 */
export const ENTITIES_VERSION = 3

export interface ExtractedEntities {
  v: number
  hashtags: string[]
  urls: string[]      // expanded/display URLs from tweet entities
  mentions: string[]  // @handles mentioned
  tools: string[]     // detected tool/product names from URLs
  tweetType: 'thread' | 'reply' | 'quote' | 'original'
  hasMedia: boolean
  mediaTypes: string[]
  links: TweetLink[]   // t.co → expanded URL, so the UI can show links without resolving t.co
  quoted: QuotedTweet | null
  /** X Article saved with only its preview (opening it on X with the panel on fills it in). */
  articlePreview: boolean
}

const KNOWN_TOOL_DOMAINS: Record<string, string> = {
  // Code & Dev
  'github.com': 'GitHub',
  'gitlab.com': 'GitLab',
  'bitbucket.org': 'Bitbucket',
  'stackoverflow.com': 'Stack Overflow',
  'replit.com': 'Replit',
  'codepen.io': 'CodePen',
  'codesandbox.io': 'CodeSandbox',
  'stackblitz.com': 'StackBlitz',
  'glitch.com': 'Glitch',
  'npmjs.com': 'npm',
  'pypi.org': 'PyPI',
  'crates.io': 'crates.io',
  'docker.com': 'Docker',
  'hub.docker.com': 'Docker Hub',
  'vercel.com': 'Vercel',
  'netlify.com': 'Netlify',
  'railway.app': 'Railway',
  'render.com': 'Render',
  'fly.io': 'Fly.io',
  'supabase.com': 'Supabase',
  'planetscale.com': 'PlanetScale',
  'neon.tech': 'Neon',
  'turso.tech': 'Turso',
  'cloudflare.com': 'Cloudflare',
  'aws.amazon.com': 'AWS',
  'console.aws.amazon.com': 'AWS',
  'cloud.google.com': 'Google Cloud',
  'azure.microsoft.com': 'Azure',
  'linear.app': 'Linear',
  'jira.atlassian.com': 'Jira',
  'atlassian.com': 'Atlassian',
  // AI / ML
  'huggingface.co': 'HuggingFace',
  'arxiv.org': 'arxiv',
  'openai.com': 'OpenAI',
  'anthropic.com': 'Anthropic',
  'replicate.com': 'Replicate',
  'perplexity.ai': 'Perplexity',
  'midjourney.com': 'Midjourney',
  'runwayml.com': 'Runway',
  'elevenlabs.io': 'ElevenLabs',
  'lmsys.org': 'LMSys',
  'together.ai': 'Together AI',
  'groq.com': 'Groq',
  'mistral.ai': 'Mistral',
  'cohere.com': 'Cohere',
  'stability.ai': 'Stability AI',
  'deepmind.google': 'DeepMind',
  'colab.research.google.com': 'Google Colab',
  'kaggle.com': 'Kaggle',
  'wandb.ai': 'Weights & Biases',
  'modal.com': 'Modal',
  'fireworks.ai': 'Fireworks AI',
  'anyscale.com': 'Anyscale',
  'cursor.sh': 'Cursor',
  'cursor.com': 'Cursor',
  'v0.dev': 'v0',
  'bolt.new': 'Bolt',
  'lovable.dev': 'Lovable',
  'devin.ai': 'Devin',
  'github.com/features/copilot': 'GitHub Copilot',
  // Design
  'figma.com': 'Figma',
  'framer.com': 'Framer',
  'dribbble.com': 'Dribbble',
  'behance.net': 'Behance',
  'canva.com': 'Canva',
  'spline.design': 'Spline',
  'lottiefiles.com': 'LottieFiles',
  // Productivity
  'notion.so': 'Notion',
  'obsidian.md': 'Obsidian',
  'roamresearch.com': 'Roam Research',
  'logseq.com': 'Logseq',
  'airtable.com': 'Airtable',
  'coda.io': 'Coda',
  'miro.com': 'Miro',
  'loom.com': 'Loom',
  'cal.com': 'Cal.com',
  // Media / Content
  'youtube.com': 'YouTube',
  'youtu.be': 'YouTube',
  'substack.com': 'Substack',
  'medium.com': 'Medium',
  'producthunt.com': 'Product Hunt',
  'app.daily.dev': 'daily.dev',
  'hackernews.com': 'Hacker News',
  'news.ycombinator.com': 'Hacker News',
  'dev.to': 'dev.to',
  'hashnode.com': 'Hashnode',
  'beehiiv.com': 'Beehiiv',
  // Community
  'discord.com': 'Discord',
  'discord.gg': 'Discord',
  'slack.com': 'Slack',
  'reddit.com': 'Reddit',
  'telegram.org': 'Telegram',
  't.me': 'Telegram',
  // Finance / Crypto
  'coinbase.com': 'Coinbase',
  'binance.com': 'Binance',
  'uniswap.org': 'Uniswap',
  'opensea.io': 'OpenSea',
  'dune.com': 'Dune Analytics',
  'etherscan.io': 'Etherscan',
  'solscan.io': 'Solscan',
  'defillama.com': 'DefiLlama',
}

function extractDomain(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

function detectTools(urls: string[]): string[] {
  const tools = new Set<string>()
  for (const url of urls) {
    const domain = extractDomain(url)
    if (!domain) continue
    // exact match
    if (KNOWN_TOOL_DOMAINS[domain]) {
      tools.add(KNOWN_TOOL_DOMAINS[domain])
      continue
    }
    // subdomain match (e.g. xyz.github.io)
    for (const [knownDomain, toolName] of Object.entries(KNOWN_TOOL_DOMAINS)) {
      if (domain.endsWith(knownDomain)) {
        tools.add(toolName)
        break
      }
    }
  }
  return Array.from(tools)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function safeGet(obj: any, ...keys: string[]): any {
  let cur = obj
  for (const k of keys) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = cur[k]
  }
  return cur
}

export function extractEntities(rawJson: string): ExtractedEntities {
  const empty: ExtractedEntities = {
    v: ENTITIES_VERSION,
    hashtags: [],
    urls: [],
    mentions: [],
    tools: [],
    tweetType: 'original',
    hasMedia: false,
    mediaTypes: [],
    links: [],
    quoted: null,
    articlePreview: false,
  }

  if (!rawJson) return empty

  let tweet: unknown
  try {
    tweet = JSON.parse(rawJson)
  } catch {
    return empty
  }

  // Twitter API v2 or v1 format — try multiple paths
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const t = tweet as any

  // Hashtags — Twitter stores these in entities.hashtags[].tag (v2) or entities.hashtags[].text (v1)
  const hashtagObjs: unknown[] =
    safeGet(t, 'entities', 'hashtags') ??
    safeGet(t, 'legacy', 'entities', 'hashtags') ??
    []
  const hashtags = (hashtagObjs as Record<string, unknown>[])
    .map((h) => String(h.tag ?? h.text ?? '').toLowerCase())
    .filter(Boolean)

  // URLs
  const urlObjs: unknown[] =
    safeGet(t, 'entities', 'urls') ??
    safeGet(t, 'legacy', 'entities', 'urls') ??
    []
  const urls = (urlObjs as Record<string, unknown>[])
    .map((u) => String(u.expanded_url ?? u.url ?? ''))
    .filter((u) => u && !u.includes('twitter.com') && !u.includes('t.co/') && !u.includes('x.com/'))

  // Mentions
  const mentionObjs: unknown[] =
    safeGet(t, 'entities', 'user_mentions') ??
    safeGet(t, 'legacy', 'entities', 'user_mentions') ??
    []
  const mentions = (mentionObjs as Record<string, unknown>[])
    .map((m) => String(m.screen_name ?? m.username ?? '').toLowerCase())
    .filter(Boolean)

  // Tweet type
  let tweetType: ExtractedEntities['tweetType'] = 'original'
  const inReplyToId =
    safeGet(t, 'in_reply_to_tweet_id') ??
    safeGet(t, 'legacy', 'in_reply_to_status_id_str')
  const quotedStatusId =
    safeGet(t, 'quoted_tweet_id_str') ??
    safeGet(t, 'legacy', 'quoted_status_id_str') ??
    safeGet(t, 'quoted_status_id_str')
  const selfThread =
    safeGet(t, 'self_thread') ??
    safeGet(t, 'legacy', 'self_thread')

  if (selfThread) tweetType = 'thread'
  else if (inReplyToId) tweetType = 'reply'
  else if (quotedStatusId) tweetType = 'quote'

  // Media presence
  const mediaArr: unknown[] =
    safeGet(t, 'entities', 'media') ??
    safeGet(t, 'legacy', 'entities', 'media') ??
    safeGet(t, 'extended_entities', 'media') ??
    safeGet(t, 'legacy', 'extended_entities', 'media') ??
    []
  const hasMedia = (mediaArr as []).length > 0
  const mediaTypes = [...new Set(
    (mediaArr as Record<string, unknown>[]).map((m) => String(m.type ?? ''))
  )].filter(Boolean)

  const tools = detectTools(urls)

  return {
    v: ENTITIES_VERSION,
    hashtags, urls, mentions, tools, tweetType, hasMedia, mediaTypes,
    links: extractLinks(urlObjs),
    quoted: extractQuoted(t),
    articlePreview: !!safeGet(t, 'article', 'article_results', 'result') &&
      !safeGet(t, 'article', 'article_results', 'result', 'content_state', 'blocks')?.length,
  }
}

function extractLinks(urlObjs: unknown[]): TweetLink[] {
  return (urlObjs as Record<string, unknown>[])
    .filter((u) => typeof u.url === 'string' && typeof u.expanded_url === 'string')
    .map((u) => ({
      url: String(u.url),
      expandedUrl: String(u.expanded_url),
      displayUrl: String(u.display_url ?? u.expanded_url),
    }))
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractQuoted(t: any): QuotedTweet | null {
  let q = safeGet(t, 'quoted_status_result', 'result')
  if (q?.__typename?.startsWith('TweetWithVisibilityResult')) q = q.tweet
  if (!q?.rest_id || !q.legacy) return null
  const user = safeGet(q, 'core', 'user_results', 'result')
  const text: string = safeGet(q, 'note_tweet', 'note_tweet_results', 'result', 'text') ?? q.legacy.full_text ?? ''
  return {
    tweetId: String(q.rest_id),
    authorName: user?.core?.name ?? user?.legacy?.name ?? 'Unknown',
    authorHandle: user?.core?.screen_name ?? user?.legacy?.screen_name ?? 'unknown',
    text,
    links: extractLinks(q.legacy.entities?.urls ?? []),
  }
}

/** The display-only part of a stored `entities` JSON (links, quoted tweet). */
export function displayEntities(entitiesJson: string | null): { links: TweetLink[]; quoted: QuotedTweet | null; articlePreview: boolean } {
  try {
    const e = entitiesJson ? (JSON.parse(entitiesJson) as Partial<ExtractedEntities>) : {}
    return { links: e.links ?? [], quoted: e.quoted ?? null, articlePreview: e.articlePreview ?? false }
  } catch {
    return { links: [], quoted: null, articlePreview: false }
  }
}

/**
 * Backfill entity extraction for bookmarks that don't have entities yet.
 * Returns count of updated bookmarks.
 */
export async function backfillEntities(
  onProgress?: (total: number) => void,
  shouldAbort?: () => boolean,
): Promise<number> {
  const CHUNK = 100
  let total = 0

  while (true) {
    if (shouldAbort?.()) break
    const bookmarks = await prisma.bookmark.findMany({
      where: { OR: [{ entities: null }, { NOT: { entities: { contains: `"v":${ENTITIES_VERSION},` } } }] },
      take: CHUNK,
      select: { id: true, rawJson: true },
    })

    if (bookmarks.length === 0) break

    for (const b of bookmarks) {
      const entities = extractEntities(b.rawJson)
      await prisma.bookmark.update({
        where: { id: b.id },
        data: { entities: JSON.stringify(entities) },
      })
      total++
      onProgress?.(total)
    }

    if (bookmarks.length < CHUNK) break
  }

  return total
}
