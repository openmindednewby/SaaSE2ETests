type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export interface FieldGap { path: string; expected: Json; actual: Json | undefined }

function leaves(value: Json, path: string, out: Map<string, Json>): void {
  if (value === null) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => leaves(item, `${path}[${String(index)}]`, out));
    return;
  }
  if (typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) leaves(child, path ? `${path}.${key}` : key, out);
    return;
  }
  out.set(path, value);
}

function digitsOnly(value: Json | undefined): string {
  return String(value ?? '').replace(/[^\d.]/g, '');
}

export function fieldGaps(expected: object, actual: object): FieldGap[] {
  const want = new Map<string, Json>();
  const got = new Map<string, Json>();
  leaves(expected as Json, '', want);
  leaves(actual as Json, '', got);
  const gaps: FieldGap[] = [];
  for (const [path, value] of want) {
    const seen = got.get(path);
    const samePrice = path.endsWith('.price') && digitsOnly(seen) !== '' && digitsOnly(seen) === digitsOnly(value);
    if (seen !== value && !samePrice) gaps.push({ path, expected: value, actual: seen });
  }
  return gaps;
}

export function gapRoots(gaps: readonly FieldGap[]): string[] {
  return [...new Set(gaps.map((g) => g.path.replace(/\[\d+\].*$/, '[]').replace(/^(\w+(?:\.\w+)?).*$/, '$1')))].sort();
}

export interface KucyWalkView {
  branding: { name: string; tagline: string; edition: string; heroImageUrl: string; logoUrl: string; primaryColor: string; accentColor: string };
  eventDetails: { eyebrow: string; heading: string; description: string; dateLabel: string; locationLabel: string; stats: Array<{ value: string; label: string }> };
  venue: { name: string; city: string; address: string; mapUrl: string };
  register: { label: string; url: string; note: string; secondaryLabel: string; secondaryUrl: string };
  passes: Array<{ name: string; price: string; description: string; badge?: string }>;
  posters: Array<{ title: string; imageUrl: string; downloadUrl: string }>;
}
