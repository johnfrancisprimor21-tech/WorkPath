import { el, field, makeButton } from '../shared/dom.js';
import { todayInTimeZone } from '../shared/time.js';
import { MAX_TEXT_FILE_BYTES, pickTextFile, saveTextFile } from '../shared/files.js';
import { buildBackup, parseBackup, BACKUP_LISTS } from './backup-format.js';
import { planImport, runImport } from './importer.js';
import { parseCsv, serializeCsv } from './csv.js';
import { CSV_FORMATS, detectCsvList, exportCsv, mapCsvImport } from './csv-mappers.js';

const ALL_DATES = ['0001-01-01', '9999-12-31'];
const FILE_API = { pickTextFile, saveTextFile };
const LIST_LABELS = {
  employments: 'Jobs',
  shifts: 'Shifts and days off',
  payrollEntries: 'Paydays',
  applications: 'Applications',
  applicationEvents: 'Application timeline events'
};
const CSV_IMPORT_LISTS = ['employments', 'shifts', 'payrollEntries', 'applications'];
const CSV_EXPORT_LISTS = ['employments', 'shifts', 'payrollEntries', 'applications', 'applicationEvents'];
const CSV_LIST_LABELS = Object.fromEntries(CSV_EXPORT_LISTS.map((list) => [list, CSV_FORMATS[list].label]));

