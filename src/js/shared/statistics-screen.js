import { APPLICATION_STATUS_LABELS } from '../job-seeker/helpers.js';
import { renderEmployedNavigation } from '../employed/navigation.js';
import { renderJobSeekerNavigation } from '../job-seeker/navigation.js';
import { el, field, makeButton, pageCard } from './dom.js';
import { formatMoney } from './money.js';
import { formatWorkedMinutes } from './aggregations.js';
import { formatMonthLabel, todayInTimeZone } from './time.js';
import { barChart, horizontalBars } from './charts.js';
import { printReport } from './files.js';
import { buildReportModel, renderReportHtml } from './report.js';
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

const APPLICATION_LIMIT = 5000;
const STATUS_ORDER = ['pending', 'interview', 'offer', 'rejected', 'no_response'];
const RANGE_OPTIONS = [3, 6, 12];

export function renderEmployedStatisticsPage({ repo, profile, selectedRange = 6, onRangeChange = () => {} }) {
  return renderStatisticsPage({
    mode: 'employed', repo, profile, selectedRange, onRangeChange
  });
}

export function renderJobSeekerStatisticsPage({ repo, profile }) {
  return renderStatisticsPage({ mode: 'job_seeker', repo, profile });
}

function renderStatisticsPage({ mode, repo, profile, selectedRange, onRangeChange }) {
  const employed = mode === 'employed';
  const page = el('div', { className: `page-wrap authenticated-page ${employed ? 'employed-page' : 'seeker-page'} stats-page` });
  const card = pageCard('Stats', employed
    ? 'See your hours, pay, and work patterns over time.'
    : 'See how your job search is moving over time.');
  const message = el('p', { className: 'status-message', attrs: { role: 'status', 'aria-live': 'polite' } });
  const latestNote = el('p', { className: 'muted-copy stats-limit-note' });
  latestNote.hidden = true;
  const rangeSelect = el('select', { attrs: { name: 'stats_range', 'aria-label': 'Time range' } });
  for (const months of RANGE_OPTIONS) {
    rangeSelect.append(el('option', { text: `Last ${months} months`, attrs: { value: months } }));
  }
  rangeSelect.value = String(RANGE_OPTIONS.includes(Number(selectedRange)) ? Number(selectedRange) : 6);
  const controls = employed ? field('Time range', rangeSelect, { className: 'field stats-range-field' }) : null;
  const exportButton = makeButton('Export PDF', { className: 'button button-secondary', disabled: true });
  const toolbar = el('div', { className: 'stats-page-toolbar' }, [
    ...(controls ? [controls] : []),
    exportButton
  ]);
  const summary = el('section', {
    className: `month-summary stats-summary ${employed ? 'stats-summary-three' : 'stats-summary-single'}`,
    attrs: { 'aria-label': employed ? 'Work statistics summary' : 'Job search statistics summary' }
  });
  const content = el('div', { className: 'stats-content' });
  card.append(toolbar, message, latestNote, summary, content);
  page.append(card, employed
    ? renderEmployedNavigation('/employed/stats')
    : renderJobSeekerNavigation('/seeker/stats'));

  let loadVersion = 0;
  let range = Number(rangeSelect.value);
  let reportData = null;
  exportButton.addEventListener('click', () => {
    if (!reportData) return;
    try {
      const model = buildReportModel(reportData);
      printReport({ title: model.title, render: () => renderReportHtml(model) });
      setMessage(message, '', 'status');
    } catch (error) {
      setMessage(message, error.message || "Printing isn't available here.", 'error');
    }
  });
  rangeSelect.addEventListener('change', () => {
    range = RANGE_OPTIONS.includes(Number(rangeSelect.value)) ? Number(rangeSelect.value) : 6;
    rangeSelect.value = String(range);
    onRangeChange(range);
    void load();
  });

  void load();
  return page;

  async function load() {
    const version = ++loadVersion;
    reportData = null;
    exportButton.disabled = true;
    setMessage(message, 'Loading statistics…', 'loading');
    rangeSelect.disabled = true;
    summary.setAttribute('aria-busy', 'true');
    renderSummarySkeletons(summary, employed ? 3 : 1);
    renderChartSkeletons(content, employed ? 6 : 3);
    latestNote.hidden = true;
    try {
      const today = todayInTimeZone(profile.timezone || 'UTC');
      if (employed) {
        const rangeDates = monthRange(today, range);
        const [shifts, payrollEntries, employments] = await Promise.all([
          repo.shifts.listBetween(rangeDates.fromDate, rangeDates.toDate),
          repo.payrollEntries.listBetween(rangeDates.fromDate, rangeDates.toDate),
          repo.employments.list()
        ]);
        if (version !== loadVersion) return;
        renderEmployedStats({ summary, content, shifts, payrollEntries, employments, today, range, rangeDates, profile });
        reportData = { mode, profile, today, range, rangeDates, shifts, payrollEntries, employments };
      } else {
        const applications = await repo.applications.list({ limit: APPLICATION_LIMIT });
        if (version !== loadVersion) return;
        renderJobSeekerStats({ summary, content, applications, today });
        latestNote.hidden = applications.length < APPLICATION_LIMIT;
        if (!latestNote.hidden) latestNote.textContent = `Showing the most recent ${APPLICATION_LIMIT.toLocaleString()} applications.`;
        reportData = { mode, profile, today, applications, applicationLimit: APPLICATION_LIMIT };
      }
      exportButton.disabled = false;
      setMessage(message, '', 'status');
    } catch (error) {
      if (version !== loadVersion) return;
      summary.replaceChildren();
      summary.setAttribute('aria-busy', 'false');
      content.replaceChildren();
      const failure = el('section', { className: 'empty-state stats-error', attrs: { role: 'alert' } }, [
        el('p', {
          className: 'status-message status-error',
          text: error.message || 'We could not load your statistics. Check your connection and try again.'
        }),
        makeButton('Try again', { className: 'button button-secondary' })
      ]);
      failure.querySelector('button').addEventListener('click', () => { void load(); });
      content.append(failure);
      setMessage(message, '', 'status');
    } finally {
      if (version === loadVersion) rangeSelect.disabled = false;
    }
  }
}

