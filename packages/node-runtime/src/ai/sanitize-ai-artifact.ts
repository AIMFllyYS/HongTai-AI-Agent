export function sanitizeAiArtifactText(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi, "Bearer [REDACTED]")
    .replace(/data:(image|audio)\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi, "data:$1/[REDACTED];base64,[REDACTED]")
    .replace(/("?(?:api[_-]?key|authorization|cookie|token)"?\s*[:=]\s*")([^"]+)(")/gi, "$1[REDACTED]$3");
}
