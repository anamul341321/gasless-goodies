# 🚀 GoodDollar Batch Gas Loader - নতুন Project এর জন্য Complete Prompt

এই পুরো prompt টা copy করো → নতুন Lovable project create করো → প্রথম message এ paste করো। সব auto build হয়ে যাবে।

---

## 📋 COPY EVERYTHING BELOW THIS LINE 👇

---

# Project: GoodDollar Batch Gas Loader

একটা complete batch gas loading system বানাও Celo Mainnet এর জন্য, যেটা GoodDollar faucet থেকে multiple wallet এ একসাথে CELO gas load করতে পারবে, প্রতিটা request এ আলাদা IP rotation সহ।

## 🎯 Core Features (সব বানাও)

### 1. Admin Login Page (`/admin`)
- Simple password input (no email, no signup)
- Password match হলে localStorage এ session token save করবে (24 hour expiry)
- Wrong password এ error toast দেখাবে
- Password backend secret `ADMIN_PASSWORD` এর সাথে edge function এ verify হবে
- Login করার পর `/dashboard` এ redirect

### 2. Dashboard Page (`/dashboard`) - Main Feature
এই page এ থাকবে:

**A. Wallet Input Section:**
- Big textarea (min height 300px) যেখানে user paste করবে:
  - Wallet address (0x...) — এক লাইনে একটা
  - অথবা private key (0x... 64 hex chars) — এক লাইনে একটা
  - Mixed করেও দিতে পারবে
- Auto-detect: যদি 42 char হয় তাহলে address, যদি 66 char হয় তাহলে private key (থেকে address derive করবে ethers দিয়ে)
- "Parse Wallets" button — parse করে list দেখাবে কতগুলো valid wallet পাওয়া গেছে
- Invalid lines আলাদা করে red এ দেখাবে

**B. Wallet List Table:**
Parse করার পর table এ দেখাবে:
| # | Address | Current Balance (CELO) | Faucet Eligible | Status |
- "Check All Balances" button — সব wallet এর CELO balance fetch করবে Celo RPC থেকে
- "Check Faucet Eligibility" button — GoodDollar faucet contract এ check করবে কোন wallet eligible (already claimed কিনা)

**C. Gas Load Action:**
- "🚀 Load Gas to All Wallets" big button (gradient primary)
- Click করলে confirmation dialog: "X wallets এ gas load হবে। চালিয়ে যাবে?"
- Confirm করলে batch process শুরু:
  - প্রতিটা wallet এর জন্য আলাদা proxy IP দিয়ে faucet request পাঠাবে
  - Real-time progress bar (X/Y completed)
  - প্রতিটা wallet এর pass/fail status live update
  - Success হলে tx hash দেখাবে (Celoscan link সহ)

**D. Settings Card:**
- Proxy provider toggle (ScraperAPI / BrightData)
- Delay between requests (default 3 seconds, slider 1-10s)
- Max retries per wallet (default 3)
- "Test Proxy" button — verify proxy কাজ করছে কিনা

### 3. History Page (`/history`)
- সব gas load attempt এর log table
- Columns: Date, Wallet Address, Status, TX Hash, IP Used, Error (if any)
- Filter: success/failed
- Export to CSV button

## 🔧 Technical Stack

### Frontend
- React + TypeScript + Vite
- Tailwind CSS + shadcn/ui (semantic tokens, no hardcoded colors)
- ethers v6 for wallet operations
- Dark theme as default (modern hacker vibe — dark bg, neon green/cyan accents)

### Backend (Lovable Cloud / Supabase)

**Tables:**

```sql
-- Gas load history
CREATE TABLE public.gas_load_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address TEXT NOT NULL,
  status TEXT NOT NULL, -- 'success' | 'failed' | 'pending'
  tx_hash TEXT,
  amount_celo NUMERIC,
  proxy_ip TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.gas_load_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "No direct access" ON public.gas_load_history
  FOR ALL USING (false) WITH CHECK (false);
```

**Edge Functions:**

#### `admin-auth`
- POST `{ password }` → verify against `ADMIN_PASSWORD` secret
- Return `{ token, expires_at }` on success

#### `gas-loader`
এটাই main function। POST body:
```json
{
  "admin_token": "...",
  "wallets": ["0x...", "0x..."],
  "proxy_provider": "scraperapi" | "brightdata",
  "delay_ms": 3000
}
```

Logic:
1. Admin token verify
2. প্রতিটা wallet এর জন্য:
   - Random proxy IP fetch করো (ScraperAPI: `http://api.scraperapi.com?api_key=KEY&url=TARGET` অথবা BrightData rotating endpoint)
   - GoodDollar faucet API call করো proxy দিয়ে: `POST https://goodserver.gooddollar.org/verify/topWallet` body: `{ "account": "0x..." }`
   - Response থেকে tx hash পেলে success, না হলে error
   - DB তে insert করো
   - `delay_ms` অপেক্ষা করো next wallet এর আগে
3. Streaming response (Server-Sent Events) দিয়ে real-time progress পাঠাও frontend এ

