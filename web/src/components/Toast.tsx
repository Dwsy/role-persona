import { useState, useEffect, createContext, useContext, ReactNode, useCallback } from 'react'
import { X, CheckCircle, AlertCircle, Info } from 'lucide-react'

type ToastType = 'success' | 'error' | 'info'

interface Toast {
  id: string
  type: ToastType
  message: string
}

interface ToastContextValue {
  showToast: (type: ToastType, message: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast() {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error('useToast must be used within ToastProvider')
  }
  return context
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const showToast = useCallback((type: ToastType, message: string) => {
    const id = Math.random().toString(36).slice(2)
    setToasts(prev => [...prev, { id, type, message }])
  }, [])

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
        {toasts.map(toast => (
          <ToastItem key={toast.id} toast={toast} onRemove={removeToast} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

function ToastItem({
  toast,
  onRemove,
}: {
  toast: Toast
  onRemove: (id: string) => void
}) {
  useEffect(() => {
    const timer = setTimeout(() => onRemove(toast.id), 5000)
    return () => clearTimeout(timer)
  }, [toast.id, onRemove])

  const icons = {
    success: <CheckCircle size={20} className="text-green-500" />,
    error: <AlertCircle size={20} className="text-red-500" />,
    info: <Info size={20} className="text-blue-500" />,
  }

  const bgClasses = {
    success: 'bg-green-50 dark:bg-green-900/30 border-green-200 dark:border-green-800',
    error: 'bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-800',
    info: 'bg-blue-50 dark:bg-blue-900/30 border-blue-200 dark:border-blue-800',
  }

  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 rounded-xl border shadow-lg min-w-[300px] animate-slide-in ${bgClasses[toast.type]}`}
    >
      {icons[toast.type]}
      <p className="flex-1 text-sm text-gray-900 dark:text-white">{toast.message}</p>
      <button
        onClick={() => onRemove(toast.id)}
        className="p-1 rounded hover:bg-black/10 dark:hover:bg-white/10"
      >
        <X size={16} className="text-gray-500" />
      </button>
    </div>
  )
}
