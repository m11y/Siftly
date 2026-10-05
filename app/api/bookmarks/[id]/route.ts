import { NextRequest, NextResponse } from 'next/server'
import { deleteBookmark } from '@/lib/bookmark-store'

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
