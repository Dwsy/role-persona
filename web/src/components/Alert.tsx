import { AlertCircle, CheckCircle, Info, XCircle } from 'lucide-react'

interface AlertProps {
  type: 'success' | 'error' | 'warning' | 'info'
  title?: string
  message: string
  onClose?: () => void
}

const typeConfig = {
  success: {
    icon: CheckCircle,
    bg: 'bg-green-50 dark:bg-green-900/30',
    border: 'border-green-200 dark:border-green-800',
    text: 'text-green-800 dark:text-green-200',
    iconColor: 'text-green-500',
  },
  error: {
    icon: XCircle,
    bg: 'bg-red-50 dark:bg-red-900/30',
    border: 'border-red-200 dark:border-red-800',
    text: 'text-red-800 dark:text-red-200',
    iconColor: 'text-red-500',
  },
  warning: {
    icon: AlertCircle,
    bg: 'bg-yellow-50 dark:bg-yellow-900/30',
    border: 'border-yellow-200 dark:border-yellow-800',
    text: 'text-yellow-800 dark:text-yellow-200',
    iconColor: 'text-yellow-500',
  },
  info: {
    icon: Info,
    bg: 'bg-blue-50 dark:bg-blue-900/30',
    border: 'border-blue-200 dark:border-blue-800',
    text: 'text-blue-800 dark:text-blue-200',
    iconColor: 'text-blue-500',
  },
}

export default function Alert({ type, title, message, onClose }: AlertProps) {
  const config = typeConfig[type]
  const Icon = config.icon

  return (
    <div className={`flex items-start gap-3 p-4 rounded-xl border ${config.bg} ${config.border}`}>
      <Icon size={20} className={`flex-shrink-0 mt-0.5 ${config.iconColor}`} />
      <div className="flex-1">
        {title && (
          <h4 className={`text-sm font-medium ${config.text} mb-1`}>{title}</h4>
        )}
        <p className={`text-sm ${config.text}`}>{message}</p>
      </div>
      {onClose && (
        <button
          onClick={onClose}
          className={`p-1 rounded hover:bg-black/10 dark:hover:bg-white/10 ${config.text}`}
        >
          <XCircle size={16} />
        </button>
      )}
    </div>
  )
}
