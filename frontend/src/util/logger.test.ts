import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  configureLogger,
  createLogger,
  currentLogLevel,
  errorContext,
  parseLevel,
  redact,
  REDACTED,
  resolveConfig,
  type LogLevel,
} from './logger';

function capture() {
  const sink = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return sink;
}

afterEach(() => configureLogger({ level: 'debug', format: 'pretty', production: false }, console));

describe('level parsing', () => {
  it.each([
    ['debug', 'debug'],
    ['INFO', 'info'],
    ['log', 'info'],
    ['warning', 'warn'],
    ['warn', 'warn'],
    [' error ', 'error'],
    ['silent', 'silent'],
    ['verbose', null],
    [undefined, null],
  ])('%s → %s', (raw, expected) => {
    expect(parseLevel(raw)).toBe(expected);
  });

  it('defaults to debug in development and info in production', () => {
    expect(resolveConfig(undefined, false).level).toBe('debug');
    expect(resolveConfig(undefined, true).level).toBe('info');
    expect(resolveConfig('nonsense', true).level).toBe('info');
  });

  it('never enables debug in production', () => {
    const c = resolveConfig('debug', true);
    expect(c.level).toBe('info');
    expect(c.suppressedDebug).toBe(true);
    expect(c.format).toBe('json');
    expect(resolveConfig('debug', false).format).toBe('pretty');
  });
});

describe('filtering', () => {
  const cases: [LogLevel, string[]][] = [
    ['debug', ['debug', 'info', 'warn', 'error']],
    ['info', ['info', 'warn', 'error']],
    ['warn', ['warn', 'error']],
    ['error', ['error']],
    ['silent', []],
  ];
  it.each(cases)('minimum level %s', (level, expected) => {
    const sink = capture();
    configureLogger({ level, format: 'pretty', production: false }, sink);
    const log = createLogger('t');
    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('e');
    const called = (['debug', 'info', 'warn', 'error'] as const).filter((k) => sink[k].mock.calls.length);
    expect(called).toEqual(expected);
  });

  it('log and warning are aliases', () => {
    const sink = capture();
    configureLogger({ level: 'debug' }, sink);
    const log = createLogger('t');
    log.log('a');
    log.warning('b');
    expect(sink.info).toHaveBeenCalledTimes(1);
    expect(sink.warn).toHaveBeenCalledTimes(1);
  });

  it('does not build lazy context for filtered entries', () => {
    const sink = capture();
    configureLogger({ level: 'error' }, sink);
    const factory = vi.fn(() => ({ big: 1 }));
    createLogger('t').warn('skipped', factory);
    expect(factory).not.toHaveBeenCalled();
  });
});

describe('formatting and safety', () => {
  it('writes one JSON object per entry in production format', () => {
    const sink = capture();
    configureLogger({ level: 'info', format: 'json', production: true }, sink);
    createLogger('store').info('project loaded', { lines: 3 });
    const entry = JSON.parse(sink.info.mock.calls[0]![0] as string);
    expect(entry).toMatchObject({ level: 'info', scope: 'store', msg: 'project loaded', lines: 3 });
    expect(entry.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('writes a readable line with context in development', () => {
    const sink = capture();
    configureLogger({ level: 'debug', format: 'pretty', production: false }, sink);
    createLogger('map').warn('tile failed', { status: 404 });
    const [line, ctx] = sink.warn.mock.calls[0]!;
    expect(line).toMatch(/^\d{2}:\d{2}:\d{2}\.\d{3} WARN {2}\[map\] tile failed$/);
    expect(ctx).toEqual({ status: 404 });
  });

  it('redacts sensitive keys and bearer tokens', () => {
    expect(redact({ editToken: 'x', headers: { Authorization: 'Bearer abc' }, ok: 1 })).toEqual({
      editToken: REDACTED,
      headers: { Authorization: REDACTED },
      ok: 1,
    });
    const sink = capture();
    configureLogger({ level: 'info', format: 'json', production: true }, sink);
    createLogger('api').error('sent Bearer abc.def', { client_secret: 's3cr3t', id: 'p1' });
    const raw = sink.error.mock.calls[0]![0] as string;
    expect(raw).not.toContain('s3cr3t');
    expect(raw).not.toContain('abc.def');
    expect(JSON.parse(raw).id).toBe('p1');
  });

  it('omits stack traces in production error context', () => {
    configureLogger({ production: true, level: 'info' });
    expect(errorContext(new Error('boom'))).toEqual({ error: 'Error', message: 'boom' });
    configureLogger({ production: false });
    expect(errorContext(new Error('boom')).stack).toBeDefined();
  });

  it('cannot be switched to debug at runtime in production', () => {
    configureLogger({ production: true, level: 'debug' });
    expect(currentLogLevel()).toBe('info');
  });
});
