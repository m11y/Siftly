'use client'

import Lightbox from 'yet-another-react-lightbox'
import Zoom from 'yet-another-react-lightbox/plugins/zoom'
import Counter from 'yet-another-react-lightbox/plugins/counter'
import 'yet-another-react-lightbox/styles.css'
import 'yet-another-react-lightbox/plugins/counter.css'

/** Photos of one tweet opened in place: swipe / arrows / keys to page, scroll or pinch to zoom, backdrop click or Esc to close. */
export interface LightboxState {
  srcs: string[]
  index: number
}

export default function MediaLightbox({ state, onClose }: { state: LightboxState | null; onClose: () => void }) {
  const single = (state?.srcs.length ?? 0) <= 1
  return (
    <Lightbox
      open={state !== null}
      close={onClose}
      index={state?.index ?? 0}
      slides={(state?.srcs ?? []).map((src) => ({ src }))}
      plugins={[Zoom, Counter]}
      controller={{ closeOnBackdropClick: true }}
      carousel={{ finite: single }}
      render={single ? { buttonPrev: () => null, buttonNext: () => null } : undefined}
      counter={{ container: { style: { top: 'unset', bottom: 0 } } }}
    />
  )
}
