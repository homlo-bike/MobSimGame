/**
 * Centralised browser logger. The only module allowed to call `console` (ESLint `no-console`).
 *
 * Minimum level comes from `VITE_LOG_LEVEL`, read once at start-up (build-time
 * variable, public like every `VITE_*` value). Levels, most granular first:
 * `debug` < `info` (alias `log`) < `warn` (alias `warning`) < `error`; `silent`
 * disables output. Default: `debug` in development, `info` in production builds.
 *
 * Production builds never emit debug: a configured `debug` is raised to `info`, and
 * `debug()` is a no-op (pass a function to defer building expensive context).
 * Values under sensitive keys (token, secret, password, authorization, cookie,
 * api key, credential) are redacted.
 *
 * Output: readable `HH:MM:SS.mmm LEVEL [scope] message` with the context object in
 * development; one JSON string per entry in production.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';
export type LogContext = Record<string, unknown>;
type ContextArg = LogContext | (() => LogContext) | undefined;

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

const ALIASES: Record<string, LogLevel> = {
  debug: 'debug',
  info: 'info',
  log: 'info',
  warn: 'warn',
  warning: 'warn',
  error: 'error',
  silent: 'silent',
  none: 'silent',
};

export const SENSITIVE_KEY = /(token|secret|passw(or)?d|authori[sz]ation|cookie|api[_-]?key|credential)/i;
const BEARER = /(bearer\s+)[A-Za-z0-9._~+/=-]+/gi;
export const REDACTED = '[REDACTED]';

export function parseLevel(value: unknown): LogLevel | null {
  if (typeof value !== 'string') return null;
  return ALIASES[value.trim().toLowerCase()] ?? null;
}

export interface LoggerConfig {
  level: LogLevel;
  format: 'pretty' | 'json';
  production: boolean;
}

/** Resolve the configuration from the environment. Exported for tests. */
export function resolveConfig(
  raw: unknown,
  production: boolean,
): LoggerConfig & { suppressedDebug: boolean } {
  const requested = parseLevel(raw) ?? (production ? 'info' : 'debug');
  const suppressedDebug = production && requested === 'debug';
  return {
    level: suppressedDebug ? 'info' : requested,
    format: production ? 'json' : 'pretty',
    production,
    suppressedDebug,
  };
}

export function redact(value: unknown, key?: string, depth = 0): unknown {
  if (key !== undefined && SENSITIVE_KEY.test(key)) return REDACTED;
  if (typeof value === 'string') return value.replace(BEARER, `$1${REDACTED}`);
  if (depth > 5 || value === null || typeof value !== 'object') return value;
  if (value instanceof Error) return { name: value.name, message: redact(value.message) };
  if (Array.isArray(value)) return value.map((v) => redact(v, undefined, depth + 1));
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v, k, depth + 1)]));
}

type Sink = Pick<Console, 'debug' | 'info' | 'warn' | 'error'>;

let config: LoggerConfig = resolveConfig(import.meta.env.VITE_LOG_LEVEL, import.meta.env.PROD);
let sink: Sink = console;

/** Replace configuration or output target (tests, or a future remote sink). */
export function configureLogger(next: Partial<LoggerConfig>, nextSink?: Sink) {
  config = { ...config, ...next };
  if (config.production && config.level === 'debug') config = { ...config, level: 'info' };
  if (nextSink) sink = nextSink;
}

export function currentLogLevel(): LogLevel {
  return config.level;
}

function emit(level: Exclude<LogLevel, 'silent'>, scope: string, message: string, ctx: ContextArg) {
  if (ORDER[level] < ORDER[config.level]) return;
  const context = (typeof ctx === 'function' ? ctx() : ctx) ?? {};
  const safe = redact(context) as LogContext;
  const msg = redact(message) as string;
  const ts = new Date().toISOString();
  if (config.format === 'json') {
    sink[level](JSON.stringify({ ts, level, scope, msg, ...safe }));
  } else {
    const prefix = `${ts.slice(11, 23)} ${level.toUpperCase().padEnd(5)} [${scope}] ${msg}`;
    if (Object.keys(safe).length) sink[level](prefix, safe);
    else sink[level](prefix);
  }
}

export interface Logger {
  debug(message: string, ctx?: ContextArg): void;
  info(message: string, ctx?: ContextArg): void;
  /** Alias of `info`. */
  log(message: string, ctx?: ContextArg): void;
  warn(message: string, ctx?: ContextArg): void;
  /** Alias of `warn`. */
  warning(message: string, ctx?: ContextArg): void;
  error(message: string, ctx?: ContextArg): void;
}

const noop = () => {};

export function createLogger(scope: string): Logger {
  const info = (m: string, c?: ContextArg) => emit('info', scope, m, c);
  const warn = (m: string, c?: ContextArg) => emit('warn', scope, m, c);
  return {
    // In production bundles debug is a no-op, so context factories are never called.
    debug: import.meta.env.PROD ? noop : (m, c) => emit('debug', scope, m, c),
    info,
    log: info,
    warn,
    warning: warn,
    error: (m, c) => emit('error', scope, m, c),
  };
}

/** Error details safe to log (no stack in production). */
export function errorContext(e: unknown): LogContext {
  if (e instanceof Error)
    return { error: e.name, message: e.message, ...(config.production ? {} : { stack: e.stack }) };
  return { error: String(e) };
}

const startup = resolveConfig(import.meta.env.VITE_LOG_LEVEL, import.meta.env.PROD);
if (startup.suppressedDebug) {
  createLogger('logger').warn('debug logging is disabled in production builds; using info');
}
