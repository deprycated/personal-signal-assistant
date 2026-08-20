type Fields = Record<string, string | number | boolean | null | undefined>;

function write(level: "info" | "warn" | "error", message: string, fields: Fields = {}) {
  console[level](JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    message,
    ...Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)),
  }));
}

export const logger = {
  info: (message: string, fields?: Fields) => write("info", message, fields),
  warn: (message: string, fields?: Fields) => write("warn", message, fields),
  error: (message: string, fields?: Fields) => write("error", message, fields),
};
