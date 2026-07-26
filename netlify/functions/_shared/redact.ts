// Error messages from the LLM/gate path can end up in the `events` log,
// which any connection-token holder can poll (`GET /events`). None of the
// errors we handle *should* contain secrets, but nothing guarantees a
// third-party SDK error (or a driver error) won't echo a connection string
// or API key back verbatim — so scrub the known secret values defensively
// before anything derived from an error is persisted.
const SECRET_ENV_VARS = [
  "OPENROUTER_API_KEY",
  "NETLIFY_DATABASE_URL",
  "NETLIFY_DATABASE_URL_UNPOOLED",
] as const;

/** Replaces any occurrence of a known secret env var's value with `[redacted]`. */
export function redactSecrets(text: string): string {
  let redacted = text;

  for (const name of SECRET_ENV_VARS) {
    const value = process.env[name];
    if (value) {
      redacted = redacted.split(value).join("[redacted]");
    }
  }

  return redacted;
}
