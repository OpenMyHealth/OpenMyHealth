export function normalizeDate(input: string): string {
  const raw = String(input || "").trim();
  if (!raw) return "";

  const compact = raw.replace(/[^0-9]/g, "");
  if (compact.length === 8) {
    return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }

  if (/^\d{4}[-/.]\d{2}$/.test(raw)) {
    const cleaned = raw.replace(/[/.]/g, "-");
    return `${cleaned}-01`;
  }

  return raw;
}

export function recencyBoost(date: string): number {
  const parsed = Date.parse(date);
  if (Number.isNaN(parsed)) return 0;

  const diffDays = (Date.now() - parsed) / (1000 * 60 * 60 * 24);
  if (diffDays <= 30) return 1;
  if (diffDays <= 180) return 0.7;
  if (diffDays <= 365) return 0.45;
  if (diffDays <= 730) return 0.25;
  return 0.1;
}
