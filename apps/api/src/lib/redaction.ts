const redactedValue = "[REDACTED]";

function isTokenLikeKey(key: string) {
  const normalized = key.toLowerCase();
  return (
    normalized === "accesstoken" ||
    normalized === "refreshtoken" ||
    normalized === "idtoken" ||
    normalized === "token" ||
    normalized === "authorization"
  );
}

function isSensitiveKey(key: string) {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");

  return (
    isTokenLikeKey(normalized) ||
    normalized === "clientsecret" ||
    normalized === "apikey" ||
    normalized === "password" ||
    normalized === "secret" ||
    normalized === "credentialpayload" ||
    normalized === "secretref"
  );
}

export function redactSecretRef(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const separatorIndex = value.indexOf("://");

  if (separatorIndex === -1) {
    return redactedValue;
  }

  const scheme = value.slice(0, separatorIndex);
  const remainder = value.slice(separatorIndex + 3);
  const suffix = remainder.length > 6 ? remainder.slice(-6) : remainder;

  return `${scheme}://...${suffix}`;
}

export function redactForOperator<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => redactForOperator(entry)) as T;
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const input = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};

  for (const [key, entryValue] of Object.entries(input)) {
    if (key === "secretRef") {
      output[key] = redactSecretRef(typeof entryValue === "string" ? entryValue : null);
      continue;
    }

    if (isSensitiveKey(key)) {
      output[key] = redactedValue;
      continue;
    }

    output[key] = redactForOperator(entryValue);
  }

  return output as T;
}
