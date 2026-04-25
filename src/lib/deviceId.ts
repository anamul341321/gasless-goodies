// Persistent device fingerprint for free-gas abuse prevention.
// Combines: stable UUID in localStorage + cookie + canvas/screen/timezone hash.
// Survives wallet switches, IP changes (VPN), and most browser data clears.

const LS_KEY = "fg_did_v1";
const COOKIE_KEY = "fg_did";

function getCookie(name: string): string | null {
  const m = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
  return m ? decodeURIComponent(m[1]) : null;
}

function setCookie(name: string, value: string, days = 365 * 2) {
  const exp = new Date(Date.now() + days * 86400_000).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${exp}; path=/; SameSite=Lax`;
}

function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return (crypto as any).randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function canvasFingerprint(): string {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 200;
    canvas.height = 50;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "no-canvas";
    ctx.textBaseline = "top";
    ctx.font = "14px 'Arial'";
    ctx.fillStyle = "#f60";
    ctx.fillRect(125, 1, 62, 20);
    ctx.fillStyle = "#069";
    ctx.fillText("FreeGas-fp-🔥", 2, 15);
    ctx.fillStyle = "rgba(102,204,0,0.7)";
    ctx.fillText("FreeGas-fp-🔥", 4, 17);
    return canvas.toDataURL();
  } catch {
    return "canvas-blocked";
  }
}

function staticEnvSignal(): string {
  const nav = navigator;
  const scr = window.screen;
  return [
    nav.userAgent || "",
    nav.language || "",
    (nav.languages || []).join(","),
    nav.platform || "",
    String(nav.hardwareConcurrency || 0),
    String((nav as any).deviceMemory || 0),
    `${scr.width}x${scr.height}x${scr.colorDepth}`,
    String(new Date().getTimezoneOffset()),
    Intl.DateTimeFormat().resolvedOptions().timeZone || "",
  ].join("|");
}

let cached: string | null = null;

export async function getDeviceId(): Promise<string> {
  if (cached) return cached;

  // 1. Try localStorage
  let id: string | null = null;
  try { id = localStorage.getItem(LS_KEY); } catch {}

  // 2. Fall back to cookie
  if (!id) id = getCookie(COOKIE_KEY);

  // 3. Generate a new ID derived from a stable env hash + random UUID
  if (!id) {
    const envHash = await sha256Hex(staticEnvSignal() + "|" + canvasFingerprint());
    id = `${envHash.slice(0, 16)}-${uuid()}`;
  }

  // Persist in BOTH places so clearing one is not enough
  try { localStorage.setItem(LS_KEY, id); } catch {}
  setCookie(COOKIE_KEY, id);

  cached = id;
  return id;
}
