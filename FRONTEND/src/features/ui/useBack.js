import { useEffect, useRef } from 'react'

const stack = []

// Called by the Android back button. The newest open layer answers first.
export function runBack() {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i]() !== false) return true
  }
  return false
}

// While `active` is true, back goes to fn. Return false from fn to pass back to the layer below.
export function useBackHandler(fn, active = true) {
  const ref = useRef(fn)
  ref.current = fn
  useEffect(() => {
    if (!active) return undefined
    const h = () => ref.current()
    stack.push(h)
    return () => {
      const i = stack.lastIndexOf(h)
      if (i >= 0) stack.splice(i, 1)
    }
  }, [active])
}