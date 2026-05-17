## Goal
Allow the user to create multiple auto-claim schedules per network, each with its own start time and its own wallet group. Example: 500 wallets claim at 12:00 AM, another 300 wallets claim at 3:00 AM, etc. Unlimited schedules.

## Approach

Introduce the concept of a "claim group" (named bucket of wallets with its own schedule). Each wallet belongs to one group per network. The scheduler fires per-group instead of per-(user, network).

## Database changes

New table `daily_claim_groups`:
- `id` (uuid, pk)
- `owner_user_id` (uuid)
- `network` (text, default 'celo')
- `name` (text) — e.g. "Batch A — 12:00 AM"
- `start_hour_bd` (smallint, 0-23)
- `start_minute_bd` (smallint, 0-59)
- `retry_wait_minutes` (int, default 30)
- `enabled` (bool, default true)
- timestamps
- RLS: owner only

Add `group_id uuid` to:
- `daily_claim_wallets` — assigns wallet to a group (nullable for backward compat → migrate existing wallets to a default group)
- `daily_claim_runs` — so each run is tied to one group (one run per group per day, instead of one per user+network)

Migration also creates a default group per existing `daily_claim_settings` row and assigns all that user's wallets to it, preserving current behavior.

Keep `daily_claim_settings` for backward compatibility but the scheduler will use groups going forward.

## Scheduler change

`daily-claim-scheduler` loops over `daily_claim_groups` (enabled = true) instead of `daily_claim_settings`. For each group whose target time fired within the last 10 min and no run exists today for that group, create a run with the wallets belonging to that group.

Uniqueness key for "today's run" becomes `(group_id, run_date)` instead of `(owner_user_id, network, run_date)`.

Phase-2 wait read from group's `retry_wait_minutes`.

## UI changes (`src/pages/DailyClaim.tsx`)

Replace the single "schedule + wait" panel with a **Groups** section:
- List of groups with: name, time (HH:MM BD), wait minutes, enabled toggle, wallet count, "Run now" / Edit / Delete.
- "Add group" button → create new group with name + time + wait.
- Wallets table gets a new "Group" column with a dropdown to reassign wallet to any group.
- Bulk-assign selected wallets to a group.

Stats and history still group by user but show per-group breakdown.

## Edge function changes
- `daily-claim-scheduler`: switch loop source to `daily_claim_groups`; create run per group; resume wait per group.
- `daily-claim-worker`: when building items for a run, pull wallets by `group_id` (passed in run row) instead of by user+network.
- `daily-claim-wallets`: add CRUD for groups; add `group_id` to wallet insert/update.
- `daily-claim-status`: include group info per run.

## Backward compatibility
Migration auto-creates one default group per existing `daily_claim_settings` row, copies its time + wait, and assigns all that user's wallets (per network) into it. Nothing breaks for current users — they just see one group named e.g. "Default — Celo".

## Files to touch
- new migration (tables + columns + backfill)
- `supabase/functions/daily-claim-scheduler/index.ts`
- `supabase/functions/daily-claim-worker/index.ts`
- `supabase/functions/daily-claim-wallets/index.ts`
- `supabase/functions/daily-claim-status/index.ts`
- `src/pages/DailyClaim.tsx` (groups UI, wallet group assignment)
- `src/integrations/supabase/types.ts` (auto)
