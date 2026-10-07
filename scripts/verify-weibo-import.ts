/**
 * Check a weibo_backup import against its source, read-only on both sides.
 *
 *   npx tsx --env-file=.env scripts/verify-weibo-import.ts --db <toolkit.sqlite3> --media <toolkit MEDIA_ROOT>
 *
 * Independent of the importer's code: it reads both SQLite files directly and
 * states what each weibo_backup row should have become. For every row: one
 * Siftly Weibo post with the same text, author, times, repost link, mblogid and
 * source (bookmark / quote); its photos in order and its video (a repost's copy
 * of its original's video belongs to the original); and every media file and
 * avatar on disk under MEDIA_DIR/<id>/ with the source file's size. Also lists
 * Siftly Weibo posts that weibo_backup doesn't have. Exit code 1 on any problem.
 */
import Database from 'better-sqlite3'
import { statSync } from 'fs'
import path from 'path'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const basename = (p: string) => p.split('?')[0].split('/').pop() ?? p
const utc = (v: string | null) => (v ? new Date(`${v.replace(' ', 'T')}Z`).getTime() : null)
const size = (p: string) => { try { return statSync(p).size } catch { return null } }

const problems = new Map<string, string[]>()
function problem(kind: string, detail: string) {
  if (!problems.has(kind)) problems.set(kind, [])
  problems.get(kind)!.push(detail)
}

