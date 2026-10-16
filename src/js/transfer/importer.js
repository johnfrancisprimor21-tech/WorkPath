import { BACKUP_LISTS } from './backup-format.js';
import { normalizeTimestamp } from '../data/normalize-timestamp.js';
import { validateProfile } from '../data/validation.js';

const WRITE_ORDER = ['employments', 'applications', 'shifts', 'payrollEntries', 'applicationEvents'];
const TEXT_KEY_FIELDS = {
  employments: ['employer_name', 'job_title'],
  applications: ['company', 'position'],
  applicationEvents: ['event_type', 'notes']
};

/**
 * Build an additive dry-run plan. Existing records are never changed or removed.
 * Each list exposes toCreate rows, duplicate counts, and row errors.
 */
export function planImport(parsed, existingData = {}, options = {}) {
  const skipDuplicates = options.skipDuplicates !== false;
  const applyProfileSettings = options.applyProfileSettings === undefined
    ? !existingData.profile?.onboarded
    : Boolean(options.applyProfileSettings);
  const data = parsed?.data;
  const errors = Array.isArray(parsed?.errors) ? [...parsed.errors] : [];
  const warnings = Array.isArray(parsed?.warnings) ? [...parsed.warnings] : [];
  const lists = Object.fromEntries(BACKUP_LISTS.map((list) => [list, {
    toCreate: [],
    duplicates: 0,
    errors: errors.filter((entry) => entry.list === list)
  }]));
  const aliases = { employments: new Map(), applications: new Map() };
  let profileSettingsInvalid = false;
  let profileUpdate = null;
  const employmentKeyBySourceId = new Map();
  const employmentKeyByExistingId = new Map();
  const existingEmploymentByKey = new Map();
  const applicationKeyBySourceId = new Map();
  if (!data) {
    if (!errors.length) errors.push({ list: 'backup', row: 0, message: 'This backup could not be read.' });
    return finish();
  }

  const currentProfile = existingData.profile || {};
  if (data.profile.currency !== currentProfile.currency) {
    warnings.push('Amounts are imported as recorded. Currency differences are not converted.');
  }
  if (applyProfileSettings) {
    profileUpdate = Object.fromEntries(['currency', 'pay_frequency', 'timezone']
      .map((key) => [key, data.profile[key]]));
    try {
      validateProfile({ ...currentProfile, ...profileUpdate });
    } catch (error) {
      profileSettingsInvalid = true;
      errors.push({ list: 'profile', row: 0, message: error.message });
      profileUpdate = null;
    }
  }

  const existingEmployments = existingData.employments || [];
  for (const record of existingEmployments) {
    const key = employmentKey(record);
    employmentKeyByExistingId.set(record.id, key);
    if (!existingEmploymentByKey.has(key)) existingEmploymentByKey.set(key, record);
  }
  const seenEmploymentKeys = new Map();
  for (const [index, record] of (data.employments || []).entries()) {
    const key = employmentKey(record);
    employmentKeyBySourceId.set(record.id, key);
    if (seenEmploymentKeys.has(key)) {
      lists.employments.duplicates += 1;
      aliases.employments.set(record.id, { sourceId: seenEmploymentKeys.get(key) });
    } else if (skipDuplicates && existingEmploymentByKey.has(key)) {
      lists.employments.duplicates += 1;
      aliases.employments.set(record.id, { existingId: existingEmploymentByKey.get(key).id });
    } else {
      seenEmploymentKeys.set(key, record.id);
      lists.employments.toCreate.push({ sourceId: record.id, sourceRow: index + 1, row: record });
    }
  }

  const existingApplications = existingData.applications || [];
  const existingApplicationByKey = new Map();
  for (const record of existingApplications) {
    const key = applicationKey(record);
    if (!existingApplicationByKey.has(key)) existingApplicationByKey.set(key, record);
  }
  const seenApplicationKeys = new Map();
  for (const [index, record] of (data.applications || []).entries()) {
    const key = applicationKey(record);
    applicationKeyBySourceId.set(record.id, key);
    if (seenApplicationKeys.has(key)) {
      lists.applications.duplicates += 1;
      aliases.applications.set(record.id, { sourceId: seenApplicationKeys.get(key) });
    } else if (skipDuplicates && existingApplicationByKey.has(key)) {
      lists.applications.duplicates += 1;
      aliases.applications.set(record.id, { existingId: existingApplicationByKey.get(key).id });
    } else {
      seenApplicationKeys.set(key, record.id);
      lists.applications.toCreate.push({ sourceId: record.id, sourceRow: index + 1, row: record });
    }
  }

  addNaturalList('shifts', data.shifts || [], existingData.shifts || [], shiftKey);
  addNaturalList('payrollEntries', data.payrollEntries || [], existingData.payrollEntries || [], payrollKey);
  const existingApplicationKeyById = new Map((existingData.applications || []).map((app) => [app.id, applicationKey(app)]));
  const existingEventKeys = new Set((existingData.applicationEvents || []).map((event) =>
    eventKey(event, existingApplicationKeyById.get(event.application_id))));
  const seenEventKeys = new Set();
  for (const [index, row] of (data.applicationEvents || []).entries()) {
    const key = eventKey(row, applicationKeyBySourceId.get(row.application_id));
    if (seenEventKeys.has(key) || (skipDuplicates && existingEventKeys.has(key))) {
      lists.applicationEvents.duplicates += 1;
      continue;
    }
    seenEventKeys.add(key);
    lists.applicationEvents.toCreate.push({ sourceId: row.id, sourceRow: index + 1, row });
  }

  return finish();

  function addNaturalList(list, incomingRows, existingRows, keyForIncoming) {
    const existingKeys = new Set(existingRows.map((row) => keyForIncoming(
      row, employmentKeyByExistingId, existingData.employments || []
    )));
    const seen = new Set();
    for (const [index, row] of incomingRows.entries()) {
      const key = keyForIncoming(row, employmentKeyBySourceId, data.employments || []);
      if (seen.has(key) || (skipDuplicates && existingKeys.has(key))) {
        lists[list].duplicates += 1;
        continue;
      }
      seen.add(key);
      lists[list].toCreate.push({ sourceId: row.id, sourceRow: index + 1, row });
    }
  }

  function finish() {
    for (const list of BACKUP_LISTS) {
      lists[list].errors = errors.filter((entry) => entry.list === list);
    }
    return {
      lists,
      errors,
      warnings: [...new Set(warnings)],
      profileUpdate,
      aliases,
      skipDuplicates,
      canRun: Boolean(data) && !profileSettingsInvalid
        && !errors.some((entry) => entry.row === 0 && entry.list !== 'profile'),
      _data: data,
      _employmentKeyBySourceId: employmentKeyBySourceId,
      _applicationKeyBySourceId: applicationKeyBySourceId
    };
  }
}

