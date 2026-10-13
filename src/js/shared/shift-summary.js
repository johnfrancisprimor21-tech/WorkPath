import { shiftMonth } from './time.js';

export function monthDateRange(month) {
  const afterMonth = shiftMonth(month, 1) + '-01';
  const [year, monthNumber] = afterMonth.split('-').map(Number);
  const toDate = new Date(Date.UTC(year, monthNumber - 1, 0)).toISOString().slice(0, 10);
  return { fromDate: month + '-01', toDate };
}

export function shiftsNewestFirst(shifts) {
  return shifts.slice().sort((a, b) => compareText(b.work_date, a.work_date)
    || compareTimeDescendingNullLast(a.time_in, b.time_in)
    || compareText(b.id, a.id));
}

function compareTimeDescendingNullLast(a, b) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return Date.parse(b) - Date.parse(a);
}

function compareText(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}
