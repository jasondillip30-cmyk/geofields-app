type QueryValue = string | string[] | undefined;

export type LegacyFinanceSearchParamsInput =
  | Promise<Record<string, QueryValue>>
  | undefined;

export async function resolveLegacyFinanceHref(
  destination: string,
  searchParams: LegacyFinanceSearchParamsInput,
  queryOverrides?: Record<string, string>
) {
  const params = searchParams ? await searchParams : undefined;
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(params || {})) {
    if (typeof value === "string") {
      if (value.length > 0) {
        query.set(key, value);
      }
      continue;
    }
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (entry.length > 0) {
          query.append(key, entry);
        }
      }
    }
  }

  for (const [key, value] of Object.entries(queryOverrides || {})) {
    if (value.length === 0) {
      query.delete(key);
      continue;
    }
    query.set(key, value);
  }

  const queryText = query.toString();
  return queryText ? `${destination}?${queryText}` : destination;
}
