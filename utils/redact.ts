/**
 * Redact password from a PostgreSQL connection string for safe logging.
 * Produces: postgresql://user:***@host:port/database
 */
export function redactDatabaseUrl(url: string): string {
  try {
    return url.replace(/^([^:]+:\/\/[^:]+):([^@]+)@/, "$1:***@");
  } catch {
    return "[invalid url]";
  }
}
