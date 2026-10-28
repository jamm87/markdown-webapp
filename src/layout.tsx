import { useCallback, useState, type KeyboardEvent, type PointerEvent } from 'react'

/** Number state persisted in localStorage (per browser, best effort). */
export function useStoredNumber(key: string, initial: number) {
  const [value, setValue] = useState(() => {
    try {
      const stored = Number(localStorage.getItem(key))
      return stored ? stored : initial
    } catch {
      return initial
    }
  })
  const set = useCallback(
    (next: number) => {
      setValue(next)
      try {
        localStorage.setItem(key, String(next))
      } catch {
        // Storage unavailable: keep it in memory only.
      }
    },
    [key],
  )
  return [value, set] as const
}

export const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))

/**
 * Vertical drag handle. Reports the pointer's clientX while dragging and
 * a ±step for arrow keys; double-click calls `onReset`.
 */
export function Resizer({
  onDrag,
  onStep,
  onReset,
  label,
}: {
  onDrag: (clientX: number) => void
  onStep: (direction: -1 | 1) => void
  onReset: () => void
  label: string
}) {
  const [dragging, setDragging] = useState(false)

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragging(true)
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (dragging) onDrag(e.clientX)
  }
  const stop = () => setDragging(false)
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft') onStep(-1)
    else if (e.key === 'ArrowRight') onStep(1)
    else return
    e.preventDefault()
  }

  return (
    <div
      className={`resizer${dragging ? ' dragging' : ''}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      title={`${label} (doble clic para restablecer)`}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stop}
      onPointerCancel={stop}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
    />
  )
}
