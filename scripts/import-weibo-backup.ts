/**
 * Import posts from weibo_backup (the old Django app in ~/workspace/toolkit).
 *
 *   npx tsx --env-file=.env scripts/import-weibo-backup.ts \
 *     --db <toolkit.sqlite3> --media <toolkit MEDIA_ROOT> --ids <id,id,…> [--replace]
 *
 * weibo_backup kept parsed fields, not Weibo's JSON, so each post is rebuilt in
 * the shape of Weibo's API (lib/weibo.ts) and saved like any other import; a
 * repost's original comes along as a "quote" row. Its photos, video and author
 * avatar are copied into MEDIA_DIR/<post id>/ under the names Siftly derives
 * from their URLs. weibo_backup's database and files are only read.
 *
 * Media URLs are rebuilt from the saved file names: photos as
 * wx1.sinaimg.cn/large/<name> (still served by Weibo), the video and avatar on
 * hosts of the same kind. They identify the local copies; only a missing copy
 * would be fetched from them.
 *
 * --replace deletes already imported posts (with their AI results and notes)
 * and imports them again; without it they are skipped.
 */
import Database from 'better-sqlite3'
import { copyFile, mkdir } from 'fs/promises'
import path from 'path'
import prisma from '@/lib/db'
import { deleteBookmark, saveBookmark } from '@/lib/bookmark-store'
import { fileExists, localPathFor } from '@/lib/media-store'
import { parseWeiboStatus, type WeiboStatus } from '@/lib/weibo'

interface WeiboRow {
  id: number
  user_id: number | null
  content: string
  is_long_text: number
  source: string
  mblogid: string
  region_name: string
  deleted: number
  video0: string | null
  retweeted_status_id: number | null
  created_at: string
  favorited_at: string | null
  saved_at: string
}

interface UserRow {
  id: number
  name: string
  location: string
  description: string
  url: string
  created_at: string
  avatar: string | null
}

interface PicRow {
  pic_id: string
  pic_data: string
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

/** Django stores UTC without a zone (USE_TZ = True). */
function utc(value: string | null): Date | null {
  return value ? new Date(`${value.replace(' ', 'T')}Z`) : null
}

const basename = (p: string) => p.split('/').pop() ?? p

class Importer {
  /** Local copy to make for each media URL, per post. */
  private files = new Map<string, Map<string, string>>()

  constructor(private db: Database.Database, private mediaRoot: string) {}

  private file(postId: string, url: string, stored: string) {
    if (!this.files.has(postId)) this.files.set(postId, new Map())
    this.files.get(postId)!.set(url, path.join(this.mediaRoot, stored))
  }

  status(id: number): WeiboStatus | null {
    const w = this.db.prepare('SELECT * FROM weibo_backup_weibo WHERE id = ?').get(id) as WeiboRow | undefined
    if (!w) return null
    const postId = String(w.id)
    const u = w.user_id
      ? (this.db.prepare('SELECT * FROM weibo_backup_user WHERE id = ?').get(w.user_id) as UserRow | undefined)
      : undefined

    // The avatar was saved as "<uid>-<name>"; <name> is its file name on Weibo's CDN.
    const avatarUrl = u?.avatar ? `https://tvax1.sinaimg.cn/large/${basename(u.avatar).replace(`${u.id}-`, '')}` : undefined
    if (u?.avatar && avatarUrl) this.file(postId, avatarUrl, u.avatar)

    // Pic ids increase in the order weibo_backup saved them, which kept the post's order.
    const pics = this.db
      .prepare('SELECT pic_id, pic_data FROM weibo_backup_pic WHERE weibo_id = ? ORDER BY id')
      .all(w.id) as PicRow[]
    const picInfos: NonNullable<WeiboStatus['pic_infos']> = {}
    for (const p of pics) {
      const url = `https://wx1.sinaimg.cn/large/${basename(p.pic_data)}`
      picInfos[p.pic_id] = { largest: { url } }
      this.file(postId, url, p.pic_data)
    }

    // The video was saved as "<post id>-<name>".
    let pageInfo: WeiboStatus['page_info']
    if (w.video0) {
      const url = `https://f.video.weibocdn.com/o0/${basename(w.video0).replace(`${w.id}-`, '')}`
      pageInfo = { object_type: 'video', media_info: { mp4_hd_url: url } }
      this.file(postId, url, w.video0)
    }

    return {
      _from: 'weibo_backup',
      id: w.id,
      idstr: postId,
      mblogid: w.mblogid || undefined,
      created_at: utc(w.created_at)?.toISOString(),
      text_raw: w.content,
      isLongText: !!w.is_long_text,
      source: w.source || undefined,
      region_name: w.region_name || undefined,
      deleted: !!w.deleted,
      user: u
        ? {
            id: u.id,
            screen_name: u.name,
            location: u.location,
            description: u.description,
            url: u.url,
            created_at: utc(u.created_at)?.toISOString(),
            avatar_hd: avatarUrl,
          }
        : null,
      pic_ids: pics.map((p) => p.pic_id),
      pic_infos: picInfos,
      page_info: pageInfo,
      retweeted_status: w.retweeted_status_id ? this.status(w.retweeted_status_id) : null,
    }
  }

