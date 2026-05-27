function parseJwtPayload(token: string | undefined): Record<string, unknown> | undefined {
  if (!token?.trim()) {
    return undefined;
  }
  const parts = token.split(".");
  if (parts.length < 2) {
    return undefined;
  }
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

export function parseJwtTenantId(token: string | undefined): string | undefined {
  const payload = parseJwtPayload(token);
  if (!payload) {
    return undefined;
  }
  const tid =
    (typeof payload.tenant_id === "string" ? payload.tenant_id : undefined)?.trim() ||
    (typeof payload.tenantId === "string" ? payload.tenantId : undefined)?.trim();
  return tid || undefined;
}

export function parseJwtEmail(token: string | undefined): string | undefined {
  const payload = parseJwtPayload(token);
  if (!payload) {
    return undefined;
  }
  const email = typeof payload.email === "string" ? payload.email.trim() : undefined;
  return email || undefined;
}