export function renderTransferSection({
  repo,
  profile,
  storageMode,
  getReadOnlyLocalRepo = async () => null,
  onLocalCopyDeleted = () => {},
  fileApi = FILE_API
}) {
  const section = el('section', { className: 'storage-section your-data-section' });
  section.append(
    el('h2', { className: 'section-title', text: 'Your data' }),
    el('p', {
      className: 'muted-copy',
      text: 'Backup files contain your data in plain text. Keep them private.'
    })
  );
  const status = el('p', { className: 'status-message', attrs: { role: 'status', 'aria-live': 'polite' } });
  status.hidden = true;
  let currentPlan = null;
  const actions = el('div', { className: 'transfer-actions' });
  const exportButton = makeButton('Export backup (JSON)', { className: 'button button-secondary' });
  const importButton = makeButton('Import backup (JSON)', { className: 'button button-primary' });
  actions.append(exportButton, importButton);
  const preview = el('div', { className: 'transfer-preview' });
  const csvSection = el('section', { className: 'csv-transfer-section' });
  const csvExports = el('div', { className: 'csv-export-actions' });
  const csvTemplates = el('div', { className: 'csv-template-list' });
  const importCsvButton = makeButton('Import CSV', { className: 'button button-primary' });
  csvSection.append(
    el('h3', { text: 'Export CSV' }),
    el('p', { className: 'muted-copy', text: 'Export a spreadsheet file for any list. CSV files contain plain text.' }),
    csvExports,
    el('h3', { text: 'Import CSV' }),
    el('p', { className: 'muted-copy', text: 'Import adds records only. Amounts are read in your profile currency and are not converted.' }),
    importCsvButton,
    el('h4', { text: 'CSV templates and format help' }),
    csvTemplates
  );
  for (const list of CSV_EXPORT_LISTS) {
    const button = makeButton('Export ' + CSV_LIST_LABELS[list] + ' CSV', { className: 'button button-secondary' });
    button.addEventListener('click', () => { void exportCsvList(list, button); });
    csvExports.append(button);
  }
  for (const list of CSV_IMPORT_LISTS) {
    const format = CSV_FORMATS[list];
    const details = el('details', { className: 'csv-template-help' });
    const templateButton = makeButton('Download ' + format.label + ' template', { className: 'button button-secondary' });
    details.append(el('summary', { text: format.label }), el('p', { className: 'muted-copy', text: format.help }), templateButton);
    templateButton.addEventListener('click', () => { void downloadTemplate(list, templateButton); });
    csvTemplates.append(details);
  }
  const localCopy = el('section', { className: 'local-copy-status' });
  localCopy.hidden = true;
  section.append(status, actions, csvSection, preview, localCopy);

  exportButton.addEventListener('click', () => { void exportBackup(); });
  importButton.addEventListener('click', () => { void chooseBackup(); });
  importCsvButton.addEventListener('click', () => { void chooseCsv(); });
  if (storageMode === 'account') void checkLocalCopy();

  return section;

  async function exportBackup() {
    setStatus(status, 'Preparing your backup…', 'status');
    exportButton.disabled = true;
    try {
      const data = await readAllData(repo);
      const backup = buildBackup({ ...data, source: storageMode });
      const date = todayInTimeZone(profile.timezone || 'UTC');
      await fileApi.saveTextFile(
        'workpath-backup-' + date + '.json',
        JSON.stringify(backup, null, 2),
        'application/json;charset=utf-8'
      );
      setStatus(status, 'Backup saved. Keep the file private.', 'success');
    } catch (error) {
      setStatus(status, error.message || 'We could not create your backup. Try again.', 'error');
    } finally {
      exportButton.disabled = false;
    }
  }

  async function chooseBackup() {
    importButton.disabled = true;
    clearPreview();
    try {
      const picked = await fileApi.pickTextFile({ accept: 'application/json,.json', maxBytes: MAX_TEXT_FILE_BYTES });
      if (!picked) return;
      const parsed = parseBackup(picked.text);
      await openPreview(parsed, 'File: ' + picked.name, false);
    } catch (error) {
      renderPreviewFailure(
        'Backup could not be read.',
        error.message || 'We could not read this file. Choose it again and try once more.'
      );
    } finally {
      importButton.disabled = false;
    }
  }

  async function exportCsvList(list, button) {
    button.disabled = true;
    setStatus(status, 'Preparing ' + CSV_LIST_LABELS[list] + ' CSV…', 'status');
    try {
      const data = await readAllData(repo);
      const text = exportCsv(list, data, profile);
      const date = todayInTimeZone(profile.timezone || 'UTC');
      await fileApi.saveTextFile(
        `workpath-${CSV_FORMATS[list].slug}-${date}.csv`,
        text,
        'text/csv;charset=utf-8'
      );
      setStatus(status, CSV_LIST_LABELS[list] + ' CSV saved.', 'success');
    } catch (error) {
      setStatus(status, error.message || 'We could not create this CSV. Try again.', 'error');
    } finally {
      button.disabled = false;
    }
  }

  async function downloadTemplate(list, button) {
    button.disabled = true;
    try {
      const format = CSV_FORMATS[list];
      const text = serializeCsv(format.headers, [], { textColumns: format.textColumns });
      await fileApi.saveTextFile(`workpath-${format.slug}-template.csv`, text, 'text/csv;charset=utf-8');
      setStatus(status, format.label + ' template saved.', 'success');
    } catch (error) {
      setStatus(status, error.message || 'We could not create this template. Try again.', 'error');
    } finally {
      button.disabled = false;
    }
  }

  async function chooseCsv() {
    importCsvButton.disabled = true;
    clearPreview();
    try {
      const picked = await fileApi.pickTextFile({ accept: 'text/csv,.csv,text/plain', maxBytes: MAX_TEXT_FILE_BYTES });
      if (!picked) return;
      const parsedCsv = parseCsv(picked.text);
      if (parsedCsv.fatal) {
        renderRefusalPreview('CSV could not be read.', parsedCsv.errors);
        return;
      }
      const detected = detectCsvList(parsedCsv.headers);
      if (detected) {
        await prepareCsvPreview(parsedCsv, detected, picked.name);
      } else {
        renderCsvListChooser(parsedCsv, picked.name);
      }
    } catch (error) {
      renderPreviewFailure('CSV could not be read.', error.message || 'We could not read this file. Choose it again and try once more.');
    } finally {
      importCsvButton.disabled = false;
    }
  }

  function renderCsvListChooser(parsedCsv, fileName) {
    currentPlan = null;
    preview.replaceChildren();
    const panel = el('section', { className: 'import-preview-panel', attrs: { 'aria-label': 'Choose CSV list' } });
    panel.append(
      el('h3', { text: 'Choose the CSV list' }),
      el('p', { className: 'muted-copy', text: 'We could not identify exactly one list from the header. Choose what this file contains.' })
    );
    const choices = el('div', { className: 'csv-list-choices' });
    for (const list of CSV_IMPORT_LISTS) {
      const button = makeButton('Import as ' + CSV_LIST_LABELS[list], { className: 'button button-secondary' });
      button.addEventListener('click', () => { void prepareCsvPreview(parsedCsv, list, 'File: ' + fileName); });
      choices.append(button);
    }
    const cancel = makeButton('Cancel', { className: 'button button-secondary' });
    cancel.addEventListener('click', clearPreview);
    panel.append(choices, cancel);
    preview.append(panel);
  }

  async function prepareCsvPreview(parsedCsv, list, title) {
    let existingData;
    try {
      existingData = await readAllData(repo);
    } catch (error) {
      renderPreviewFailure('Import preview unavailable.', error.message || 'We could not load your existing data. Try again.');
      return;
    }
    const mapped = mapCsvImport(parsedCsv, list, {
      profile: existingData.profile || profile,
      employments: existingData.employments || []
    });
    await openPreview(mapped.parsed, title, false, {
      csv: true,
      existingData,
      employmentIdAliases: mapped.employmentIdAliases
    });
  }

  async function checkLocalCopy() {
    let localRepo;
    try {
      localRepo = await getReadOnlyLocalRepo();
      if (!localRepo) return;
      const localData = await readAllData(localRepo);
      const counts = recordCounts(localData);
      if (Object.values(counts).reduce((sum, count) => sum + count, 0) === 0) return;
      renderLocalCopy(counts);
    } catch (error) {
      setStatus(status, error.message || 'We could not check for data saved on this device.', 'error');
    } finally {
      localRepo?.close();
    }
  }

  function renderLocalCopy(counts) {
    localCopy.hidden = false;
    const button = makeButton('Move to my account', { className: 'button button-primary button-wide' });
    localCopy.replaceChildren(
      el('h3', { text: 'Data saved on this device' }),
      el('p', { className: 'muted-copy', text: recordCountText(counts) }),
      button
    );
    button.addEventListener('click', () => { void prepareMove(); });
  }

  async function prepareMove() {
    clearPreview();
    let localRepo;
    const button = localCopy.querySelector('button');
    if (button) {
      button.disabled = true;
      button.textContent = 'Preparing move…';
    }
    try {
      localRepo = await getReadOnlyLocalRepo();
      if (!localRepo) throw new Error('No data saved on this device was found.');
      const localData = await readAllData(localRepo);
      const parsed = parseBackup(JSON.stringify(buildBackup({ ...localData, source: 'local' })));
      await openPreview(parsed, 'Data saved on this device', true);
    } catch (error) {
      renderPreviewFailure(
        'Import preview unavailable.',
        error.message || 'We could not prepare the move. Try again.'
      );
    } finally {
      localRepo?.close();
      if (button?.isConnected) {
        button.disabled = false;
        button.textContent = 'Move to my account';
      }
    }
  }

  async function openPreview(parsed, title, isMove, options = {}) {
    currentPlan = null;
    preview.replaceChildren();
    setStatus(status, '', 'status');
    if (!parsed?.data) {
      renderRefusalPreview(title, parsed?.errors || [{
        list: 'backup', row: 0, message: 'This backup could not be read.'
      }]);
      return;
    }

    let existingData = options.existingData;
    if (!existingData) {
      try {
        existingData = await readAllData(repo);
      } catch (error) {
        renderPreviewFailure(
          'Import preview unavailable.',
          error.message || 'We could not load your existing data. Try again.'
        );
        return;
      }
    }
    const panel = el('section', { className: 'import-preview-panel', attrs: { 'aria-label': 'Import preview' } });
    const heading = el('h3', {
      text: options.csv ? 'Preview CSV import' : isMove ? 'Preview move to your account' : 'Preview backup import'
    });
    const sourceLabel = el('p', { className: 'muted-copy', text: title });
    const summary = el('ul', { className: 'transfer-counts' });
    const examples = el('div', { className: 'transfer-examples' });
    const errorsArea = el('div', { className: 'transfer-errors-area' });
    const emptyReason = el('p', { className: 'muted-copy' });
    emptyReason.hidden = true;
    const warningsArea = el('div', { className: 'transfer-warnings' });
    const progress = el('p', { className: 'status-message', attrs: { role: 'status', 'aria-live': 'polite' } });
    progress.hidden = true;
    const settingsControl = el('input', { attrs: { type: 'checkbox', name: 'apply_profile_settings' } });
    settingsControl.checked = !existingData.profile?.onboarded;
    const settingsField = field('Apply currency, pay frequency, and time zone', settingsControl, {
      className: 'field transfer-choice-field',
      hint: 'This never changes your work mode or display name.'
    });
    settingsField.hidden = Boolean(options.csv);
    const skipControl = el('input', { attrs: { type: 'checkbox', name: 'skip_duplicates' } });
    skipControl.checked = true;
    const skipField = field('Skip duplicate records', skipControl, { className: 'field transfer-choice-field' });
    const confirm = makeButton(isMove ? 'Confirm move' : 'Confirm import', {
      className: 'button button-primary', disabled: true
    });
    const cancel = makeButton('Cancel', { className: 'button button-secondary' });
    const controls = el('div', { className: 'transfer-preview-actions' }, [confirm, cancel]);
    panel.append(heading, sourceLabel, summary, examples, errorsArea, emptyReason,
      settingsField, skipField, warningsArea, progress, controls);
    preview.append(panel);
    cancel.addEventListener('click', clearPreview);

    function refreshPlan() {
      try {
        currentPlan = planImport(parsed, existingData, {
          skipDuplicates: skipControl.checked,
          applyProfileSettings: options.csv ? false : settingsControl.checked,
          employmentIdAliases: options.employmentIdAliases
        });
        summary.replaceChildren(...BACKUP_LISTS.map((list) => el('li', {
          text: LIST_LABELS[list] + ': add ' + currentPlan.lists[list].toCreate.length
            + ', skip ' + currentPlan.lists[list].duplicates
            + ', errors ' + currentPlan.lists[list].errors.length
        })));
        examples.replaceChildren();
        appendExamples(examples, currentPlan);
        errorsArea.replaceChildren();
        if (currentPlan.errors.length) {
          errorsArea.append(el('h4', { text: 'Rows or settings with errors: ' + currentPlan.errors.length }));
          const list = el('ol');
          currentPlan.errors.slice(0, 10).forEach((entry) => list.append(el('li', {
            text: entry.list + ' · row ' + entry.row
              + (entry.column ? ' · column ' + entry.column : '') + ': ' + entry.message
          })));
          errorsArea.append(list);
          if (currentPlan.errors.length > 10) {
            errorsArea.append(el('p', { className: 'muted-copy', text: 'Showing the first 10 errors.' }));
          }
        }
        warningsArea.replaceChildren();
        if (currentPlan.warnings.length) {
          const warningList = el('ul');
          currentPlan.warnings.forEach((warning) => warningList.append(el('li', { text: warning })));
          warningsArea.append(el('h4', { text: 'Warnings' }), warningList);
        }
        const createCount = BACKUP_LISTS.reduce((sum, list) => sum + currentPlan.lists[list].toCreate.length, 0);
        emptyReason.textContent = importBlockReason(currentPlan, parsed.data, { csv: options.csv });
        emptyReason.hidden = currentPlan.canRun && createCount > 0;
        confirm.disabled = !currentPlan.canRun || createCount === 0;
      } catch (error) {
        currentPlan = null;
        confirm.disabled = true;
        errorsArea.replaceChildren(el('p', {
          className: 'status-message status-error',
          attrs: { role: 'alert' },
          text: error.message || 'We could not prepare this preview. Try again.'
        }));
        setStatus(status, error.message || 'We could not prepare this preview. Try again.', 'error');
      }
    }
    settingsControl.addEventListener('change', refreshPlan);
    skipControl.addEventListener('change', refreshPlan);
    refreshPlan();
    confirm.addEventListener('click', async () => {
      if (!currentPlan || !currentPlan.canRun
          || !BACKUP_LISTS.some((list) => currentPlan.lists[list].toCreate.length > 0)) return;
      confirm.disabled = true;
      cancel.disabled = true;
      settingsControl.disabled = true;
      skipControl.disabled = true;
      progress.hidden = false;
      const result = await runImport(repo, currentPlan, {
        onProgress: ({ list, completed, total }) => {
          progress.textContent = 'Adding ' + LIST_LABELS[list] + ' (' + completed + ' of ' + total + ')…';
        }
      });
      renderRunSummary(panel, result);
      currentPlan = null;
      if (isMove && result.failures.length === 0) {
        appendLocalCopyChoices(panel, async () => {
          await onLocalCopyDeleted();
          localCopy.hidden = true;
          setStatus(status, 'The local copy was deleted.', 'success');
        });
      }
    });
  }

  function renderRefusalPreview(title, errors) {
    currentPlan = null;
    preview.replaceChildren();
    const panel = el('section', { className: 'import-preview-panel', attrs: { 'aria-label': 'Backup refusal' } });
    panel.append(el('h3', { text: title }));
    const list = el('ol', { className: 'transfer-errors' });
    errors.slice(0, 10).forEach((entry) => list.append(el('li', {
      text: entry.message || 'This file could not be imported.'
    })));
    panel.append(list);
    if (errors.length > 10) panel.append(el('p', { className: 'muted-copy', text: 'Showing the first 10 errors.' }));
    const cancel = makeButton('Cancel', { className: 'button button-secondary' });
    cancel.addEventListener('click', clearPreview);
    panel.append(cancel);
    preview.append(panel);
    setStatus(status, errors[0]?.message || 'This file could not be imported.', 'error');
  }

  function renderPreviewFailure(title, message) {
    renderRefusalPreview(title, [{ list: 'backup', row: 0, message }]);
  }

  function clearPreview() {
    currentPlan = null;
    preview.replaceChildren();
    setStatus(status, '', 'status');
  }
}

