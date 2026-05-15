import { ReactNode } from 'react'

interface CardProps {
  title?: string
  children: ReactNode
  className?: string
  action?: ReactNode
}

export default function Card({ title, children, className = '', action }: CardProps) {
  return (
    <div className={`bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 ${className}`}>
      {(title || action) && (
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          {title && (
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
              {title}
            </h3>
          )}
          {action}
        </div>
      )}
      <div className="p-6">{children}</div>
    </div>
  )
}
