import { el, field, makeButton, pageCard } from '../shared/dom.js';
import { formatMoney } from '../shared/money.js';
import { compareToEstimate, estimatePay, findPeriodAnchor, getPayPeriod } from '../shared/payroll.js';
import { formatWorkedMinutes } from '../shared/aggregations.js';
import { todayInTimeZone } from '../shared/time.js';
import { createIcon } from '../shared/icons.js';
import { renderEmployedNavigation } from './navigation.js';

export function renderPayrollPage({ repo, profile }) {
  const page = el('div', { className: 'page-wrap authenticated-page employed-page payroll-page' });
  const card = pageCard('Pay', 'Track paydays and compare gross pay with an estimate from your hours.');
  const message = el('p', { className: 'status-message', attrs: { role: 'status' } });
  const summary = el('section', {
    className: 'month-summary payroll-summary',
    attrs: { 'aria-label': 'Pay period summary', 'aria-busy': 'true' }
  });
  const estimateNote = el('p', { className: 'muted-copy payroll-estimate-note' });
  const formSlot = el('div');
  const list = el('div', { className: 'record-list payroll-list' });
  const addButton = makeButton('', { className: 'button button-primary floating-add-button' });
  addButton.setAttribute('aria-label', 'Add a payday');
  addButton.title = 'Add a payday';
  addButton.append(createIcon('plus'));
  card.append(message, summary, estimateNote, formSlot, list);
  page.append(card, addButton, renderEmployedNavigation('/employed/pay'));

  let entries = [];
  let employments = [];
  let shifts = [];
  let currentPeriod = null;
  let estimatesByPeriod = new Map();

  addButton.addEventListener('click', () => openForm());
  void loadPage();

  async function loadPage() {
    setMessage(message, 'Loading paydays…', 'loading');
    setPageButtonsBusy(true);
    summary.replaceChildren(...Array.from({ length: 4 }, () => summarySkeleton()));
    try {
      [entries, employments] = await Promise.all([
        repo.payrollEntries.list(),
        repo.employments.list()
      ]);
      const today = todayInTimeZone(profile.timezone);
      const anchor = findPeriodAnchor(entries);
      currentPeriod = profile.pay_frequency
        ? getPayPeriod(today, profile.pay_frequency, anchor)
        : null;

      const periods = entries
        .filter((entry) => entry.period_start && entry.period_end)
        .map((entry) => ({ start: entry.period_start, end: entry.period_end }));
      if (currentPeriod) periods.push(currentPeriod);
      if (periods.length) {
        const fromDate = periods.reduce((min, period) => period.start < min ? period.start : min, periods[0].start);
        const toDate = periods.reduce((max, period) => period.end > max ? period.end : max, periods[0].end);
        shifts = await repo.shifts.listBetween(fromDate, toDate);
      } else {
        shifts = [];
      }

      estimatesByPeriod = new Map();
      for (const period of periods) {
        const key = periodKey(period.start, period.end);
        if (!estimatesByPeriod.has(key)) {
          estimatesByPeriod.set(key, estimatePay({ shifts, employments, fromDate: period.start, toDate: period.end }));
        }
      }
      renderSummary(today);
      renderEstimateNote();
      renderList();
      setMessage(message, '', 'status');
    } catch (error) {
      summary.replaceChildren();
      summary.setAttribute('aria-busy', 'false');
      list.replaceChildren();
      estimateNote.textContent = '';
      setMessage(message, error.message || 'We could not load payroll. Check your connection and try again.', 'error');
    } finally {
      setPageButtonsBusy(false);
    }
  }

  function renderSummary(today) {
    summary.replaceChildren();
    const estimate = currentPeriod
      ? estimatesByPeriod.get(periodKey(currentPeriod.start, currentPeriod.end))
      : null;
    const currentMonth = getPayPeriod(today, 'monthly');
    const monthNetCents = entries
      .filter((entry) => entry.pay_date >= currentMonth.start && entry.pay_date <= currentMonth.end)
      .reduce((sum, entry) => sum + toCents(entry.net), 0);
    const periodLabel = currentPeriod
      ? formatDate(currentPeriod.start) + ' – ' + formatDate(currentPeriod.end)
      : profile.pay_frequency === 'biweekly'
        ? 'Log a payday with its period dates to see your current period'
        : 'Set a pay frequency in Settings to see your current period';

    summary.append(
      summaryItem('Current pay period', periodLabel, currentPeriod ? '' : 'payroll-period-unavailable'),
      summaryItem('Estimated pay', estimate ? formatMoney(estimate.totalCents / 100, profile.currency) : '—'),
      summaryItem('Hours in period', estimate ? formatWorkedMinutes(estimate.minutesRated + estimate.minutesUnrated) : '—'),
      summaryItem('Net received this month', formatMoney(monthNetCents / 100, profile.currency))
    );
    summary.setAttribute('aria-busy', 'false');
  }

  function renderEstimateNote() {
    const estimate = currentPeriod
      ? estimatesByPeriod.get(periodKey(currentPeriod.start, currentPeriod.end))
      : null;
    estimateNote.textContent = 'Estimates use hourly rate × worked hours and exclude overtime premiums and unrated shifts.'
      + (estimate?.shiftsUnrated > 0
        ? ' ' + estimate.shiftsUnrated + ' unrated ' + (estimate.shiftsUnrated === 1 ? 'shift is' : 'shifts are') + ' excluded.'
        : '');
  }

  function renderList() {
    list.replaceChildren();
    if (!entries.length) {
      const empty = el('section', { className: 'empty-state' }, [
        el('h2', { text: 'No paydays yet' }),
        el('p', { text: 'Add what you were paid to compare it with an estimate from your logged hours.' }),
        makeButton('Add your first payday', { className: 'button button-primary' })
      ]);
      empty.querySelector('button').addEventListener('click', () => openForm());
      list.append(empty);
      return;
    }

    for (const entry of entries) {
      const item = el('article', { className: 'record-card payroll-entry-card' });
      const employment = employments.find((job) => job.id === entry.employment_id);
      const heading = el('div', { className: 'payroll-entry-heading' }, [
        el('div', {}, [
          el('h2', { text: formatDate(entry.pay_date) }),
          el('p', { className: 'record-subtitle', text: employment?.employer_name || 'No employer' })
        ]),
        el('strong', { className: 'payroll-net', text: formatMoney(entry.net, profile.currency) })
      ]);
      item.append(heading);

      if (entry.period_start || entry.period_end) {
        item.append(el('p', { className: 'record-meta', text: 'Period: '
          + (entry.period_start ? formatDate(entry.period_start) : '—') + ' – '
          + (entry.period_end ? formatDate(entry.period_end) : '—') }));
      }
      if (entry.gross != null) {
        item.append(el('p', { className: 'record-meta', text: 'Gross ' + formatMoney(entry.gross, profile.currency)
          + ' · Deductions ' + formatMoney(entry.deductions, profile.currency) }));
      }
      const periodEstimate = entry.period_start && entry.period_end
        ? estimatesByPeriod.get(periodKey(entry.period_start, entry.period_end))
        : null;
      const verdict = periodEstimate ? compareToEstimate(entry, periodEstimate.totalCents, periodEstimate.minutesRated) : null;
      if (verdict) item.append(verdictBadge(verdict));
      if (entry.notes) item.append(el('p', { className: 'record-meta payroll-notes', text: entry.notes }));

      const actions = el('div', { className: 'record-actions' });
      const edit = makeButton('Edit', { className: 'button button-secondary' });
      edit.addEventListener('click', () => openForm(entry));
      const remove = makeButton('Delete', { className: 'button button-secondary' });
      remove.addEventListener('click', () => showDeleteConfirmation(entry, actions));
      actions.append(edit, remove);
      item.append(actions);
      list.append(item);
    }
  }

  function verdictBadge(verdict) {
    if (verdict.status === 'matches') {
      return el('span', { className: 'pay-verdict pay-verdict-matches', text: 'Matches estimate' });
    }
    return el('span', {
      className: 'pay-verdict pay-verdict-' + verdict.status,
      text: 'Gross is ' + formatMoney(verdict.differenceCents / 100, profile.currency) + ' ' + verdict.status + ' estimate'
    });
  }

  function openForm(entry = null) {
    const form = el('form', { className: 'record-form form-stack', attrs: { novalidate: '' } });
    const heading = el('h2', { text: entry ? 'Edit payday' : 'Add a payday' });
    const payDate = el('input', { attrs: { type: 'date', name: 'pay_date', required: '' } });
    payDate.value = entry?.pay_date || todayInTimeZone(profile.timezone);
    const employment = el('select', { attrs: { name: 'employment_id' } });
    employment.append(el('option', { text: 'No employer', attrs: { value: '' } }));
    for (const job of employments) {
      const label = job.employer_name + (job.job_title ? ' · ' + job.job_title : '');
      employment.append(el('option', { text: label, attrs: { value: job.id } }));
    }
    if (entry) {
      if (entry.employment_id) employment.value = entry.employment_id;
    } else {
      const currentJobs = employments.filter((job) => job.is_current);
      if (currentJobs.length === 1) employment.value = currentJobs[0].id;
    }

    const periodStart = el('input', { attrs: { type: 'date', name: 'period_start' } });
    const periodEnd = el('input', { attrs: { type: 'date', name: 'period_end' } });
    periodStart.value = entry?.period_start || '';
    periodEnd.value = entry?.period_end || '';
    const gross = amountInput('gross', entry?.gross ?? '', false);
    const deductions = amountInput('deductions', entry?.deductions ?? 0, false);
    const net = amountInput('net', entry?.net ?? '', true);
    const notes = el('textarea', { attrs: { name: 'notes', rows: '3' } });
    notes.value = entry?.notes || '';

    const periodFeedback = el('p', { className: 'muted-copy period-fill-hint', attrs: { role: 'status' } });
    const fillPeriod = makeButton('Fill period dates', { className: 'button button-secondary' });
    fillPeriod.addEventListener('click', () => {
      periodFeedback.textContent = '';
      const period = getPayPeriod(payDate.value, profile.pay_frequency, findPeriodAnchor(entries));
      if (!period) {
        periodFeedback.textContent = 'Log a payday with period dates before filling a biweekly period.';
        return;
      }
      periodStart.value = period.start;
      periodEnd.value = period.end;
      periodStart.dispatchEvent(new Event('input', { bubbles: true }));
    });

    form.append(
      heading,
      field('Pay date', payDate),
      field('Employer (optional)', employment),
      el('div', { className: 'pay-period-fields' }, [
        field('Period start (optional)', periodStart),
        field('Period end (optional)', periodEnd)
      ]),
      fillPeriod,
      periodFeedback,
      field('Gross (optional)', gross),
      field('Deductions', deductions),
      field('Net', net),
      field('Notes (optional)', notes)
    );
    const feedback = el('p', { className: 'status-message', attrs: { role: 'alert' } });
    const save = makeButton(entry ? 'Save payday' : 'Add payday', { type: 'submit', className: 'button button-primary' });
    const cancel = makeButton('Cancel', { className: 'button button-secondary' });
    const actions = el('div', { className: 'record-actions' }, [save, cancel]);
    form.append(feedback, actions);

    cancel.addEventListener('click', () => formSlot.replaceChildren());
    for (const control of [payDate, employment, periodStart, periodEnd]) {
      control.addEventListener('change', () => { periodFeedback.textContent = ''; });
    }
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      feedback.textContent = '';
      const values = {
        pay_date: payDate.value,
        employment_id: employment.value || null,
        period_start: periodStart.value || null,
        period_end: periodEnd.value || null,
        gross: gross.value === '' ? null : Number(gross.value),
        deductions: deductions.value === '' ? 0 : Number(deductions.value),
        net: net.value === '' ? null : Number(net.value),
        notes: notes.value.trim() || null
      };
      setFormBusy(form, true);
      try {
        if (entry) await repo.payrollEntries.update(entry.id, values);
        else await repo.payrollEntries.create(values);
        formSlot.replaceChildren();
        await loadPage();
      } catch (error) {
        feedback.textContent = error.message || 'We could not save this payday. Check the details and try again.';
      } finally {
        setFormBusy(form, false);
      }
    });
    formSlot.replaceChildren(form);
    payDate.focus();
  }

  function amountInput(name, value, required) {
    const input = el('input', { attrs: {
      type: 'number', name, min: '0', max: '9999999999.99', step: '0.01'
    } });
    input.value = value;
    if (required) input.required = true;
    return input;
  }

  function showDeleteConfirmation(entry, actions) {
    actions.replaceChildren(el('p', { className: 'inline-confirmation-copy', text: 'Delete this payday? This cannot be undone.' }));
    const confirm = makeButton('Delete payday', { className: 'button button-danger' });
    const cancel = makeButton('Keep payday', { className: 'button button-secondary' });
    actions.append(confirm, cancel);
    cancel.addEventListener('click', renderList);
    confirm.addEventListener('click', async () => {
      setPageButtonsBusy(true);
      try {
        await repo.payrollEntries.remove(entry.id);
        await loadPage();
      } catch (error) {
        setMessage(message, error.message || 'We could not delete this payday. Please try again.', 'error');
      } finally {
        setPageButtonsBusy(false);
      }
    });
  }

  function setPageButtonsBusy(busy) {
    for (const button of page.querySelectorAll('button')) button.disabled = busy;
  }

  function setMessage(element, text, kind) {
    element.textContent = text;
    element.className = 'status-message' + (kind === 'error' ? ' status-error' : '');
    element.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    element.hidden = !text;
  }

  return page;
}

function summaryItem(label, value, valueClass = '') {
  return el('div', { className: 'summary-item' }, [
    el('span', { className: 'summary-label', text: label }),
    el('strong', { className: 'summary-value ' + valueClass, text: value })
  ]);
}

function summarySkeleton() {
  return el('div', { className: 'summary-item summary-skeleton', attrs: { 'aria-hidden': 'true' } }, [
    el('span', { className: 'skeleton-line skeleton-label' }),
    el('span', { className: 'skeleton-line skeleton-value' })
  ]);
}

function periodKey(start, end) {
  return start + '|' + end;
}

function formatDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', dateStyle: 'medium' })
    .format(new Date(value + 'T12:00:00.000Z'));
}

function toCents(amount) {
  return Math.round((Number(amount) + Number.EPSILON) * 100);
}

function setFormBusy(form, busy) {
  for (const control of form.querySelectorAll('input, select, textarea, button')) control.disabled = busy;
}