function importBlockReason(plan, data, { csv = false } = {}) {
  const fileLabel = csv ? 'CSV' : 'backup';
  if (!plan.canRun) {
    if (plan.errors.some((entry) => entry.row === 0 && entry.list !== 'profile')) {
      return `This ${fileLabel} has a format or list error and cannot be imported.`;
    }
    if (plan.errors.some((entry) => entry.list === 'profile' && entry.row === 0)) {
      return 'Profile settings cannot be applied. Turn off that option to import records without changing settings.';
    }
    return `This ${fileLabel} cannot be imported. Choose another file and try again.`;
  }
  const recordCount = BACKUP_LISTS.reduce((sum, list) => sum + data[list].length, 0);
  const duplicateCount = BACKUP_LISTS.reduce((sum, list) => sum + plan.lists[list].duplicates, 0);
  if (recordCount === 0 && plan.errors.length > 0) {
    return 'There are no valid rows to add. Fix the listed errors and choose the file again.';
  }
  if (recordCount === 0) return `This ${fileLabel} has no records to add.`;
  if (duplicateCount > 0 && plan.errors.length > 0) {
    return 'Nothing to add: all valid records are duplicates, and the other rows have errors.';
  }
  if (duplicateCount > 0) return 'Nothing to add: every valid record is already present.';
  return 'Nothing to add. Fix the listed errors and choose the file again.';
}

