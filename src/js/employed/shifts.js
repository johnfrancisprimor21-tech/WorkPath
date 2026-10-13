import { el, field, makeButton, pageCard } from '../shared/dom.js';
import {
  addCalendarDay,
  currentMonthInTimeZone,
  formatShiftDateLabel,
  formatMonthLabel,
  formatTime,
  localDateTimeToUtc,
  shiftMonth,
  todayInTimeZone,
  utcToLocalDateTime
} from '../shared/time.js';
import { renderEmployedNavigation } from './navigation.js';
import { createIcon } from '../shared/icons.js';
import { formatWorkedMinutes, summarizeShifts } from '../shared/aggregations.js';
import { monthDateRange, shiftsNewestFirst } from '../shared/shift-summary.js';

const DAY_TYPES = [
  ['duty', 'Duty'],
  ['off', 'Off'],
  ['leave', 'Leave'],
  ['sick', 'Sick'],
  ['holiday', 'Holiday']
];

export function renderShiftsPage({ repo, profile }) {
  const page = el('div', { className: 'page-wrap authenticated-page employed-page' });
  const card = pageCard('Shifts', 'Log work days, days off, and time worked.');
  page.append(card);

  let selectedMonth = currentMonthInTimeZone(profile.timezone);
  let jobs = [];
  let shifts = [];
  const message = el('p', { className: 'status-message', attrs: { role: 'status' } });
  const monthHeading = el('h2', { className: 'month-heading', text: formatMonthLabel(selectedMonth) });
  const previous = makeButton('', { className: 'button button-secondary month-arrow' });
  previous.setAttribute('aria-label', 'Previous month');
  previous.append(createIcon('previous'));
  const next = makeButton('', { className: 'button button-secondary month-arrow' });
  next.setAttribute('aria-label', 'Next month');
  next.append(createIcon('next'));
  const monthControls = el('div', { className: 'month-controls' }, [previous, monthHeading, next]);
  const summary = el('section', { className: 'month-summary', attrs: { 'aria-label': 'Monthly shift summary' } });
  const addButton = makeButton('', { className: 'button button-primary floating-add-button' });
  addButton.setAttribute('aria-label', 'Log a shift');
  addButton.title = 'Log a shift';
  addButton.append(createIcon('plus'));
  const formSlot = el('div');
  const list = el('div', { className: 'record-list' });
  card.append(message, monthControls, summary, formSlot, list);

  addButton.addEventListener('click', () => openForm());
  previous.addEventListener('click', () => changeMonth(-1));
  next.addEventListener('click', () => changeMonth(1));
  void loadPage();

  async function loadPage() {
    setMessage(message, 'Loading shifts…', 'loading');
    setControlsBusy(true);
    try {
      jobs = await repo.employments.list();
      await loadMonth();
    } catch (error) {
      setMessage(message, error.message || 'We could not load or save shifts. Check the details and try again.', 'error');
      list.replaceChildren();
      summary.replaceChildren();
    } finally {
      setControlsBusy(false);
    }
  }

  async function loadMonth() {
    setMessage(message, 'Loading shifts…', 'loading');
    setControlsBusy(true);
    try {
      const range = monthDateRange(selectedMonth);
      shifts = shiftsNewestFirst(await repo.shifts.listBetween(range.fromDate, range.toDate));
      monthHeading.textContent = formatMonthLabel(selectedMonth);
      renderSummary();
      renderList();
      setMessage(message, '', 'status');
    } catch (error) {
      shifts = [];
      list.replaceChildren();
      summary.replaceChildren();
      setMessage(message, error.message || 'We could not load or save shifts. Check the details and try again.', 'error');
    } finally {
      setControlsBusy(false);
    }
  }

  async function changeMonth(amount) {
    selectedMonth = shiftMonth(selectedMonth, amount);
    monthHeading.textContent = formatMonthLabel(selectedMonth);
    await loadMonth();
  }

  function renderSummary() {
    const values = summarizeShifts(shifts);
    summary.replaceChildren(
      summaryItem('Total worked time', formatWorkedMinutes(values.workedMinutes)),
      summaryItem('Overtime shifts', String(values.overtimeCount)),
      summaryItem('Days worked', String(values.daysWorked))
    );
  }

  function summaryItem(label, value) {
    return el('div', { className: 'summary-item' }, [
      el('span', { className: 'summary-label', text: label }),
      el('strong', { className: 'summary-value', text: value })
    ]);
  }

  function renderList() {
    list.replaceChildren();
    if (!shifts.length) {
      const empty = el('section', { className: 'empty-state' }, [
        el('h2', { text: 'No shifts this month' }),
        el('p', { text: 'Log a shift or day off to start your record.' }),
        makeButton('Log a shift', { className: 'button button-primary' })
      ]);
      empty.querySelector('button').addEventListener('click', () => openForm());
      list.append(empty);
      return;
    }

    const groups = new Map();
    for (const shift of shifts) {
      if (!groups.has(shift.work_date)) groups.set(shift.work_date, []);
      groups.get(shift.work_date).push(shift);
    }
    for (const [date, dayShifts] of groups) {
      const group = el('section', { className: 'shift-day-group' });
      group.append(el('h2', { className: 'shift-date-heading', text: formatShiftDateLabel(date, profile.timezone) }));
      for (const shift of dayShifts) group.append(renderShift(shift));
      list.append(group);
    }
  }

  function renderShift(shift) {
    const card = el('article', { className: 'record-card shift-card' });
    const dayLabel = DAY_TYPES.find(([value]) => value === shift.day_type)?.[1] || 'Shift';
    const job = jobs.find((entry) => entry.id === shift.employment_id);
    const identity = el('div', { className: 'shift-identity' });
    if (job) {
      identity.append(el('h3', { text: job.employer_name }));
      if (job.job_title) identity.append(el('p', { className: 'record-subtitle', text: job.job_title }));
    } else {
      identity.append(el('h3', {
        text: shift.employment_id ? 'Employer unavailable' : shift.day_type === 'duty' ? 'Work day' : dayLabel
      }));
    }
    card.append(el('div', { className: 'shift-card-heading' }, [
      identity,
      el('span', { className: 'day-type-badge day-type-' + shift.day_type, text: dayLabel })
    ]));

    if (shift.day_type === 'duty' && shift.time_in && shift.time_out) {
      const end = utcToLocalDateTime(shift.time_out, profile.timezone);
      const endLabel = formatTime(shift.time_out, profile.timezone)
        + (end.date !== shift.work_date ? ' (next day)' : '');
      card.append(el('p', { className: 'record-meta shift-time-range', text: formatTime(shift.time_in, profile.timezone) + ' - ' + endLabel }));
      card.append(el('p', { className: 'record-meta', text: 'Break: ' + Number(shift.break_minutes || 0) + ' min' }));
      card.append(el('span', { className: 'worked-time-badge', text: formatWorkedMinutes(Number(shift.worked_minutes || 0)) }));
    }
    if (shift.is_overtime) card.append(el('span', { className: 'overtime-badge', text: 'Overtime' }));
    if (shift.notes) card.append(el('p', { className: 'record-notes', text: shift.notes }));

    const actions = el('div', { className: 'record-actions' });
    const edit = makeButton('Edit', { className: 'button button-secondary' });
    edit.addEventListener('click', () => openForm(shift));
    const remove = makeButton('Delete', { className: 'button button-secondary' });
    remove.addEventListener('click', () => showDeleteConfirmation(shift, actions));
    actions.append(edit, remove);
    card.append(actions);
    return card;
  }

  function openForm(shift = null) {
    const form = el('form', { className: 'record-form form-stack', attrs: { novalidate: '' } });
    const heading = el('h2', { text: shift ? 'Edit shift' : 'Log a shift' });
    const dayType = el('select', { attrs: { name: 'day_type', required: '' } });
    for (const [value, label] of DAY_TYPES) dayType.append(el('option', { text: label, attrs: { value } }));
    dayType.value = shift?.day_type || 'duty';

    const workDate = el('input', { attrs: { type: 'date', name: 'work_date', required: '' } });
    workDate.value = shift?.work_date || todayInTimeZone(profile.timezone);

    const employment = el('select', { attrs: { name: 'employment_id' } });
    employment.append(el('option', { text: 'No employer', attrs: { value: '' } }));
    const currentJobs = jobs.filter((job) => job.is_current);
    for (const job of currentJobs) employment.append(jobOption(job));
    const linkedJob = shift && jobs.find((job) => job.id === shift.employment_id);
    if (linkedJob && !linkedJob.is_current) employment.append(jobOption(linkedJob, 'Past job: '));
    if (shift?.employment_id && linkedJob) employment.value = linkedJob.id;
    else if (!shift && currentJobs.length) employment.value = currentJobs[0].id;

    const timeFields = el('div', { className: 'shift-time-fields form-stack' });
    const timeIn = el('input', { attrs: { type: 'time', name: 'time_in', required: '' } });
    const timeOut = el('input', { attrs: { type: 'time', name: 'time_out', required: '' } });
    const breakMinutes = el('input', { attrs: { type: 'number', name: 'break_minutes', min: '0', step: '1' } });
    const overtime = el('input', { attrs: { type: 'checkbox', name: 'is_overtime' } });
    const endHint = el('small', { className: 'field-hint', text: 'Ends next day.' });
    endHint.hidden = true;
    if (shift?.time_in) timeIn.value = utcToLocalDateTime(shift.time_in, profile.timezone).time;
    if (shift?.time_out) timeOut.value = utcToLocalDateTime(shift.time_out, profile.timezone).time;
    breakMinutes.value = String(shift?.break_minutes ?? 0);
    overtime.checked = Boolean(shift?.is_overtime);
    const timeInField = field('Time in', timeIn);
    const timeOutField = field('Time out', timeOut);
    timeOutField.append(endHint);
    timeFields.append(timeInField, timeOutField, field('Break (minutes)', breakMinutes),
      el('label', { className: 'checkbox-control' }, [overtime, el('span', { text: 'Overtime shift' })]));

    const notes = el('textarea', { attrs: { name: 'notes', maxlength: '500', rows: '3' } });
    notes.value = shift?.notes || '';
    const feedback = el('p', { className: 'status-message', attrs: { role: 'alert' } });
    const save = makeButton(shift ? 'Save changes' : 'Save shift', { type: 'submit', className: 'button button-primary' });
    const cancel = makeButton('Cancel', { className: 'button button-secondary' });
    const actions = el('div', { className: 'record-actions' }, [save, cancel]);
    form.append(
      heading,
      field('Day type', dayType),
      field('Work date', workDate),
      field('Employer', employment),
      timeFields,
      field('Notes', notes),
      feedback,
      actions
    );

    function updateTimeFields() {
      const isDuty = dayType.value === 'duty';
      timeFields.hidden = !isDuty;
      timeIn.required = isDuty;
      timeOut.required = isDuty;
      updateEndHint();
    }

    function updateEndHint() {
      endHint.hidden = dayType.value !== 'duty' || !timeIn.value || !timeOut.value || timeOut.value > timeIn.value;
    }

    dayType.addEventListener('change', updateTimeFields);
    timeIn.addEventListener('input', updateEndHint);
    timeOut.addEventListener('input', updateEndHint);
    cancel.addEventListener('click', () => formSlot.replaceChildren());
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      feedback.textContent = '';
      const notesText = notes.value.trim();
      if (notesText.length > 500) {
        feedback.textContent = 'Notes must be 500 characters or fewer.';
        notes.focus();
        return;
      }
      let values;
      try {
        values = {
          employment_id: employment.value || null,
          work_date: workDate.value,
          day_type: dayType.value,
          notes: notesText || null,
          time_in: null,
          time_out: null,
          break_minutes: 0,
          is_overtime: false
        };
        if (!values.work_date) throw new Error('Choose a work date.');
        if (dayType.value === 'duty') {
          if (!timeIn.value || !timeOut.value) throw new Error('Enter both time in and time out for a duty day.');
          const overnight = timeOut.value <= timeIn.value;
          const endDate = overnight ? addCalendarDay(workDate.value) : workDate.value;
          values.time_in = localDateTimeToUtc(workDate.value, timeIn.value, profile.timezone);
          values.time_out = localDateTimeToUtc(endDate, timeOut.value, profile.timezone);
          const breakValue = Number(breakMinutes.value);
          if (!Number.isInteger(breakValue) || breakValue < 0) throw new Error('Break must be a whole number of zero or more minutes.');
          const durationMinutes = (Date.parse(values.time_out) - Date.parse(values.time_in)) / 60000;
          if (durationMinutes <= 0) throw new Error('Time out must be after time in.');
          if (breakValue > durationMinutes) throw new Error('Break cannot be longer than the shift.');
          values.break_minutes = breakValue;
          values.is_overtime = overtime.checked;
        }
      } catch (error) {
        feedback.textContent = error.message || 'Check the shift date and times.';
        return;
      }

      setPageButtonsBusy(true);
      setFormBusy(form, true);
      try {
        if (shift) await repo.shifts.update(shift.id, values);
        else await repo.shifts.create(values);
        formSlot.replaceChildren();
        await loadMonth();
      } catch (error) {
        feedback.textContent = error.message || 'We could not load or save shifts. Check the details and try again.';
      } finally {
        setFormBusy(form, false);
        setPageButtonsBusy(false);
      }
    });

    updateTimeFields();
    formSlot.replaceChildren(form);
    dayType.focus();
  }

  function jobOption(job, prefix = '') {
    return el('option', {
      text: prefix + job.employer_name,
      attrs: { value: job.id }
    });
  }

  function showDeleteConfirmation(shift, actions) {
    actions.replaceChildren(el('p', { className: 'inline-confirmation-copy', text: 'Delete this shift? This cannot be undone.' }));
    const confirm = makeButton('Delete shift', { className: 'button button-danger' });
    const cancel = makeButton('Keep shift', { className: 'button button-secondary' });
    actions.append(confirm, cancel);
    cancel.addEventListener('click', renderList);
    confirm.addEventListener('click', async () => {
      setPageButtonsBusy(true);
      try {
        await repo.shifts.remove(shift.id);
        await loadMonth();
      } catch (error) {
        setMessage(message, error.message || 'We could not load or save shifts. Check the details and try again.', 'error');
      } finally {
        setPageButtonsBusy(false);
      }
    });
  }

  function setPageButtonsBusy(busy) {
    for (const button of page.querySelectorAll('button')) button.disabled = busy;
  }

  function setControlsBusy(busy) {
    previous.disabled = busy;
    next.disabled = busy;
    addButton.disabled = busy;
  }

  page.append(addButton, renderEmployedNavigation('/employed/shifts'));
  return page;
}

function setMessage(element, text, kind) {
  element.textContent = text;
  element.className = 'status-message' + (kind === 'error' ? ' status-error' : '');
  element.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  element.hidden = !text;
}

function setFormBusy(form, busy) {
  for (const control of form.querySelectorAll('input, select, textarea, button')) control.disabled = busy;
}