function main() {
  const dbPath = arg('db')
  const mediaRoot = arg('media')
  const siftlyUrl = process.env.DATABASE_URL
  const mediaDir = process.env.MEDIA_DIR
  if (!dbPath || !mediaRoot || !siftlyUrl?.startsWith('file:') || !mediaDir) {
    console.error('usage: verify-weibo-import.ts --db <toolkit.sqlite3> --media <MEDIA_ROOT>  (DATABASE_URL and MEDIA_DIR from .env)')
    process.exit(2)
  }
  const src = new Database(dbPath, { readonly: true, fileMustExist: true })
  const dst = new Database(siftlyUrl.slice('file:'.length), { readonly: true, fileMustExist: true })

  type W = { id: number; user_id: number | null; content: string; mblogid: string; video0: string | null; retweeted_status_id: number | null; created_at: string; favorited_at: string | null; saved_at: string }
  const rows = src.prepare('SELECT * FROM weibo_backup_weibo ORDER BY id').all() as W[]
  const byId = new Map(rows.map((w) => [w.id, w]))
  const users = new Map((src.prepare('SELECT id, name, avatar FROM weibo_backup_user').all() as { id: number; name: string; avatar: string | null }[]).map((u) => [u.id, u]))
  const picsOf = src.prepare('SELECT pic_data FROM weibo_backup_pic WHERE weibo_id = ? ORDER BY id')
  const onlyOriginal = new Set((src.prepare(`
    SELECT w.id FROM weibo_backup_weibo w
    WHERE EXISTS (SELECT 1 FROM weibo_backup_weibo p WHERE p.retweeted_status_id = w.id AND p.favorited_at IS w.favorited_at)
  `).all() as { id: number }[]).map((r) => r.id))

  const post = dst.prepare('SELECT id, platform, source, text, authorHandle, authorName, tweetCreatedAt, importedAt, quotedTweetId, entities FROM Bookmark WHERE tweetId = ?')
  const mediaOf = dst.prepare('SELECT type, url FROM MediaItem WHERE bookmarkId = ? ORDER BY rowid')
  // Same rule as the importer: the CDN name, ".mp4" added when missing.
  const videoName = (w: W | undefined) => {
    if (!w?.video0) return null
    const name = basename(w.video0).replace(`${w.id}-`, '')
    return /\.(mp4|m3u8)$/.test(name) ? name : `${name.replace(/\.[^.]*$/, '')}.mp4`
  }
  // Prisma stores DateTime in SQLite as epoch milliseconds.
  const ms = (v: unknown) => (v === null || v === undefined ? null : typeof v === 'number' ? v : new Date(String(v)).getTime())

  let files = 0
  let bytes = 0
  for (const w of rows) {
    const id = String(w.id)
    const p = post.get(id) as Record<string, unknown> | undefined
    if (!p) { problem('post missing', id); continue }
    const user = w.user_id ? users.get(w.user_id) : undefined

    if (p.platform !== 'weibo') problem('platform', id)
    if (p.source !== (onlyOriginal.has(w.id) ? 'quote' : 'bookmark')) problem('source', `${id} is ${p.source}`)
    if (p.text !== w.content) problem('text', id)
    if (p.authorHandle !== (user ? String(user.id) : 'unknown')) problem('author uid', id)
    if (p.authorName !== (user?.name ?? '')) problem('author name', id)
    if (ms(p.tweetCreatedAt) !== utc(w.created_at)) problem('created at', id)
    if (ms(p.importedAt) !== (utc(w.favorited_at) ?? utc(w.saved_at))) problem('favorited at', id)
    if ((p.quotedTweetId ?? null) !== (w.retweeted_status_id ? String(w.retweeted_status_id) : null)) problem('repost link', id)
    let mblogid: unknown = null
    try { mblogid = JSON.parse(String(p.entities)).weibo?.mblogid ?? null } catch { /* reported below */ }
    if (mblogid !== (w.mblogid || null)) problem('mblogid', id)

    // Media rows: photos in post order, then the video unless it is the original's.
    const pics = (picsOf.all(w.id) as { pic_data: string }[]).map((r) => r.pic_data)
    const video = videoName(w)
    let ownVideo = video && video !== videoName(w.retweeted_status_id ? byId.get(w.retweeted_status_id) : undefined) ? video : null
    if (ownVideo?.endsWith('.m3u8')) {
      // A live stream's playlist: weibo_backup never saved the video itself.
      problem('nothing to migrate: live-stream playlist only', id)
      ownVideo = null
    }
    const expected = [...pics.map((f) => `photo:${basename(f)}`), ...(ownVideo ? [`video:${ownVideo}`] : [])]
    const actual = (mediaOf.all(p.id) as { type: string; url: string }[]).map((m) => `${m.type}:${basename(m.url)}`)
    if (expected.join('|') !== actual.join('|')) problem('media rows', `${id} expected [${expected.length}] got [${actual.length}]`)

    // Files on disk, same size as the source.
    const wantFiles: [string, string][] = pics.map((f) => [basename(f), f])
    if (ownVideo) wantFiles.push([ownVideo, w.video0!])
    if (user?.avatar) wantFiles.push([basename(user.avatar).replace(`${user.id}-`, ''), user.avatar])
    for (const [name, rel] of wantFiles) {
      const want = size(path.join(mediaRoot, rel))
      if (want === null) { problem('source file missing (nothing to copy)', `${id} ${rel}`); continue }
      const got = size(path.join(mediaDir, id, name))
      if (got === null) problem('file missing', `${id}/${name}`)
      else if (got !== want) problem('file size differs', `${id}/${name} ${got} != ${want}`)
      else { files++; bytes += got }
    }
  }

  const extra = (dst.prepare("SELECT tweetId FROM Bookmark WHERE platform = 'weibo'").all() as { tweetId: string }[])
    .filter((r) => !byId.has(Number(r.tweetId)))
  for (const r of extra) problem('not in weibo_backup', r.tweetId)

  console.log(`weibo_backup posts: ${rows.length} (${rows.length - onlyOriginal.size} favorited, ${onlyOriginal.size} only as a repost's original)`)
  console.log(`files verified: ${files} (${(bytes / 1e9).toFixed(2)} GB)`)
  if (problems.size === 0) {
    console.log('OK — no problems')
  } else {
    for (const [kind, list] of problems) console.log(`${kind}: ${list.length}  e.g. ${list.slice(0, 5).join(', ')}`)
  }
  src.close()
  dst.close()
  const onlySourceGaps = [...problems.keys()].every((k) => k.startsWith('source file missing') || k.startsWith('nothing to migrate'))
  process.exit(problems.size === 0 || onlySourceGaps ? 0 : 1)
}

main()
