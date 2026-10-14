export function formatMoney(amount, currency) {
  const value = Number(amount);
  if (!Number.isFinite(value)) return '—';
  if (!currency) return value.toFixed(2);
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value);
}
