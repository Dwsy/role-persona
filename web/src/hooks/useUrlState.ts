import { useState, useCallback } from 'react'

export function useUrlState(key: string, defaultValue: string): [string, (v: string) => void] {
  const [state, setState] = useState(() => {
    const params = new URLSearchParams(window.location.search)
    return params.get(key) || defaultValue
  })

  const setValue = useCallback((value: string) => {
    setState(value)
    const params = new URLSearchParams(window.location.search)
    if (value === defaultValue) params.delete(key)
    else params.set(key, value)
    const qs = params.toString()
    const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname
    history.replaceState(null, '', url)
  }, [key, defaultValue])

  return [state, setValue]
}
