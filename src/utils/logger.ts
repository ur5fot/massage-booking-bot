type Level = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Ключи, значения которых нельзя писать в лог ни при каких обстоятельствах. */
const SECRET_KEYS = /token|secret|password|private_key|privatekey|credential|authorization/i;

function redact(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(redact);

  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SECRET_KEYS.test(key) ? "[redacted]" : redact(inner);
  }
  return out;
}

function serialize(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(redact(value), (_key, v) => (typeof v === "bigint" ? v.toString() : v)),
  );
}

export type Logger = {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
};

export function createLogger(minLevel: Level = "info", bindings: Record<string, unknown> = {}): Logger {
  const write = (level: Level, message: string, meta?: Record<string, unknown>) => {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return;

    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      msg: message,
      ...(serialize({ ...bindings, ...meta }) as Record<string, unknown>),
    });

    if (level === "error" || level === "warn") console.error(line);
    else console.log(line);
  };

  return {
    debug: (m, meta) => write("debug", m, meta),
    info: (m, meta) => write("info", m, meta),
    warn: (m, meta) => write("warn", m, meta),
    error: (m, meta) => write("error", m, meta),
    child: (extra) => createLogger(minLevel, { ...bindings, ...extra }),
  };
}
