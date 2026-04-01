export class AuthConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthConfigurationError";
  }
}

const DEVELOPMENT_FALLBACK_SECRET = "geofields-local-dev-secret";

export function resolveAuthSecretValue() {
  const configuredSecret = (process.env.AUTH_SECRET || process.env.SESSION_SECRET || "").trim();
  if (configuredSecret) {
    return configuredSecret;
  }

  if (process.env.NODE_ENV !== "production") {
    return DEVELOPMENT_FALLBACK_SECRET;
  }

  throw new AuthConfigurationError(
    "Missing AUTH_SECRET (or SESSION_SECRET). Configure a strong session secret in production."
  );
}

export function resolveAuthSecretBytes() {
  return new TextEncoder().encode(resolveAuthSecretValue());
}
