export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Single-line structured JSON via console — works identically on Node and workerd (NF-7). */
export function createLogger(minLevel: LogLevel, base: Record<string, unknown> = {}): Logger {
  function write(level: LogLevel, message: string, fields?: Record<string, unknown>): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return;
    const line = JSON.stringify({
      time: new Date().toISOString(),
      level,
      message,
      ...base,
      ...fields,
    });
    if (level === 'debug') console.debug(line);
    else if (level === 'info') console.log(line);
    else if (level === 'warn') console.warn(line);
    else console.error(line);
  }

  return {
    debug: (message, fields) => write('debug', message, fields),
    info: (message, fields) => write('info', message, fields),
    warn: (message, fields) => write('warn', message, fields),
    error: (message, fields) => write('error', message, fields),
  };
}

/** Returns a logger that merges `fields` into every call — used to attach the per-request id. */
export function withFields(logger: Logger, fields: Record<string, unknown>): Logger {
  return {
    debug: (message, f) => logger.debug(message, { ...fields, ...f }),
    info: (message, f) => logger.info(message, { ...fields, ...f }),
    warn: (message, f) => logger.warn(message, { ...fields, ...f }),
    error: (message, f) => logger.error(message, { ...fields, ...f }),
  };
}
