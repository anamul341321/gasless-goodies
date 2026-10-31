import { readAllPages } from "./pagination.ts";

export async function readClaimQueue<T>(
  url: string,
  headers: Record<string, string>,
  request: typeof fetch = fetch,
): Promise<T[]> {
  return readAllPages<T>(async (from, to) => {
    const pageUrl = new URL(url);
    pageUrl.searchParams.set("order", "id.asc");
    pageUrl.searchParams.set("offset", String(from));
    pageUrl.searchParams.set("limit", String(to - from + 1));
    const response = await request(pageUrl.toString(), { headers });
    if (!response.ok) throw new Error(`Claim queue page failed: ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data)) throw new Error("Invalid claim queue page");
    return { data: data as T[], error: null };
  });
}

export function summarizeClaimQueue(rows: { status: string }[]) {
  let done = 0, failed = 0, needsGas = 0, activeRemaining = 0;
  for (const row of rows) {
    if (row.status === "success") done++;
    else if (["failed_gas", "already_claimed", "failed_kyc", "failed"].includes(row.status)) {
      failed++;
      if (row.status === "failed_gas") needsGas++;
    } else activeRemaining++;
  }
  return { done, failed, needsGas, activeRemaining, allDone: rows.length > 0 && activeRemaining === 0 };
}