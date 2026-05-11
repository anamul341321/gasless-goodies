// AES-256-GCM encryption helpers for daily-claim private keys.
// Key is derived from DAILY_CLAIM_ENCRYPTION_KEY (any string) via SHA-256.

const KEY_MATERIAL = Deno.env.get("DAILY_CLAIM_ENCRYPTION_KEY") || "";

let cachedKey: CryptoKey | null = null;
async function getKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;
  if (!KEY_MATERIAL) throw new Error("DAILY_CLAIM_ENCRYPTION_KEY not set");
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(KEY_MATERIAL));
  cachedKey = await crypto.subtle.importKey("raw", hash, "AES-GCM", false, ["encrypt", "decrypt"]);
  return cachedKey;
}

function b64encode(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
function b64decode(str: string): Uint8Array {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function encryptKey(plaintext: string): Promise<string> {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext))
  );
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  return "v1:" + b64encode(out);
}

export async function decryptKey(payload: string): Promise<string> {
  if (!payload.startsWith("v1:")) throw new Error("invalid encrypted payload");
  const data = b64decode(payload.slice(3));
  const iv = data.slice(0, 12);
  const ct = data.slice(12);
  const key = await getKey();
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new TextDecoder().decode(pt);
}
