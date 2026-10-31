// A short response can be the server's row cap, not the end of the data.
// Advance by the rows actually received and stop only at an empty page.
export async function readAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  pageSize = 500,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; ) {
    const page = await fetchPage(from, from + pageSize - 1);
    if (page.error) throw page.error;
    if (!page.data?.length) return rows;
    rows.push(...page.data);
    from += page.data.length;
  }
}