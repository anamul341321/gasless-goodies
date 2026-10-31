export function dailyResultVersion(group: {
  run: { id: string; phase: string; total: number; success: number; final_failed: number; finished_at: string | null } | null;
  breakdown?: Record<string, number> | null;
  failed_key_count: number;
}) {
  return JSON.stringify([group.run, group.breakdown, group.failed_key_count]);
}