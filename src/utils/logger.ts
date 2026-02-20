type LogLevel = 'info' | 'warn' | 'error' | 'debug'

interface LogEntry {
  level: LogLevel
  msg: string
  error?: unknown
  meta?: Record<string, unknown>
}

export function log(entry: LogEntry): void {
  const ts = new Date().toISOString()
  const prefix = `[${ts}] [${entry.level.toUpperCase()}]`
  const message = `${prefix} ${entry.msg}`

  switch (entry.level) {
    case 'error':
      console.error(message, entry.error ?? '')
      break
    case 'warn':
      console.warn(message)
      break
    case 'debug':
      if (process.env.DEBUG === 'true') {
        console.log(message, entry.meta ?? '')
      }
      break
    default:
      console.log(message)
      break
  }
}
