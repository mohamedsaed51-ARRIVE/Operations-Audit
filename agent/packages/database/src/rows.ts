/** snake_case → camelCase for top-level column names (JSONB contents are left untouched). */
export function camelize<T = Record<string, unknown>>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())] = v;
  return out as T;
}
export const camelizeAll = <T = Record<string, unknown>>(rows: Record<string, unknown>[]): T[] => rows.map((r) => camelize<T>(r));
