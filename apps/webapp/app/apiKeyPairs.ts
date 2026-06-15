import { authClient } from "~/authClient";

// API keys are created, listed and deleted as pairs: one secret key (sk_) and one
// public key (pk_). The two keys of a pair are linked by a shared `pairId` stored in
// each key's metadata. Keys are organization-owned, so every call is scoped by orgId.

type BetterAuthError = {
  code?: string | undefined;
  message?: string | undefined;
  status: number;
  statusText: string;
};

export type ApiKeyRecord = {
  id: string;
  name: string | null;
  prefix: string | null;
  start: string | null;
  metadata: Record<string, any> | null;
  createdAt: string | Date;
};

export type ApiKeyPair = {
  pairId: string;
  name: string | null;
  createdAt: string | Date;
  secret: ApiKeyRecord | null;
  publicKey: ApiKeyRecord | null;
};

function groupIntoPairs(keys: ApiKeyRecord[]): ApiKeyPair[] {
  const byPair = new Map<string, ApiKeyPair>();

  for (const key of keys) {
    const pairId = key.metadata?.pairId;
    if (!pairId) continue; // ignore keys that aren't part of a pair

    let pair = byPair.get(pairId);
    if (!pair) {
      pair = { pairId, name: key.name, createdAt: key.createdAt, secret: null, publicKey: null };
      byPair.set(pairId, pair);
    }

    if (key.prefix === "sk_") pair.secret = key;
    else if (key.prefix === "pk_") pair.publicKey = key;
  }

  return Array.from(byPair.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export async function listApiKeyPairs(
  organizationId: string
): Promise<{ data?: ApiKeyPair[]; error?: BetterAuthError }> {
  const response = await authClient.apiKey.list({ query: { organizationId } });
  if (response.error) return { error: response.error };
  return { data: groupIntoPairs(response.data.apiKeys as ApiKeyRecord[]) };
}

export async function createApiKeyPair(
  organizationId: string,
  name: string
): Promise<{ data?: { secret: any; publicKey: any }; error?: BetterAuthError }> {
  const pairId = crypto.randomUUID();

  const secret = await authClient.apiKey.create({
    name,
    prefix: "sk_",
    organizationId,
    metadata: { pairId, type: "secret" },
  });
  if (secret.error) return { error: secret.error };

  const publicKey = await authClient.apiKey.create({
    name,
    prefix: "pk_",
    organizationId,
    metadata: { pairId, type: "public" },
  });
  if (publicKey.error) {
    // best-effort rollback so we don't leave an orphan secret key behind
    await authClient.apiKey.delete({ keyId: secret.data.id }).catch(() => {});
    return { error: publicKey.error };
  }

  return { data: { secret: secret.data, publicKey: publicKey.data } };
}

export async function deleteApiKeyPair(
  organizationId: string,
  pairId: string
): Promise<{ error?: BetterAuthError }> {
  const response = await authClient.apiKey.list({ query: { organizationId } });
  if (response.error) return { error: response.error };

  const keys = (response.data.apiKeys as ApiKeyRecord[]).filter((k) => k.metadata?.pairId === pairId);
  for (const key of keys) {
    const del = await authClient.apiKey.delete({ keyId: key.id });
    if (del.error) return { error: del.error };
  }
  return {};
}
