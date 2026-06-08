/** Suggest next academic session label from existing labels (e.g. 2024/2025 → 2025/2026). */
export function suggestNextAcademicSession(labels: string[]): string | null {
  const cleaned = labels.map((s) => s.trim()).filter(Boolean);
  if (!cleaned.length) return null;
  const sorted = [...cleaned].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const last = sorted[sorted.length - 1];
  const slash = last.match(/^(\d{4})\s*\/\s*(\d{4})$/);
  if (slash) {
    const y1 = parseInt(slash[1], 10) + 1;
    const y2 = parseInt(slash[2], 10) + 1;
    return `${y1}/${y2}`;
  }
  const single = last.match(/^(\d{4})$/);
  if (single) return String(parseInt(single[1], 10) + 1);
  return null;
}
