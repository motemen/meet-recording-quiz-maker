export type LogFields = Record<string, unknown>;

function log(level: "info" | "error" | "warn" | "debug", message: string, fields?: LogFields) {
  const payload = fields ? { ...fields, level, message } : { level, message };
  // Console logging is enough for Cloud Run and can be ingested by Cloud Logging.
  // Keep JSON flat for easier querying.
  console.log(JSON.stringify(payload));
}

export const logger = {
  info: (message: string, fields?: LogFields) => log("info", message, fields),
  warn: (message: string, fields?: LogFields) => log("warn", message, fields),
  error: (message: string, fields?: LogFields) => log("error", message, fields),
  debug: (message: string, fields?: LogFields) => log("debug", message, fields)
};
