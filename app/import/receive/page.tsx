'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'

// Relay window opened by the bookmarklet from x.com. x.com's CSP (connect-src,
// frame-src, form-action) blocks every direct route to this local server, but
// not opening a window to it, so the bookmarklet streams captured tweets here in
// batches via postMessage and this page imports them through its own API.
// It stays open in the background for the whole session; the user never needs
// to look at it — the live status is the panel the bookmarklet shows on x.com.

const X_ORIGINS = new Set(['https://x.com', 'https://twitter.com'])
const PIPELINE_POLL_MS = 10_000

interface Totals { batches: number; imported: number; updated: number; skipped: number }
type Pipeline = 'idle' | 'running' | 'queued'

export default function ReceivePage() {
  const [hasOpener, setHasOpener] = useState(true)
  const [totals, setTotals] = useState<Totals>({ batches: 0, imported: 0, updated: 0, skipped: 0 })
  const [busy, setBusy] = useState(false)
  const [pipeline, setPipeline] = useState<Pipeline>('idle')
  const [error, setError] = useState('')
  // New rows only join a pipeline run that starts after they are saved, so a
  // batch that lands while a run is going re-triggers once that run finishes.
  const runPending = useRef(false)

  useEffect(() => {
    const opener = window.opener as Window | null
    if (!opener) {
      setHasOpener(false)
      return
    }

    async function startPipeline() {
      try {
        const res = await fetch('/api/categorize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
        // 409 = a run is already going; start another when it ends.
        runPending.current = !res.ok
        setPipeline(res.ok ? 'running' : 'queued')
      } catch {
        runPending.current = true
        setPipeline('queued')
      }
    }

    const poll = setInterval(async () => {
      try {
        const res = await fetch('/api/categorize')
        const { status } = (await res.json()) as { status: string }
        if (status === 'idle') {
          if (runPending.current) await startPipeline()
          else setPipeline('idle')
        }
      } catch { /* Siftly restarting; try again next tick */ }
    }, PIPELINE_POLL_MS)

    async function onMessage(e: MessageEvent) {
      if (!X_ORIGINS.has(e.origin) || e.source !== opener) return
      const data = e.data as { type?: string; batchId?: number; lookupId?: number; source?: string; tweets?: unknown[]; tweetIds?: unknown[] } | null
      if (data?.type === 'siftly:bye') { window.close(); return }
      if (data?.type === 'siftly:lookup' && Array.isArray(data.tweetIds)) {
        // Which tweets visible on X are saved (for the ✓ marks). A failed lookup
        // is simply retried by the bookmarklet later.
        try {
          const res = await fetch('/api/bookmarks/exists', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tweetIds: data.tweetIds }),
          })
          const { existing } = (await res.json()) as { existing?: string[] }
          opener?.postMessage({ type: 'siftly:lookupResult', lookupId: data.lookupId, existing: existing ?? [] }, e.origin)
        } catch {
          opener?.postMessage({ type: 'siftly:lookupResult', lookupId: data.lookupId, error: true }, e.origin)
        }
        return
      }
      if (data?.type !== 'siftly:import' || !Array.isArray(data.tweets)) return

      setBusy(true)
      try {
        const res = await fetch('/api/import/bookmarklet', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source: data.source, tweets: data.tweets }),
        })
        const result = (await res.json()) as { imported?: number; updated?: number; skipped?: number; error?: string }
        if (!res.ok) throw new Error(result.error ?? `Import failed (${res.status})`)
        const imported = result.imported ?? 0
        const updated = result.updated ?? 0
        const skipped = result.skipped ?? 0
        opener?.postMessage({ type: 'siftly:result', batchId: data.batchId, imported, updated, skipped }, e.origin)
        setTotals((t) => ({ batches: t.batches + 1, imported: t.imported + imported, updated: t.updated + updated, skipped: t.skipped + skipped }))
        setError('')
        if (imported > 0 || updated > 0) await startPipeline()
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        opener?.postMessage({ type: 'siftly:result', batchId: data.batchId, error: message }, e.origin)
        setError(message)
      } finally {
        setBusy(false)
      }
    }

    window.addEventListener('message', onMessage)
    // The opener's exact origin is unknown here; postMessage drops non-matching targets.
    for (const origin of X_ORIGINS) opener.postMessage({ type: 'siftly:ready' }, origin)
    return () => {
      window.removeEventListener('message', onMessage)
      clearInterval(poll)
    }
  }, [])

  if (!hasOpener) {
    return (
      <div className="p-6 text-sm text-zinc-400">
        This window relays tweets from the Siftly bookmarklet. Run the bookmarklet on your X likes or bookmarks page.
      </div>
    )
  }

  return (
    <div className="p-5 space-y-2 text-sm">
      <p className="font-semibold text-zinc-100 flex items-center gap-2">
        Siftly 中转窗口 {busy && <Loader2 size={14} className="animate-spin text-indigo-400" />}
      </p>
      <p className="text-xs text-zinc-500">保持打开，放到后台即可；状态看 x.com 右上角的面板。</p>
      <p className="text-zinc-300">
        {totals.batches} 批 · 新增 {totals.imported} · 刷新 {totals.updated} · 已有 {totals.skipped}
      </p>
      <p className="text-xs text-zinc-500">
        AI 处理：{pipeline === 'running' ? '进行中' : pipeline === 'queued' ? '排队，当前一轮结束后开始' : '空闲'}
      </p>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  )
}
