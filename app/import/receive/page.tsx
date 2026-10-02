'use client'

import { useEffect, useState } from 'react'
import { CheckCircle, Loader2, AlertCircle } from 'lucide-react'

// Popup opened by the bookmarklet from x.com. x.com's CSP (connect-src) blocks
// requests to this local server, but not opening a window to it, so the
// bookmarklet hands the captured tweets over via postMessage and this page
// imports them through its own same-origin API.

const X_ORIGINS = new Set(['https://x.com', 'https://twitter.com'])

type State =
  | { kind: 'no-opener' }
  | { kind: 'waiting' }
  | { kind: 'importing'; count: number }
  | { kind: 'done'; imported: number; skipped: number; pipeline: 'started' | 'busy' | 'skipped' }
  | { kind: 'error'; message: string }

export default function ReceivePage() {
  const [state, setState] = useState<State>({ kind: 'waiting' })

  useEffect(() => {
    const opener = window.opener as Window | null
    if (!opener) {
      setState({ kind: 'no-opener' })
      return
    }

    async function onMessage(e: MessageEvent) {
      if (!X_ORIGINS.has(e.origin) || e.source !== opener) return
      const data = e.data as { type?: string; source?: string; tweets?: unknown[] } | null
      if (data?.type !== 'siftly:import' || !Array.isArray(data.tweets)) return
      window.removeEventListener('message', onMessage)

      setState({ kind: 'importing', count: data.tweets.length })
      try {
        const res = await fetch('/api/import/bookmarklet', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source: data.source, tweets: data.tweets }),
        })
        const result = await res.json() as { imported?: number; skipped?: number; error?: string }
        if (!res.ok) throw new Error(result.error ?? `Import failed (${res.status})`)
        const imported = result.imported ?? 0
        const skipped = result.skipped ?? 0
        opener?.postMessage({ type: 'siftly:result', imported, skipped }, e.origin)

        // The import already succeeded and was reported; a pipeline hiccup must not
        // reach the catch below, or the bookmarklet would also download a fallback file.
        let pipeline: 'started' | 'busy' | 'skipped' = 'skipped'
        if (imported > 0) {
          try {
            const cat = await fetch('/api/categorize', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: '{}',
            })
            // 409 = a run is already going; new rows wait for the next run.
            pipeline = cat.ok ? 'started' : 'busy'
          } catch {
            pipeline = 'busy'
          }
        }
        setState({ kind: 'done', imported, skipped, pipeline })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        opener?.postMessage({ type: 'siftly:result', error: message }, e.origin)
        setState({ kind: 'error', message })
      }
    }

    window.addEventListener('message', onMessage)
    // The opener's exact origin is unknown here; postMessage drops non-matching targets.
    for (const origin of X_ORIGINS) opener.postMessage({ type: 'siftly:ready' }, origin)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  return (
    <div className="p-8 max-w-lg mx-auto">
      <h1 className="text-xl font-bold text-zinc-100 mb-6">Import from X</h1>
      {state.kind === 'no-opener' && (
        <p className="text-sm text-zinc-400">
          This page receives tweets from the Siftly bookmarklet. Run the bookmarklet on x.com and click its
          purple Send button.
        </p>
      )}
      {state.kind === 'waiting' && (
        <p className="flex items-center gap-2 text-sm text-zinc-400">
          <Loader2 size={16} className="animate-spin" /> Waiting for tweets from x.com…
        </p>
      )}
      {state.kind === 'importing' && (
        <p className="flex items-center gap-2 text-sm text-zinc-400">
          <Loader2 size={16} className="animate-spin" /> Importing {state.count} tweets…
        </p>
      )}
      {state.kind === 'done' && (
        <div className="space-y-3 text-sm">
          <p className="flex items-center gap-2 text-emerald-400">
            <CheckCircle size={16} /> Imported {state.imported} new, skipped {state.skipped} already saved.
          </p>
          {state.pipeline === 'started' && <p className="text-zinc-400">AI pipeline started.</p>}
          {state.pipeline === 'busy' && (
            <p className="text-zinc-400">
              The AI pipeline did not start (a run may already be in progress). New items are processed on the next run.
            </p>
          )}
          <a href="/categorize" className="inline-block text-indigo-400 hover:underline">View pipeline progress →</a>
        </div>
      )}
      {state.kind === 'error' && (
        <p className="flex items-center gap-2 text-sm text-red-400">
          <AlertCircle size={16} /> {state.message}
        </p>
      )}
    </div>
  )
}
