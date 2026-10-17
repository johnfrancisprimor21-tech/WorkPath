import { formatWorkedMinutes } from './aggregations.js';
import { barChart, horizontalBars } from './charts.js';
import { formatMoney } from './money.js';
import {
  applicationsByMonth,
  applicationsByStatus,
  applicationsByWeek,
  dutyDaysByMonth,
  earningsByMonth,
  hoursByMonth,
  hoursByWeek,
  monthRange,
  overtimeByMonth,
  perJob,
  responseRate
} from './statistics.js';
import { formatMonthLabel } from './time.js';

const APPLICATION_STATUS_LABELS = Object.freeze({
  pending: 'Pending',
  interview: 'Interview',
  offer: 'Offer',
  rejected: 'Rejected',
  no_response: 'No response'
});
const APPLICATION_STATUSES = Object.keys(APPLICATION_STATUS_LABELS);

/** Build plain report data using the same pure calculations as the Stats screens. */
export function buildReportModel({
  mode,
  profile = {},
  today,
  range = 6,
  rangeDates,
  shifts = [],
  payrollEntries = [],
  employments = [],
  applications = [],
  applicationLimit = 5000,
  generatedAt = new Date().toISOString()
} = {}) {
  if (!['employed', 'job_seeker'].includes(mode)) throw new TypeError('Choose a supported report type.');
  if (!today) throw new TypeError('A report date is required.');

  const timeZone = validTimeZone(profile.timezone) ? profile.timezone : 'UTC';
  const currency = profile.currency || '';
  const title = mode === 'employed' ? 'Employed Statistics Report' : 'Job Seeker Statistics Report';
  const selectedRange = mode === 'employed' ? Number(range) : 6;
  const dates = rangeDates || monthRange(today, selectedRange);
  const header = {
    title,
    fromDate: dates.fromDate,
    toDate: dates.toDate,
    dateRange: `${formatCalendarDate(dates.fromDate)} – ${formatCalendarDate(dates.toDate)}`,
    currency,
    generatedAt: formatGeneratedAt(generatedAt, timeZone),
    timeZone
  };

  if (mode === 'employed') {
    const hoursWeeks = hoursByWeek(shifts, today, 8);
    const hoursMonths = hoursByMonth(shifts, today, selectedRange);
    const overtimeMonths = overtimeByMonth(shifts, today, selectedRange);
    const daysMonths = dutyDaysByMonth(shifts, today, selectedRange);
    const earningsMonths = earningsByMonth({
      payrollEntries,
      shifts,
      employments,
      endDate: today,
      count: selectedRange
    });
    const jobs = perJob({
      shifts,
      employments,
      payrollEntries,
      fromDate: dates.fromDate,
      toDate: dates.toDate
    });
    const inRangePaydays = payrollEntries.filter((entry) => entry.pay_date >= dates.fromDate && entry.pay_date <= dates.toDate);
    const totalsCents = inRangePaydays.reduce((totals, entry) => ({
      gross: totals.gross + moneyToCents(entry.gross),
      deductions: totals.deductions + moneyToCents(entry.deductions),
      net: totals.net + moneyToCents(entry.net)
    }), { gross: 0, deductions: 0, net: 0 });
    const totalWorkedMinutes = hoursMonths.reduce((sum, bucket) => sum + bucket.workedMinutes, 0);
    const overtimeMinutes = overtimeMonths.reduce((sum, bucket) => sum + bucket.workedMinutes, 0);
    const dutyDays = daysMonths.reduce((sum, bucket) => sum + bucket.dutyDays, 0);
    const unratedShifts = earningsMonths.reduce((sum, bucket) => sum + bucket.shiftsUnrated, 0);

    return {
      mode,
      title,
      header,
      empty: shifts.length === 0 && inRangePaydays.length === 0,
      range: selectedRange,
      summary: [
        { label: 'Total worked time', minutes: totalWorkedMinutes, value: formatWorkedMinutes(totalWorkedMinutes) },
        { label: 'Overtime hours', minutes: overtimeMinutes, value: formatWorkedMinutes(overtimeMinutes) },
        { label: 'Duty days', value: String(dutyDays) }
      ],
      charts: {
        hoursWeeks,
        hoursMonths,
        overtimeMonths,
        daysMonths,
        earningsMonths
      },
      jobs,
      ratedEmploymentIds: employments.filter((employment) => employment.hourly_rate != null).map((employment) => employment.id),
      paydays: {
        rows: inRangePaydays.map((entry) => ({
          payDate: entry.pay_date,
          job: employmentLabel(entry.employment_id, employments),
          period: periodLabel(entry.period_start, entry.period_end),
          grossCents: entry.gross == null ? null : moneyToCents(entry.gross),
          deductionsCents: moneyToCents(entry.deductions),
          netCents: moneyToCents(entry.net)
        })),
        totalsCents
      },
      unratedShifts
    };
  }

  const statusCounts = applicationsByStatus(applications);
  const jobSearchRange = monthRange(today, 6);
  const rows = applications.map((application) => ({
    dateApplied: application.date_applied,
    company: application.company,
    position: application.position,
    status: application.status,
    source: application.source || ''
  }));
  return {
    mode,
    title,
    header: {
      ...header,
      fromDate: jobSearchRange.fromDate,
      toDate: jobSearchRange.toDate,
      dateRange: `Trends: ${formatCalendarDate(jobSearchRange.fromDate)} – ${formatCalendarDate(jobSearchRange.toDate)}; table: all loaded applications`
    },
    empty: applications.length === 0,
    summary: [],
    statusCounts,
    charts: {
      applicationsWeeks: applicationsByWeek(applications, today, 8),
      applicationsMonths: applicationsByMonth(applications, today, 6)
    },
    response: responseRate(applications),
    applications: rows,
    truncated: applications.length >= applicationLimit,
    applicationLimit
  };
}

