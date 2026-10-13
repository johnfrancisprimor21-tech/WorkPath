export const APPLICATION_STATUSES = ['pending', 'interview', 'offer', 'rejected', 'no_response'];

export function countApplicationStatuses(applications) {
  const counts = { all: applications.length };
  for (const status of APPLICATION_STATUSES) counts[status] = 0;
  for (const application of applications) {
    if (Object.hasOwn(counts, application.status) && application.status !== 'all') counts[application.status] += 1;
  }
  return counts;
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
