import { shiftMonth } from '../shared/time.js';

export const SHIFT_COLUMNS = 'id, employment_id, work_date, day_type, time_in, time_out, break_minutes, is_overtime, notes, worked_minutes';

export async function fetchShiftMonth(supabase, userId, month) {
  const firstDay = month + '-01';
  const afterMonth = shiftMonth(month, 1) + '-01';
  const { data, error } = await supabase
    .from('shifts_with_hours')
    .select(SHIFT_COLUMNS)
    .eq('user_id', userId)
    .gte('work_date', firstDay)
    .lt('work_date', afterMonth)
    .order('work_date', { ascending: false })
    .order('time_in', { ascending: false, nullsFirst: false });
  if (error) throw error;
  return data || [];
}

export function summarizeShifts(shifts) {
  return {
    workedMinutes: shifts.reduce((sum, shift) => sum + Number(shift.worked_minutes || 0), 0),
    daysWorked: new Set(shifts
      .filter((shift) => shift.day_type === 'duty' && shift.time_in && shift.time_out)
      .map((shift) => shift.work_date)).size,
    overtimeCount: shifts.filter((shift) => shift.is_overtime).length
  };
}

export function formatWorkedMinutes(minutes) {
  const safeMinutes = Math.max(0, Math.floor(minutes));
  return Math.floor(safeMinutes / 60) + 'h ' + String(safeMinutes % 60) + 'm';
}