/** Render a print-ready report fragment. Dynamic text and generated chart labels are escaped. */
export function renderReportHtml(model) {
  const header = `<header class="report-header"><p class="report-brand">Workpath</p><h1>${escapeHtml(model.title)}</h1><p><strong>Date range:</strong> ${escapeHtml(model.header.dateRange)}</p><p><strong>Currency:</strong> ${escapeHtml(model.header.currency || 'Not set')}</p><p><strong>Generated on:</strong> ${escapeHtml(model.header.generatedAt)} (${escapeHtml(model.header.timeZone)})</p></header>`;
  if (model.empty) {
    return `<article class="workpath-report">${header}<p class="report-empty">No data in this range.</p></article>`;
  }
  const tiles = model.summary?.length
    ? `<section class="report-tiles" aria-label="Summary">${model.summary.map((item) => `<div class="report-tile"><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.value)}</strong></div>`).join('')}</section>`
    : '';
  const contents = model.mode === 'employed'
    ? renderEmployedContents(model)
    : renderJobSeekerContents(model);
  return `<article class="workpath-report">${header}${tiles}${contents}</article>`;
}

function renderEmployedContents(model) {
  const currency = model.header.currency;
  const hoursWeeks = model.charts.hoursWeeks;
  const hoursMonths = model.charts.hoursMonths;
  const overtimeMonths = model.charts.overtimeMonths;
  const daysMonths = model.charts.daysMonths;
  const earningsMonths = model.charts.earningsMonths;
  const sections = [
    chartSection('Hours per week · last 8 weeks', barChart({
      labels: hoursWeeks.map((bucket) => shortDate(bucket.startDate)),
      series: [{ name: 'Worked hours', values: hoursWeeks.map((bucket) => bucket.workedMinutes) }],
      valueFormat: formatHours,
      ariaLabel: 'Worked hours by week'
    })),
    chartSection(`Hours per month · last ${model.range} months`, barChart({
      labels: hoursMonths.map((bucket) => formatMonthLabel(bucket.month)),
      series: [{ name: 'Worked hours', values: hoursMonths.map((bucket) => bucket.workedMinutes) }],
      valueFormat: formatHours,
      ariaLabel: 'Worked hours by month'
    })),
    chartSection('Overtime per month', barChart({
      labels: overtimeMonths.map((bucket) => formatMonthLabel(bucket.month)),
      series: [{ name: 'Overtime hours', values: overtimeMonths.map((bucket) => bucket.workedMinutes) }],
      valueFormat: formatHours,
      ariaLabel: 'User-flagged overtime by month'
    })),
    chartSection('Duty vs. off days', barChart({
      labels: daysMonths.map((bucket) => formatMonthLabel(bucket.month)),
      series: [
        { name: 'Duty days', values: daysMonths.map((bucket) => bucket.dutyDays) },
        { name: 'Off, leave, sick, holiday', values: daysMonths.map((bucket) => bucket.offDays) }
      ],
      ariaLabel: 'Duty and non-duty dates by month'
    })),
    chartSection('Earnings by month', barChart({
      labels: earningsMonths.map((bucket) => formatMonthLabel(bucket.month)),
      series: [
        { name: 'Received (net)', values: earningsMonths.map((bucket) => bucket.netReceivedCents) },
        { name: 'Estimated (hours × rate)', values: earningsMonths.map((bucket) => bucket.estimatedCents) }
      ],
      valueFormat: (cents) => formatMoney(cents / 100, currency),
      ariaLabel: 'Net pay received and estimated pay by month'
    }), `Net is after deductions; estimates are before deductions and exclude overtime premiums and unrated shifts.${model.unratedShifts > 0 ? ` ${model.unratedShifts} unrated ${model.unratedShifts === 1 ? 'shift' : 'shifts'} in this range.` : ''}`)
  ];
  sections.push(renderJobTable(model.jobs, currency, model.ratedEmploymentIds), renderPaydaysTable(model.paydays, currency));
  return `<div class="report-sections">${sections.join('')}</div>`;
}