/**
 * Write planned records in dependency order. A failure stops the run and returns
 * exact created ids and the pending rows; retry by planning the same backup again.
 */
export async function runImport(repo, plan, { onProgress = () => {} } = {}) {
  const created = Object.fromEntries(BACKUP_LISTS.map((list) => [list, 0]));
  const skipped = Object.fromEntries(BACKUP_LISTS.map((list) => [
    list, plan.lists[list].duplicates + plan.lists[list].errors.length
  ]));
  const createdRecords = Object.fromEntries(BACKUP_LISTS.map((list) => [list, []]));
  const idMaps = { employments: new Map(), applications: new Map() };
  const total = WRITE_ORDER.reduce((sum, list) => sum + plan.lists[list].toCreate.length, 0);
  let completed = 0;
  let profileSettingsApplied = false;

  if (!plan.canRun) {
    return result([{ list: 'backup', row: 0, message: 'This backup cannot be imported.' }]);
  }

  for (const list of WRITE_ORDER) {
    const rows = plan.lists[list].toCreate;
    for (let index = 0; index < rows.length; index += 1) {
      const item = rows[index];
      try {
        const input = mapInput(list, item.row, idMaps);
        const record = await repo[list].create(input);
        created[list] += 1;
        createdRecords[list].push({ sourceId: item.sourceId, id: record.id });
        if (list === 'employments' || list === 'applications') idMaps[list].set(item.sourceId, record.id);
        completed += 1;
        onProgress({ list, completed, total, row: index + 1 });
      } catch (error) {
        const failures = [{
          list,
          row: item.sourceRow,
          message: error?.message || 'This record could not be imported.'
        }];
        return result(failures);
      }
    }
    if (list === 'employments') resolveAliases(idMaps.employments, plan.aliases.employments);
    if (list === 'applications') resolveAliases(idMaps.applications, plan.aliases.applications);
  }

  if (plan.profileUpdate) {
    try {
      await repo.profile.update(plan.profileUpdate);
      profileSettingsApplied = true;
    } catch (error) {
      return result([{
        list: 'profile',
        row: 0,
        message: error?.message || 'Profile settings could not be imported.'
      }]);
    }
  }
  return result([]);

  function result(failures) {
    const notCreated = Object.fromEntries(WRITE_ORDER.map((list) => [
      list,
      plan.lists[list].toCreate.slice(created[list]).map((item, index) => ({
        sourceId: item.sourceId,
        row: item.sourceRow ?? created[list] + index + 1
      }))
    ]));
    const allWarnings = [...plan.warnings];
    if (failures.length) {
      allWarnings.push('Some records were not added. It is safe to run this backup again; duplicate records will be skipped.');
    }
    return {
      created,
      skipped,
      createdRecords,
      notCreated,
      failures,
      errors: plan.errors,
      warnings: [...new Set(allWarnings)],
      profileSettingsApplied
    };
  }
}