function renderEmployedStats({ summary, content, shifts, payrollEntries, employments, today, range, rangeDates, profile }) {
  const hoursMonths = hoursByMonth(shifts, today, range);
  const overtimeMonths = overtimeByMonth(shifts, today, range);
  const daysMonths = dutyDaysByMonth(shifts, today, range);
  const hoursWeeks = hoursByWeek(shifts, today, 8);
  const earnings = earningsByMonth({ payrollEntries, shifts, employments, endDate: today, count: range });
  const jobs = perJob({ shifts, employments, payrollEntries, fromDate: rangeDates.fromDate, toDate: rangeDates.toDate });
  const totalMinutes = sumValues(hoursMonths, 'workedMinutes');
  const overtimeMinutes = sumValues(overtimeMonths, 'workedMinutes');
  const dutyDays = sumValues(daysMonths, 'dutyDays');
  const unratedShifts = sumValues(earnings, 'shiftsUnrated');

  summary.replaceChildren(
    summaryTile('Total worked time', formatWorkedMinutes(totalMinutes)),
    summaryTile('Overtime hours', formatWorkedMinutes(overtimeMinutes)),
    summaryTile('Duty days', String(dutyDays))
  );
  summary.setAttribute('aria-busy', 'false');

  const noData = shifts.length === 0 && payrollEntries.length === 0;
  content.replaceChildren();
  if (noData) {
    content.append(emptyState('No work or payday data in this range yet.', [
      ['Log a shift', '#/employed/shifts'], ['Add a payday', '#/employed/pay']
    ]));
  }

  content.append(
    chartPanel('Hours per week · last 8 weeks', barChart({
      labels: hoursWeeks.map((bucket) => shortDate(bucket.startDate)),
      series: [{ name: 'Worked hours', values: hoursWeeks.map((bucket) => bucket.workedMinutes) }],
      valueFormat: (minutes, { compact }) => formatHours(minutes, compact),
      ariaLabel: 'Worked hours in each of the last eight Monday-to-Sunday weeks'
    })),
    chartPanel(`Hours per month · last ${range} months`, barChart({
      labels: hoursMonths.map((bucket) => formatMonthLabel(bucket.month)),
      series: [{ name: 'Worked hours', values: hoursMonths.map((bucket) => bucket.workedMinutes) }],
      valueFormat: (minutes, { compact }) => formatHours(minutes, compact),
      ariaLabel: `Worked hours for the last ${range} calendar months`
    })),
    chartPanel('Overtime hours per month', barChart({
      labels: overtimeMonths.map((bucket) => formatMonthLabel(bucket.month)),
      series: [{ name: 'Overtime hours', values: overtimeMonths.map((bucket) => bucket.workedMinutes) }],
      valueFormat: (minutes, { compact }) => formatHours(minutes, compact),
      ariaLabel: `User-flagged overtime hours for the last ${range} calendar months`
    })),
    chartPanel('Duty vs. off days per month', barChart({
      labels: daysMonths.map((bucket) => formatMonthLabel(bucket.month)),
      series: [
        { name: 'Duty days', values: daysMonths.map((bucket) => bucket.dutyDays) },
        { name: 'Off, leave, sick, holiday', values: daysMonths.map((bucket) => bucket.offDays) }
      ],
      valueFormat: (value, { compact }) => compact ? compactNumber(value) : String(value),
      ariaLabel: `Distinct duty days and dates containing only off, leave, sick, or holiday shifts for the last ${range} months`
    })),
    chartPanel('Earnings by month', barChart({
      labels: earnings.map((bucket) => formatMonthLabel(bucket.month)),
      series: [
        { name: 'Received (net)', values: earnings.map((bucket) => bucket.netReceivedCents) },
        { name: 'Estimated (hours × rate)', values: earnings.map((bucket) => bucket.estimatedCents) }
      ],
      valueFormat: (cents, { compact }) => formatCents(cents, profile.currency, compact),
      ariaLabel: `Logged net pay received and estimated gross pay for the last ${range} months`
    }), `Net is after deductions; the estimate is before deductions. Estimates use rated hours, exclude overtime premiums, and exclude shifts without an hourly rate.${unratedShifts > 0 ? ` ${unratedShifts} unrated ${unratedShifts === 1 ? 'shift' : 'shifts'} in this range.` : ''}`),
    jobTable(jobs, employments, profile.currency)
  );
}

