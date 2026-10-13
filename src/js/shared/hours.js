/** Return whole worked minutes for a shift using its UTC instants. */
export function computeWorkedMinutes(shift) {
  if (shift?.day_type !== 'duty' || !shift.time_in || !shift.time_out) return 0;
  const start = Date.parse(shift.time_in);
  const end = Date.parse(shift.time_out);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;

  const elapsedWholeMinutes = Math.floor((end - start) / 60000);
  const breakMinutes = Number.isFinite(Number(shift.break_minutes)) ? Number(shift.break_minutes) : 0;
  return Math.max(0, elapsedWholeMinutes - breakMinutes);
}