function resolveAliases(idMap, aliases) {
  for (const [oldId, target] of aliases) {
    if (target.existingId) idMap.set(oldId, target.existingId);
    else if (target.sourceId && idMap.has(target.sourceId)) idMap.set(oldId, idMap.get(target.sourceId));
  }
}

function mapInput(list, row, idMaps) {
  const { id, ...input } = row;
  if (list === 'shifts' || list === 'payrollEntries') {
    if (input.employment_id != null) {
      const mapped = idMaps.employments.get(input.employment_id);
      if (!mapped) throw new Error('This record refers to a job that could not be imported.');
      input.employment_id = mapped;
    }
  } else if (list === 'applicationEvents') {
    const mapped = idMaps.applications.get(input.application_id);
    if (!mapped) throw new Error('This event refers to an application that could not be imported.');
    input.application_id = mapped;
  }
  return input;
}

function shiftKey(row, employmentKeyById, employments) {
  return stableKey([
    row.work_date,
    timestamp(row.time_in),
    timestamp(row.time_out),
    employmentKey(row.employment_id, employmentKeyById, employments)
  ]);
}

function payrollKey(row, employmentKeyById, employments) {
  return stableKey([
    row.pay_date,
    money(row.net),
    row.period_start ?? '',
    employmentKey(row.employment_id, employmentKeyById, employments)
  ]);
}

function eventKey(row, appKey) {
  appKey ||= 'application:' + row.application_id;
  return stableKey([appKey, timestamp(row.event_date), textKey(row.event_type), textKey(row.notes)]);
}

function employmentKey(rowOrId, idMap, rows = []) {
  if (rowOrId && typeof rowOrId === 'object') {
    return stableKey([textKey(rowOrId.employer_name), textKey(rowOrId.job_title), rowOrId.start_date ?? '']);
  }
  if (rowOrId == null) return '';
  if (idMap.has(rowOrId)) return idMap.get(rowOrId);
  const row = rows.find((entry) => entry.id === rowOrId);
  return row ? employmentKey(row) : 'employment:' + rowOrId;
}

function applicationKey(application) {
  return stableKey([textKey(application.company), textKey(application.position), application.date_applied]);
}

function timestamp(value) {
  return value == null ? '' : normalizeTimestamp(value);
}

function money(value) {
  return value == null ? '' : Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function textKey(value) {
  return String(value ?? '').trim().toLocaleLowerCase('en-US');
}

function stableKey(parts) {
  return JSON.stringify(parts);
}
