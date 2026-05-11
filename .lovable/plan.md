## Daily Auto-Claim System (notun, alada)

Existing "GoodDollar Claim" page emnei thakbe. Eta ekta **separate slow-claim system** hobe — protidin Bangladesh raat 12:00 (UTC 18:00) te apnar shob saved wallet er jonno auto claim chalabe.

---

### 1. Database (notun tables)

**`daily_claim_wallets`** — apnar saved keys (per user)
- `owner_user_id`, `wallet_address`, `private_key` (encrypted at rest), `label`, `is_active`, `created_at`
- RLS: user shudhu nijer wallet dekhbe/manage korbe

**`daily_claim_runs`** — protidin er run history
- `owner_user_id`, `run_date` (UTC date), `phase` (`claiming` | `gas_requesting` | `waiting_30m` | `retrying` | `completed`)
- `total`, `success`, `failed_gas`, `failed_other`, `final_failed`
- `started_at`, `gas_requests_done_at`, `retry_started_at`, `finished_at`
- Unique: (owner_user_id, run_date) — dine ekbar matro

**`daily_claim_run_items`** — per wallet per run status
- `run_id`, `wallet_address`, `private_key` (run shesh hole erase, kintu **final_failed** hole ucched korbo na — apni dekhte/copy korte parben)
- `phase1_status`, `phase1_tx`, `phase1_error`
- `gas_request_status`, `gas_tx`, `gas_requested_at`
- `phase2_status` (retry), `phase2_tx`, `phase2_error`
- `final_status` (`success` | `failed_gas` | `failed_kyc` | `failed_other` | `already_claimed`)

---

### 2. Edge Functions (notun)

**`daily-claim-wallets`** (CRUD, JWT-protected)
- `POST` add (single ba bulk paste), `GET` list, `DELETE` remove, `PATCH` toggle active

**`daily-claim-scheduler`** (cron-only, runs every minute)
- Check kore: ajker (UTC) `daily_claim_runs` row exist kore ki na, jodi UTC 18:00–18:05 er moddhe time hoy ar today er run nai → notun run create kore phase 1 shuru kore
- Per user grouped — alada run

**`daily-claim-worker`** (heavy-lifting, self-recursive)
- **Phase 1 — claiming**: 5-10 wallet/wave parallel, slow (gap), `claimOne()` similar to existing worker. Fail hole `failed_gas` / `failed_kyc` / `failed_other` mark kore.
- Phase 1 shesh → automatic Phase 2 e jay.
- **Phase 2 — gas_requesting**: shob `failed_gas` wallet er jonno **3 second gap** diye `free-gas-load` invoke kore (existing function, Webshare proxy diye IP rotate ache otokhanei). Onek time lagleo problem nai — shob complete na howa porjonto wait kore.
- Phase 2 shesh → `gas_requests_done_at = now()`, phase = `waiting_30m`.
- **Phase 3 — wait**: scheduler protidin minute e check kore — `gas_requests_done_at + 30min < now()` hole phase = `retrying` kore worker abar trigger kore.
- **Phase 4 — retrying**: `failed_gas` wallet gulai abar 1 bar claim try kore. Result update kore `final_status` set kore.
- Phase 4 shesh → `final_failed` count refresh, phase = `completed`. **Success wallet er private_key erase**, failed wallet er key thakbe (apnake show korar jonno).

**`daily-claim-status`** (JWT-protected)
- Latest run + items return kore (failed wallets keys shoho)

---

### 3. Cron (pg_cron)

```sql
-- Every minute: scheduler decides if today's run should start, or if 30m wait is over
select cron.schedule('daily-claim-scheduler', '* * * * *', $$
  select net.http_post(
    url := '.../functions/v1/daily-claim-scheduler',
    headers := '{"apikey":"<anon>","Content-Type":"application/json"}'::jsonb,
    body := '{}'::jsonb
  );
$$);
```

Scheduler logic:
- Current UTC time `>= 18:00` AND `< 18:10` AND today er run nai → start
- Phase = `waiting_30m` AND `gas_requests_done_at + 30m <= now()` → trigger retry

---

### 4. Frontend (notun page `/daily-claim`)

**Top section: "Saved Wallets"**
- Textarea/file paste → bulk add
- Table: address + active toggle + delete
- Counter: "X wallets ready for tomorrow's auto-claim"

**Middle: "Today's Run"**
- Status pill: `Not started` / `Claiming (12/87)` / `Requesting gas (45/52)` / `Waiting 30m (~14m left)` / `Retrying (5/12)` / `Completed`
- Progress bar per phase
- Stats: Success / Failed gas / Failed KYC / Final failed

**Bottom: "Failed Keys" (collapsed by default)**
- Run shesh hole opening hole shob `final_status != success` wallet shoho **private_key**
- Per-row "Show key" button (eye icon) + global **"Copy all failed keys"** button
- Note: shudhu apnar nijer keys, JWT-locked

**Sidebar/header link**: "Daily Claim" — alada page, existing `/claim` thakbe untouched

---

### 5. Security & Notes

- Private keys: AES-256-GCM with a server-side `DAILY_CLAIM_ENCRYPTION_KEY` secret (notun secret lagbe)
- All endpoints JWT-protected (auth required), RLS enforced
- Scheduler is idempotent — multiple invocations safe (unique constraint on `(owner_user_id, run_date)`)
- Free-gas-load already has IP/wallet/fingerprint daily limit — daily claim er gas request o oi limit menei korbe, je gula limit hit korbe sheguloke `final_failed` mark korbe
- Existing `/claim` page, `gd-claim-*` functions, `gd_claim_jobs` etc. — kichui change hocche na

---

### Confirm korar age 1 ta secret lagbe

`DAILY_CLAIM_ENCRYPTION_KEY` — apnar saved private key gula database e encrypt kore rakhar jonno. Apni approve korle ami secret request pathabo, tarpor migration + functions + frontend build korbo.

Approve korben?