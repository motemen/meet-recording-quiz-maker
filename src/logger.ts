export type LogFields = Record<string, unknown>;

function log(level: "info" | "error" | "warn" | "debug", message: string, fields?: LogFields) {
  const payload = fields
    ? { ...normalize(fields), level, message, timestamp: new Date().toISOString() }
    : { level, message, timestamp: new Date().toISOString() };
  // Console logging is enough for App Engine and can be ingested by Cloud Logging.
  // Keep JSON flat for easier querying.
  console.log(JSON.stringify(payload));
}

function normalize(fields: LogFields): LogFields {
  if ("error" in fields && fields.error instanceof Error) {
    const { message, stack, name } = fields.error;
    return { ...fields, error: { message, stack, name } };
  }
  return fields;
}

export const logger = {
  info: (message: string, fields?: LogFields) => log("info", message, fields),
  warn: (message: string, fields?: LogFields) => log("warn", message, fields),
  error: (message: string, fields?: LogFields) => log("error", message, fields),
  debug: (message: string, fields?: LogFields) => log("debug", message, fields),
};
