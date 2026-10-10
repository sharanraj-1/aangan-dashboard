// Tiny helper to build links that keep the current view / month / filters.
export type SP = Record<string, string | undefined>;

export function href(sp: SP, patch: Record<string, string | null | undefined> = {}): string {
  const merged: SP = { ...sp };
  delete merged.msg;
  delete merged.ok;
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined || v === '') delete merged[k];
    else merged[k] = v;
  }
  const q = new URLSearchParams(Object.entries(merged).filter(([, v]) => v !== undefined) as [string, string][]).toString();
  return q ? `/?${q}` : '/';
}