  /** Copy the post's media into MEDIA_DIR/<id>/; existing copies are kept. */
  async copyMedia(postId: string): Promise<{ copied: number; missing: string[] }> {
    let copied = 0
    const missing: string[] = []
    for (const [url, src] of this.files.get(postId) ?? []) {
      const dest = localPathFor(postId, url)
      if (!dest || (await fileExists(dest))) continue
      if (!(await fileExists(src))) { missing.push(path.relative(this.mediaRoot, src)); continue }
      await mkdir(path.dirname(dest), { recursive: true })
      await copyFile(src, dest)
      copied++
    }
    return { copied, missing }
  }

  favoritedAt(id: number): Date | null {
    const w = this.db.prepare('SELECT favorited_at, saved_at FROM weibo_backup_weibo WHERE id = ?').get(id) as
      | { favorited_at: string | null; saved_at: string }
      | undefined
    return w ? utc(w.favorited_at) ?? utc(w.saved_at) : null
  }
}

async function main() {
  const dbPath = arg('db')
  const mediaRoot = arg('media')
  const ids = (arg('ids') ?? '').split(',').map((s) => s.trim()).filter((s) => /^\d+$/.test(s))
  const replace = process.argv.includes('--replace')
  if (!dbPath || !mediaRoot || ids.length === 0) {
    console.error('usage: import-weibo-backup.ts --db <toolkit.sqlite3> --media <MEDIA_ROOT> --ids <id,id,…> [--replace]')
    process.exit(2)
  }

  const db = new Database(dbPath, { readonly: true, fileMustExist: true })
  const importer = new Importer(db, mediaRoot)

  for (const id of ids) {
    const status = importer.status(Number(id))
    if (!status) { console.log(`${id}: not in weibo_backup`); continue }
    const parsed = parseWeiboStatus(status)
    const posts = [parsed, ...(parsed.quoted ? [parsed.quoted] : [])]

    if (replace) {
      for (const p of posts) {
        const row = await prisma.bookmark.findUnique({ where: { tweetId: p.tweetId }, select: { id: true } })
        if (row) await deleteBookmark(row.id)
      }
    }

    const result = await saveBookmark(parsed, 'bookmark')
    // importedAt: when it was favorited on Weibo, not when it reached Siftly.
    for (const p of posts) {
      const at = importer.favoritedAt(Number(p.tweetId))
      if (at) await prisma.bookmark.update({ where: { tweetId: p.tweetId }, data: { importedAt: at } })
    }
    const media = await Promise.all(posts.map((p) => importer.copyMedia(p.tweetId)))
    const copied = media.reduce((n, m) => n + m.copied, 0)
    const missing = media.flatMap((m) => m.missing)
    console.log(
      `${id}: ${result}${parsed.quoted ? ` (+ original ${parsed.quoted.tweetId})` : ''}, ` +
      `${parsed.media.length + (parsed.quoted?.media.length ?? 0)} media, ${copied} files copied` +
      (missing.length ? `, MISSING ${missing.join(' ')}` : ''),
    )
  }

  db.close()
  await prisma.$disconnect()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