function renderJobSeekerStats({ summary, content, applications, today }) {
  const counts = applicationsByStatus(applications);
  const rate = responseRate(applications);
  const weeks = applicationsByWeek(applications, today, 8);
  const months = applicationsByMonth(applications, today, 6);
  const interviews = counts.find((row) => row.status === 'interview')?.count || 0;
  const offers = counts.find((row) => row.status === 'offer')?.count || 0;

  summary.replaceChildren(summaryTile('Applications', String(applications.length)));
  summary.setAttribute('aria-busy', 'false');
  content.replaceChildren();
  if (!applications.length) {
    content.append(emptyState('Your application stats will appear after you add an application.', [
      ['Add your first application', '#/seeker/applications?add=1']
    ]));
  }

  const statuses = el('section', { className: 'stats-section stats-status-section' }, [
    el('h2', { text: 'Applications by status' })
  ]);
  const pills = el('div', { className: 'stats-status-pills', attrs: { 'aria-label': 'Application status counts' } });
  for (const row of counts) {
    pills.append(el('span', { className: `status-badge status-${row.status.replace('_', '-')}` }, [
      document.createTextNode(`${APPLICATION_STATUS_LABELS[row.status]} `),
      el('strong', { text: String(row.count) })
    ]));
  }
  statuses.append(pills, chartMount(horizontalBars({
    labels: STATUS_ORDER.map((status) => APPLICATION_STATUS_LABELS[status]),
    values: STATUS_ORDER.map((status) => counts.find((row) => row.status === status)?.count || 0),
    ariaLabel: 'Job applications grouped by status'
  })));

  content.append(
    statuses,
    chartPanel('Applications per week · last 8 weeks', barChart({
      labels: weeks.map((bucket) => shortDate(bucket.startDate)),
      series: [{ name: 'Applications', values: weeks.map((bucket) => bucket.applications) }],
      ariaLabel: 'Applications by date applied in each of the last eight Monday-to-Sunday weeks'
    })),
    chartPanel('Applications per month · last 6 months', barChart({
      labels: months.map((bucket) => formatMonthLabel(bucket.month)),
      series: [{ name: 'Applications', values: months.map((bucket) => bucket.applications) }],
      ariaLabel: 'Applications by date applied for the last six calendar months'
    })),
    responseRateTile(rate, interviews, offers)
  );
}

function chartPanel(title, markup, note = '') {
  const section = el('section', { className: 'stats-section' }, [el('h2', { text: title }), chartMount(markup)]);
  if (note) section.append(el('p', { className: 'muted-copy stats-chart-note', text: note }));
  return section;
}

