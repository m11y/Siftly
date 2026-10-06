import { NextRequest, NextResponse } from 'next/server'
import { deleteBookmark, setNote } from '@/lib/bookmark-store'

// DELETE: remove one bookmark with its media files. Idempotent — deleting a
// bookmark that is already gone succeeds with deleted: false.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params
  try {
    const deleted = await deleteBookmark(id)
    return NextResponse.json({ deleted })
  } catch (err) {
    console.error('Delete bookmark error:', err)
    return NextResponse.json(
      { error: `Failed to delete bookmark: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    )
  }
}

// PATCH { note }: set or (blank) clear the user's note.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params
  let body: { note?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (typeof body.note !== 'string') {
    return NextResponse.json({ error: 'note must be a string' }, { status: 400 })
  }
  try {
    const note = await setNote(id, body.note)
    if (note === undefined) return NextResponse.json({ error: 'Bookmark not found' }, { status: 404 })
    return NextResponse.json({ note })
  } catch (err) {
    console.error('Set note error:', err)
    return NextResponse.json(
      { error: `Failed to save note: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    )
  }
}