function renderJobSeekerContents(model) {
  const statuses = model.statusCounts;
  const statusChart = horizontalBars({
    labels: statuses.map((row) => APPLICATION_STATUS_LABELS[row.status] || row.status),
    values: statuses.map((row) => row.count),
    ariaLabel: 'Job applications by status'
  });
  const statusPills = `<div class="report-status-pills">${statuses.map((row) => `<span class="status-badge status-${escapeHtml(row.status.replace('_', '-'))}">${escapeHtml(APPLICATION_STATUS_LABELS[row.status] || row.status)}: ${row.count}</span>`).join('')}</div>`;
  const weeks = model.charts.applicationsWeeks;
  const months = model.charts.applicationsMonths;
  const sections = [
    chartSection('Applications by status', statusPills + statusChart),
    chartSection('Applications per week · last 8 weeks', barChart({
      labels: weeks.map((bucket) => shortDate(bucket.startDate)),
      series: [{ name: 'Applications', values: weeks.map((bucket) => bucket.applications) }],
      ariaLabel: 'Applications per week'
    })),
    chartSection('Applications per month · last 6 months', barChart({
      labels: months.map((bucket) => formatMonthLabel(bucket.month)),
      series: [{ name: 'Applications', values: months.map((bucket) => bucket.applications) }],
      ariaLabel: 'Applications per month'
    })),
    `<section class="report-section"><h2>Response rate</h2><p class="report-response">${escapeHtml(model.response.rate === null ? 'Not enough data yet' : `${Math.round(model.response.rate * 100)}%`)} <span>(${model.response.responded} of ${model.response.total} applications changed from pending)</span></p></section>`,
    renderApplicationsTable(model)
  ];
  if (model.truncated) sections.unshift(`<p class="report-limit-note">Showing the most recent ${model.applicationLimit.toLocaleString()} applications.</p>`);
  return `<div class="report-sections">${sections.join('')}</div>`;
}

function renderJobTable(rows, currency, ratedEmploymentIds) {
  const body = rows.map((row) => {
    const estimate = row.employmentId !== null && ratedEmploymentIds.includes(row.employmentId)
      ? formatMoney(row.estimatedCents / 100, currency)
      : '—';
    return `<tr><th scope="row">${escapeHtml(row.label)}</th><td>${escapeHtml(formatWorkedMinutes(row.minutes))}</td><td>${escapeHtml(estimate)}</td><td>${escapeHtml(formatMoney(row.netReceivedCents / 100, currency))}</td></tr>`;
  }).join('');
  return `<section class="report-section"><h2>Per-job summary</h2><table><thead><tr><th scope="col">Job</th><th scope="col">Hours</th><th scope="col">Estimated pay</th><th scope="col">Net received</th></tr></thead><tbody>${body}</tbody></table></section>`;
}

