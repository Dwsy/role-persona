import { LucideIcon } from 'lucide-react'

interface StatCardProps {
  title: string
  value: string | number
  icon: LucideIcon
  description?: string
  trend?: {
    value: number
    isPositive: boolean
  }
  color?: 'blue' | 'green' | 'purple' | 'orange' | 'red'
}

const colorClasses = {
  blue: 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400',
  green: 'bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400',
  purple: 'bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400',
  orange: 'bg-orange-50 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400',
  red: 'bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400',
}

export default function StatCard({
  title,
  value,
  icon: Icon,
  description,
  trend,
  color = 'blue',
}: StatCardProps) {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <p className="text-sm font-medium text-gray-600 dark:text-gray-400">{title}</p>
          <p className="mt-2 text-3xl font-bold text-gray-900 dark:text-white">{value}</p>
          {description && (
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{description}</p>
          )}
          {trend && (
            <div className="mt-2 flex items-center gap-1">
              <span
                className={`text-sm font-medium ${
                  trend.isPositive ? 'text-green-600' : 'text-red-600'
                }`}
              >
                {trend.isPositive ? '+' : ''}{trend.value}%
              </span>
              <span className="text-xs text-gray-500 dark:text-gray-400">vs last week</span>
            </div>
          )}
        </div>
        <div className={`p-3 rounded-xl ${colorClasses[color]}`}>
          <Icon size={24} />
        </div>
      </div>
    </div>
  )
}