function chartMount(markup) {
  const mount = el('div', { className: 'stats-chart-mount' });
  const parsed = new DOMParser().parseFromString(markup, 'text/html');
  if (parsed.body.firstElementChild) mount.append(document.importNode(parsed.body.firstElementChild, true));
  return mount;
}

function jobTable(rows, employments, currency) {
  const section = el('section', { className: 'stats-section stats-job-section' }, [el('h2', { text: 'Per-job summary' })]);
  const table = el('table', { className: 'stats-job-table' });
  table.append(el('caption', { text: 'Hours and pay by job for the selected range' }));
  const head = el('thead', {}, [el('tr', {}, ['Job', 'Hours', 'Estimated', 'Net received'].map((label) => el('th', { text: label, attrs: { scope: 'col' } })))]);
  const body = el('tbody');
  for (const row of rows) {
    const employment = employments.find((item) => item.id === row.employmentId);
    const estimate = row.employmentId === null || !employment || employment.hourly_rate == null
      ? '—'
      : formatMoney(row.estimatedCents / 100, currency);
    body.append(el('tr', {}, [
      el('th', { text: row.label, attrs: { scope: 'row' } }),
      el('td', { text: formatWorkedMinutes(row.minutes) }),
      el('td', { text: estimate }),
      el('td', { text: formatMoney(row.netReceivedCents / 100, currency) })
    ]));
  }
  table.append(head, body);
  section.append(el('div', { className: 'stats-table-scroll' }, [table]));
  return section;
}

function responseRateTile(rate) {
  const value = rate.rate === null ? 'Not enough data yet' : `${Math.round(rate.rate * 100)}%`;
  const tile = el('section', { className: 'stats-section stats-response-rate', attrs: { 'aria-label': 'Response rate' } }, [
    el('h2', { text: 'Response rate' }),
    summaryTile(`${rate.responded} of ${rate.total} applications changed from pending`, value)
  ]);
  return tile;
}

function summaryTile(label, value) {
  return el('div', { className: 'summary-item' }, [
    el('span', { className: 'summary-label', text: label }),
    el('strong', { className: 'summary-value', text: value })
  ]);
}

function renderSummarySkeletons(summary, count) {
  summary.replaceChildren();
  for (let index = 0; index < count; index += 1) {
    summary.append(el('div', { className: 'summary-item summary-skeleton', attrs: { 'aria-hidden': 'true' } }, [
      el('span', { className: 'skeleton-line skeleton-label' }),
      el('span', { className: 'skeleton-line skeleton-value' })
    ]));
  }
}

function renderChartSkeletons(content, count) {
  content.replaceChildren();
  for (let index = 0; index < count; index += 1) {
    content.append(el('section', { className: 'stats-section stats-chart-skeleton', attrs: { 'aria-hidden': 'true' } }, [
      el('span', { className: 'skeleton-line skeleton-label' }),
      el('span', { className: 'skeleton-line skeleton-chart' })
    ]));
  }
}

function emptyState(message, links) {
  const section = el('section', { className: 'empty-state stats-empty-state' }, [el('p', { text: message })]);
  const actions = el('div', { className: 'stats-empty-actions' });
  links.forEach(([label, href], index) => {
    actions.append(el('a', {
      className: `button ${index === 0 ? 'button-primary' : 'button-secondary'}`,
      text: label,
      attrs: { href }
    }));
  });
  section.append(actions);
  return section;
}

function setMessage(element, message, kind) {
  element.textContent = message || '';
  element.className = 'status-message' + (message ? ` status-${kind}` : '');
  element.hidden = !message;
  element.setAttribute('role', kind === 'error' ? 'alert' : 'status');
}

function sumValues(rows, property) {
  return rows.reduce((sum, row) => sum + Number(row[property] || 0), 0);
}

function formatHours(minutes, compact) {
  const hours = Math.max(0, Number(minutes) || 0) / 60;
  return compact ? `${compactNumber(hours)}h` : `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
}

function formatCents(cents, currency, compact) {
  const amount = Number(cents) / 100;
  if (compact) {
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1
      }).format(amount);
    } catch {
      return compactNumber(amount);
    }
  }
  return formatMoney(amount, currency);
}

function compactNumber(value) {
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

function shortDate(value) {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  return new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(date);
}