export async function readAllData(repo) {
  const [profile, employments, shifts, payrollEntries, applications] = await Promise.all([
    repo.profile.get(),
    repo.employments.list(),
    repo.shifts.listBetween(...ALL_DATES),
    repo.payrollEntries.list(),
    repo.applications.list()
  ]);
  const eventGroups = [];
  for (let index = 0; index < applications.length; index += 20) {
    const batch = applications.slice(index, index + 20);
    eventGroups.push(...await Promise.all(batch.map((application) =>
      repo.applicationEvents.listForApplication(application.id))));
  }
  return {
    profile,
    employments,
    shifts,
    payrollEntries,
    applications,
    applicationEvents: eventGroups.flat()
  };
}

function appendExamples(container, plan) {
  const samples = [
    ...plan.lists.employments.toCreate.slice(0, 5).map(({ row }) => 'Job: ' + row.employer_name + (row.job_title ? ' — ' + row.job_title : '')),
    ...plan.lists.applications.toCreate.slice(0, 5).map(({ row }) => 'Application: ' + row.company + ' — ' + row.position)
  ];
  if (samples.length) {
    container.append(el('h4', { text: 'Examples' }));
    const list = el('ul');
    samples.forEach((text) => list.append(el('li', { text })));
    container.append(list);
  }
}