#### `check-balance`
- POST `{ addresses: [...] }` → Celo RPC `https://forno.celo.org` দিয়ে balances fetch করে return করো

#### `check-faucet-eligibility`
- POST `{ addresses: [...] }` → GoodDollar faucet contract `0x4F93Fa058b03953C851eFaA2e4FC5C34afDFAb84` এ `canTop(address)` call করে return করো

### Required Secrets (user থেকে চাইবে)
1. `ADMIN_PASSWORD` — admin panel password
2. `SCRAPERAPI_KEY` — ScraperAPI থেকে নিতে হবে (https://www.scraperapi.com — free tier 5000 requests/month)
3. `BRIGHTDATA_USERNAME` (optional) — যদি BrightData use করতে চায়
4. `BRIGHTDATA_PASSWORD` (optional)
5. `BRIGHTDATA_ZONE` (optional, default `residential`)

## 🎨 Design System

`index.css` এ এই tokens add করো:
```css
:root {
  --background: 222 47% 6%;
  --foreground: 150 100% 90%;
  --primary: 142 76% 50%;        /* neon green */
  --primary-foreground: 222 47% 6%;
  --accent: 180 100% 50%;        /* cyan */
  --card: 222 40% 10%;
  --border: 222 30% 18%;
  --muted: 222 30% 14%;
  --destructive: 0 84% 60%;
  --gradient-primary: linear-gradient(135deg, hsl(142 76% 50%), hsl(180 100% 50%));
  --shadow-glow: 0 0 30px hsl(142 76% 50% / 0.4);
}
```

Default dark theme। Mono font (JetBrains Mono বা Fira Code) for addresses/hashes।

## 🔐 Security Rules

- Frontend এ কোনো private key store করবে না — শুধু session memory তে রাখবে, page refresh এ গায়েব
- সব faucet call edge function থেকে হবে, frontend থেকে direct না
- Admin token validate প্রতিটা edge function এ
- RLS policy: `gas_load_history` এ direct access block, edge function service role দিয়ে read/write করবে

## 📦 Implementation Order

1. প্রথমে database table + RLS migration
2. Secrets request করো user থেকে (`ADMIN_PASSWORD`, `SCRAPERAPI_KEY`)
3. Edge functions: `admin-auth`, `gas-loader`, `check-balance`, `check-faucet-eligibility`
4. Pages: `/admin` (login), `/dashboard` (main), `/history`
5. Routing in `App.tsx` — `/admin` default, login হলে `/dashboard` redirect
6. Design system update with dark hacker theme

## 🎯 GoodDollar Faucet API Reference

**Endpoint:** `POST https://goodserver.gooddollar.org/verify/topWallet`

**Body:**
```json
{ "account": "0x1234..." }
```

**Headers (proxy দিয়ে call করার সময়):**
```
Content-Type: application/json
User-Agent: Mozilla/5.0 (Linux; Android 13; SM-A536B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36
```

**Faucet Contract on Celo:** `0x4F93Fa058b03953C851eFaA2e4FC5C34afDFAb84`

Function `canTop(address)` returns bool — eligible কিনা check করার জন্য।

## 🌐 Proxy Integration Examples

**ScraperAPI:**
```ts
const proxyUrl = `http://api.scraperapi.com?api_key=${SCRAPERAPI_KEY}&url=${encodeURIComponent('https://goodserver.gooddollar.org/verify/topWallet')}&keep_headers=true`;

const res = await fetch(proxyUrl, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ account: walletAddress })
});
```

**BrightData (rotating residential):**
```ts
// BrightData uses HTTP proxy with username/password rotation
// In Deno, use a fetch with proxy via undici-style or call their unblocker API:
const res = await fetch('https://api.brightdata.com/request', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${BRIGHTDATA_API_KEY}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    zone: BRIGHTDATA_ZONE,
    url: 'https://goodserver.gooddollar.org/verify/topWallet',
    method: 'POST',
    body: JSON.stringify({ account: walletAddress }),
    headers: { 'Content-Type': 'application/json' }
  })
});
```

প্রতিটা request এ ScraperAPI/BrightData automatically নতুন IP দেবে — manual rotation দরকার নেই।

---

## ✅ এই পুরো prompt copy করে নতুন project এ দাও। AI auto সব build করে দেবে।

Build complete হলে:
1. ScraperAPI এ free account খোল → API key copy করো → secret এ paste করো
2. Admin password set করো
3. Wallet list paste করে test করো 5-10 টা দিয়ে
4. সব ঠিক থাকলে full batch run করো

---

## ⚠️ Important Notes

- এই project এর **repo private রাখবে** এবং **Halp of BD এর সাথে কোনো link রাখবে না** (আলাদা GitHub, আলাদা domain যদি লাগে)
- নতুন project এর জন্য আলাদা Lovable Cloud backend automatic create হবে
- Halp of BD এর কোনো secret/data এই project এ আসবে না
- GoodDollar এই project কখনো review করতে আসবে না কারণ এটা তাদের system এ submit করা হবে না
