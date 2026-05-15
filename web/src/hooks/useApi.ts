import { useState, useEffect, useCallback } from 'react'
import { ApiResponse } from '@/api/client'

interface UseApiState<T> {
  data: T | null
  loading: boolean
  error: string | null
}

export function useApi<T>(
  apiCall: () => Promise<ApiResponse<T>>,
  immediate: boolean = true,
) {
  const [state, setState] = useState<UseApiState<T>>({
    data: null,
    loading: immediate,
    error: null,
  })

  const execute = useCallback(async () => {
    setState(prev => ({ ...prev, loading: true, error: null }))
    try {
      const response = await apiCall()
      if (response.ok) {
        setState({ data: response.data || null, loading: false, error: null })
      } else {
        const errMsg = typeof response.error === 'object' ? response.error.message : response.error || 'Unknown error'
        setState({ data: null, loading: false, error: errMsg })
      }
    } catch (error) {
      setState({ data: null, loading: false, error: error instanceof Error ? error.message : 'Unknown error' })
    }
  }, [apiCall])

  useEffect(() => {
    if (immediate) execute()
  }, [immediate, execute])

  return { ...state, execute, refetch: execute }
}

export function useApiMutation<T, P>(apiCall: (params: P) => Promise<ApiResponse<T>>) {
  const [state, setState] = useState<UseApiState<T>>({ data: null, loading: false, error: null })

  const mutate = useCallback(async (params: P): Promise<ApiResponse<T>> => {
    setState(prev => ({ ...prev, loading: true, error: null }))
    try {
      const response = await apiCall(params)
      const errMsg = response.ok ? null : (typeof response.error === 'object' ? response.error.message : response.error || 'Unknown error')
      setState({ data: response.ok ? response.data || null : null, loading: false, error: errMsg })
      return response
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      setState({ data: null, loading: false, error: errorMsg })
      return { ok: false, error: errorMsg }
    }
  }, [apiCall])

  return { ...state, mutate }
}