function renderPaydaysTable(paydays, currency) {
  const rows = paydays.rows.map((row) => `<tr><td>${escapeHtml(formatCalendarDate(row.payDate))}</td><td>${escapeHtml(row.job)}</td><td>${escapeHtml(row.period)}</td><td>${escapeHtml(row.grossCents === null ? '—' : formatMoney(row.grossCents / 100, currency))}</td><td>${escapeHtml(formatMoney(row.deductionsCents / 100, currency))}</td><td>${escapeHtml(formatMoney(row.netCents / 100, currency))}</td></tr>`).join('');
  const totals = paydays.totalsCents;
  const totalsRow = `<tr class="report-total-row"><th scope="row" colspan="3">Totals</th><td>${escapeHtml(formatMoney(totals.gross / 100, currency))}</td><td>${escapeHtml(formatMoney(totals.deductions / 100, currency))}</td><td>${escapeHtml(formatMoney(totals.net / 100, currency))}</td></tr>`;
  return `<section class="report-section"><h2>Paydays</h2><table><thead><tr><th scope="col">Pay date</th><th scope="col">Job</th><th scope="col">Period</th><th scope="col">Gross</th><th scope="col">Deductions</th><th scope="col">Net</th></tr></thead><tbody>${rows}${totalsRow}</tbody></table></section>`;
}

function renderApplicationsTable(model) {
  const rows = model.applications.map((row) => `<tr><td>${escapeHtml(formatCalendarDate(row.dateApplied))}</td><td>${escapeHtml(row.company)}</td><td>${escapeHtml(row.position)}</td><td><span class="status-badge status-${escapeHtml(row.status.replace('_', '-'))}">${escapeHtml(APPLICATION_STATUS_LABELS[row.status] || row.status)}</span></td><td>${escapeHtml(row.source)}</td></tr>`).join('');
  return `<section class="report-section"><h2>Applications</h2><table><thead><tr><th scope="col">Date applied</th><th scope="col">Company</th><th scope="col">Position</th><th scope="col">Status</th><th scope="col">Source</th></tr></thead><tbody>${rows}</tbody></table></section>`;
}

function chartSection(title, chart, note = '') {
  return `<section class="report-section report-chart-section"><h2>${escapeHtml(title)}</h2>${chart}${note ? `<p class="report-note">${escapeHtml(note)}</p>` : ''}</section>`;
}

function employmentLabel(employmentId, employments) {
  const employment = employments.find((item) => item.id === employmentId);
  return employment ? (employment.job_title ? `${employment.employer_name} · ${employment.job_title}` : employment.employer_name) : 'No employer';
}

function periodLabel(start, end) {
  if (start && end) return `${formatCalendarDate(start)} – ${formatCalendarDate(end)}`;
  if (start) return `From ${formatCalendarDate(start)}`;
  if (end) return `Through ${formatCalendarDate(end)}`;
  return '—';
}

function formatCalendarDate(value) {
  if (!value) return '—';
  const date = new Date(`${value}T12:00:00.000Z`);
  if (!Number.isFinite(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', dateStyle: 'medium' }).format(date);
}

function formatGeneratedAt(value, timeZone) {
  const date = new Date(value);
  const formatted = Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat(undefined, { timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(date)
    : String(value);
  return formatted;
}

function formatHours(minutes) {
  const hours = Math.max(0, Number(minutes) || 0) / 60;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
}

function shortDate(value) {
  const [year, month, day] = value.split('-').map(Number);
  return new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', month: 'short', day: 'numeric' })
    .format(new Date(Date.UTC(year, month - 1, day, 12)));
}

function moneyToCents(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round((amount + Number.EPSILON) * 100) : 0;
}

function validTimeZone(value) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}