function renderRunSummary(panel, result) {
  const summary = el('section', { className: 'transfer-run-summary', attrs: { 'aria-live': 'polite' } });
  summary.append(el('h4', { text: result.failures.length ? 'Import stopped' : 'Import complete' }));
  const counts = el('ul');
  for (const list of BACKUP_LISTS) {
    counts.append(el('li', {
      text: LIST_LABELS[list] + ': added ' + result.created[list] + ', skipped ' + result.skipped[list]
        + ', not added ' + (result.notCreated[list]?.length || 0)
    }));
  }
  summary.append(counts);
  for (const failure of result.failures) {
    summary.append(el('p', {
      className: 'status-message status-error',
      text: failure.list + ' · row ' + failure.row + ': ' + failure.message
    }));
  }
  result.warnings.forEach((warning) => summary.append(el('p', { className: 'muted-copy', text: warning })));
  panel.append(summary);
}

function appendLocalCopyChoices(panel, onDelete) {
  const choices = el('section', { className: 'local-copy-decision' });
  const keep = el('input', { attrs: { type: 'radio', name: 'local_copy_decision', value: 'keep', checked: '' } });
  const remove = el('input', { attrs: { type: 'radio', name: 'local_copy_decision', value: 'delete' } });
  const keepField = field('Keep the local copy (recommended)', keep, { className: 'field transfer-choice-field' });
  const removeField = field('Delete data on this device', remove, { className: 'field transfer-choice-field' });
  const deleteForm = el('form', { className: 'form-stack delete-local-form', attrs: { novalidate: '' } });
  deleteForm.hidden = true;
  const confirmation = el('input', { attrs: { type: 'text', name: 'delete_confirmation', autocomplete: 'off', maxlength: 6 } });
  const confirmationField = field('Type DELETE to confirm', confirmation, { hint: 'This permanently removes the local copy.' });
  const deleteButton = makeButton('Delete data on this device', {
    type: 'submit', className: 'button button-danger button-wide', disabled: true
  });
  const message = el('p', { className: 'status-message', attrs: { role: 'alert' } });
  const keepMessage = el('p', { className: 'muted-copy', text: 'The local copy will remain on this device.' });
  confirmation.addEventListener('input', () => {
    deleteButton.disabled = confirmation.value !== 'DELETE';
    message.textContent = '';
    message.className = 'status-message';
  });
  keep.addEventListener('change', () => {
    deleteForm.hidden = true;
    keepMessage.hidden = false;
  });
  remove.addEventListener('change', () => {
    deleteForm.hidden = false;
    keepMessage.hidden = true;
  });
  deleteForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (confirmation.value !== 'DELETE') return;
    deleteButton.disabled = true;
    deleteButton.textContent = 'Deleting…';
    try {
      await onDelete();
      keep.disabled = true;
      remove.disabled = true;
      confirmation.disabled = true;
      deleteForm.remove();
    } catch (error) {
      message.className = 'status-message status-error';
      message.textContent = error.message || 'We could not delete the local copy. Close other Workpath tabs and try again.';
      deleteButton.disabled = false;
      deleteButton.textContent = 'Delete data on this device';
    }
  });
  deleteForm.append(confirmationField, message, deleteButton);
  choices.append(el('h4', { text: 'Local copy' }), keepField, removeField, keepMessage, deleteForm);
  panel.append(choices);
}

function recordCounts(data) {
  return Object.fromEntries(BACKUP_LISTS.map((list) => [list, data[list].length]));
}

function recordCountText(counts) {
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  return total + ' saved record' + (total === 1 ? '' : 's') + ': '
    + BACKUP_LISTS.map((list) => LIST_LABELS[list] + ' ' + counts[list]).join(' · ');
}

function setStatus(element, message, kind) {
  element.textContent = message || '';
  element.className = 'status-message' + (message ? ' status-' + kind : '');
  element.hidden = !message;
  element.setAttribute('role', kind === 'error' ? 'alert' : 'status');
}
