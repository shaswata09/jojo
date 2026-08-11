import { useEffect, useRef, useState } from 'react'
import type { DragEvent } from 'react'

/**
 * True only while something from the file system is being dragged over.
 *
 * Checked on every handler: a card dragged off the applications board also
 * fires dragover here, and a drop zone that lit up for it would be advertising
 * something it cannot accept.
 */
function draggingFiles(event: DragEvent) {
  return event.dataTransfer.types.includes('Files')
}

/**
 * The drop target's own state: whether to light up, and what to do on release.
 *
 * Its own hook because the flicker fix below is not obvious and belongs next to
 * the thing it protects — a bare boolean toggled by dragenter/dragleave blinks
 * on every child the pointer crosses.
 */
export function useFileDrop(onFiles: (list: FileList) => void) {
  const [dragging, setDragging] = useState(false)
  /** dragenter/dragleave fire per element, so a bare boolean flickers on every
   *  child the pointer crosses. Counting them is what makes the state hold. */
  const dragDepth = useRef(0)

  useEffect(() => {
    // A file dropped anywhere else in the window makes the browser navigate to
    // it, which throws away a session that only exists in memory. Swallowed for
    // as long as this tool is mounted; the panel below handles its own drop
    // first, on the way up.
    const swallow = (event: globalThis.DragEvent) => event.preventDefault()
    window.addEventListener('dragover', swallow)
    window.addEventListener('drop', swallow)
    return () => {
      window.removeEventListener('dragover', swallow)
      window.removeEventListener('drop', swallow)
    }
  }, [])

  const onDragOver = (event: DragEvent) => {
    if (!draggingFiles(event)) return
    // Without this the browser refuses the drop and opens the file instead.
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }

  const onDragEnter = (event: DragEvent) => {
    if (!draggingFiles(event)) return
    dragDepth.current += 1
    setDragging(true)
  }

  const onDragLeave = () => {
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDragging(false)
  }

  const onDrop = (event: DragEvent) => {
    if (!draggingFiles(event)) return
    event.preventDefault()
    dragDepth.current = 0
    setDragging(false)
    onFiles(event.dataTransfer.files)
  }

  return { dragging, onDragEnter, onDragOver, onDragLeave, onDrop }
}
