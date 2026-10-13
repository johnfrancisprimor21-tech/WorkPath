import { getSupabaseClient } from '../supabase.js';
import { compareApplicationEvents } from './contract.js';
import { DataError } from './errors.js';
import { normalizeTimestamp } from './normalize-timestamp.js';
import { computeWorkedMinutes } from '../shared/hours.js';

/** Create the Supabase-backed implementation of the Workpath repository. */
export function createSupabaseRepo({ getUserId }) {
  const supabase = getSupabaseClient();

  function userId() {
    const id = getUserId?.();
    if (!id) throw new DataError('permission', 'Your session ended. Please sign in again.');
    return id;
  }

  function queryError(error, entity, operation) {
    if (error instanceof DataError) return error;
    return toDataError(error, entity, operation);
  }

  async function one(query, entity, operation, missingMessage) {
    let result;
    try {
      result = await query;
    } catch (error) {
      throw queryError(error, entity, operation);
    }
    if (result.error) throw queryError(result.error, entity, operation);
    if (!result.data) throw new DataError('not_found', missingMessage);
    return result.data;
  }

  async function none(query, entity, operation) {
    let result;
    try {
      result = await query;
    } catch (error) {
      throw queryError(error, entity, operation);
    }
    if (result.error) throw queryError(result.error, entity, operation);
  }

  async function getApplication(id) {
    const owner = userId();
    return one(
      supabase.from('applications').select('*').eq('id', id).eq('user_id', owner).maybeSingle(),
      'application', 'read', 'We could not find this application. Refresh the page and try again.'
    );
  }

  async function updateApplication(id, values) {
    const owner = userId();
    const row = await one(
      supabase.from('applications').update(withoutIdentity(values)).eq('id', id).eq('user_id', owner)
        .select('*').maybeSingle(),
      'application', 'update', 'We could not find this application to update. Refresh the page and try again.'
    );
    return normalizeApplication(row);
  }

  return {
    profile: {
      async get() {
        const owner = userId();
        const row = await one(
          supabase.from('profiles').select('*').eq('id', owner).maybeSingle(),
          'profile', 'read', 'We could not find your profile. Sign out and sign in again, or contact support.'
        );
        return normalizeProfile(row);
      },
      async update(values) {
        const owner = userId();
        const row = await one(
          supabase.from('profiles').update(withoutIdentity(values)).eq('id', owner).select('*').maybeSingle(),
          'profile', 'update', 'We could not find your profile to update. Please sign out and sign in again.'
        );
        return normalizeProfile(row);
      }
    },
    employments: {
      async list() {
        const owner = userId();
        let result;
        try {
          result = await supabase.from('employments').select('*').eq('user_id', owner)
            .order('is_current', { ascending: false })
            .order('start_date', { ascending: false, nullsFirst: false })
            .order('id', { ascending: true });
        } catch (error) {
          throw queryError(error, 'employment', 'read');
        }
        if (result.error) throw queryError(result.error, 'employment', 'read');
        return (result.data || []).map(normalizeEmployment);
      },
      async create(input) {
        const owner = userId();
        const row = await one(
          supabase.from('employments').insert({ ...withoutIdentity(input), user_id: owner }).select('*').single(),
          'employment', 'create', 'We could not create this job. Check the details and try again.'
        );
        return normalizeEmployment(row);
      },
      async update(id, input) {
        const owner = userId();
        const row = await one(
          supabase.from('employments').update(withoutIdentity(input)).eq('id', id).eq('user_id', owner)
            .select('*').maybeSingle(),
          'employment', 'update', 'We could not update this job. Refresh the page and try again.'
        );
        return normalizeEmployment(row);
      },
      async remove(id) {
        const owner = userId();
        await none(supabase.from('employments').delete().eq('id', id).eq('user_id', owner), 'employment', 'delete');
      }
    },
    shifts: {
      async listBetween(fromDate, toDate) {
        validateDateRange(fromDate, toDate);
        const owner = userId();
        let result;
        try {
          result = await supabase.from('shifts').select('*').eq('user_id', owner)
            .gte('work_date', fromDate).lte('work_date', toDate)
            .order('work_date', { ascending: true })
            .order('time_in', { ascending: true, nullsFirst: false })
            .order('id', { ascending: true });
        } catch (error) {
          throw queryError(error, 'shift', 'read');
        }
        if (result.error) throw queryError(result.error, 'shift', 'read');
        return (result.data || []).map(normalizeShift);
      },
      async create(input) {
        const owner = userId();
        const row = await one(
          supabase.from('shifts').insert({ ...withoutDerived(input), user_id: owner }).select('*').single(),
          'shift', 'create', 'We could not create this shift. Check the details and try again.'
        );
        return normalizeShift(row);
      },
      async update(id, input) {
        const owner = userId();
        const row = await one(
          supabase.from('shifts').update(withoutDerived(input)).eq('id', id).eq('user_id', owner)
            .select('*').maybeSingle(),
          'shift', 'update', 'We could not find this shift to update. Refresh the page and try again.'
        );
        return normalizeShift(row);
      },
      async remove(id) {
        const owner = userId();
        await none(supabase.from('shifts').delete().eq('id', id).eq('user_id', owner), 'shift', 'delete');
      }
    },
    applications: {
      async list({ limit } = {}) {
        const owner = userId();
        if (limit !== undefined && (!Number.isInteger(limit) || limit < 0)) {
          throw new DataError('validation', 'Application limit must be a whole number of zero or more.');
        }
        if (limit !== undefined) {
          let result;
          try {
            result = await applicationListQuery(owner).limit(limit);
          } catch (error) {
            throw queryError(error, 'application', 'read');
          }
          if (result.error) throw queryError(result.error, 'application', 'read');
          return (result.data || []).map(normalizeApplication);
        }

        const rows = [];
        const pageSize = 1000;
        for (let offset = 0; ; offset += pageSize) {
          let result;
          try {
            result = await applicationListQuery(owner).range(offset, offset + pageSize - 1);
          } catch (error) {
            throw queryError(error, 'application', 'read');
          }
          if (result.error) throw queryError(result.error, 'application', 'read');
          rows.push(...(result.data || []));
          if (!result.data || result.data.length < pageSize) break;
        }
        return rows.map(normalizeApplication);
      },
      async create(input) {
        const owner = userId();
        const row = await one(
          supabase.from('applications').insert({ ...withoutIdentity(input), user_id: owner }).select('*').single(),
          'application', 'create', 'We could not create this application. Check the details and try again.'
        );
        return normalizeApplication(row);
      },
      update: updateApplication,
      async remove(id) {
        const owner = userId();
        await none(supabase.from('applications').delete().eq('id', id).eq('user_id', owner), 'application', 'delete');
      },
      async changeStatus(id, newStatus) {
        const current = await getApplication(id);
        if (current.status === newStatus) return { application: normalizeApplication(current), warning: false };
        const application = await updateApplication(id, { status: newStatus });
        try {
          await insertApplicationEvent({
            application_id: id,
            event_type: 'status_changed',
            event_date: new Date().toISOString(),
            notes: current.status + ' -> ' + newStatus
          });
          return { application, warning: false };
        } catch {
          return { application, warning: true };
        }
      }
    },
    applicationEvents: {
      async listForApplication(applicationId) {
        const owner = userId();
        let result;
        try {
          result = await supabase.from('application_events').select('*')
            .eq('application_id', applicationId).eq('user_id', owner)
            .order('event_date', { ascending: true })
            .order('id', { ascending: true });
        } catch (error) {
          throw queryError(error, 'application_event', 'read');
        }
        if (result.error) throw queryError(result.error, 'application_event', 'read');
        return (result.data || []).map(normalizeApplicationEvent).sort(compareApplicationEvents);
      },
      async create(input) {
        return insertApplicationEvent(input);
      },
      async update(id, input) {
        const owner = userId();
        const row = await one(
          supabase.from('application_events').update(withoutIdentity(input)).eq('id', id).eq('user_id', owner)
            .select('*').maybeSingle(),
          'application_event', 'update', 'We could not find this timeline event to update. Refresh the page and try again.'
        );
        return normalizeApplicationEvent(row);
      },
      async remove(id) {
        const owner = userId();
        await none(supabase.from('application_events').delete().eq('id', id).eq('user_id', owner), 'application_event', 'delete');
      }
    }
  };

  async function insertApplicationEvent(input) {
    const owner = userId();
    const row = await one(
      supabase.from('application_events').insert({ ...withoutIdentity(input), user_id: owner }).select('*').single(),
      'application_event', 'create', 'We could not create this timeline event. Try again.'
    );
    return normalizeApplicationEvent(row);
  }

  function applicationListQuery(owner) {
    return supabase.from('applications').select('*').eq('user_id', owner)
      .order('date_applied', { ascending: false })
      .order('id', { ascending: true });
  }
}

function withoutIdentity(input = {}) {
  const { id, user_id, created_at, updated_at, worked_minutes, ...values } = input;
  return values;
}

function withoutDerived(input = {}) {
  const { worked_minutes, ...values } = withoutIdentity(input);
  return values;
}

function normalizeEmployment(row) {
  return { ...row, hourly_rate: row.hourly_rate === null ? null : Number(row.hourly_rate) };
}

function normalizeProfile(row) {
  return { ...row, created_at: normalizeTimestamp(row.created_at) };
}

function normalizeShift(row) {
  const normalized = {
    ...row,
    time_in: normalizeTimestamp(row.time_in),
    time_out: normalizeTimestamp(row.time_out)
  };
  return { ...normalized, worked_minutes: computeWorkedMinutes(normalized) };
}

function normalizeApplication(row) {
  return { ...row, updated_at: normalizeTimestamp(row.updated_at) };
}

function normalizeApplicationEvent(row) {
  return { ...row, event_date: normalizeTimestamp(row.event_date) };
}

function validateDateRange(fromDate, toDate) {
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!datePattern.test(String(fromDate)) || !datePattern.test(String(toDate)) || fromDate > toDate) {
    throw new DataError('validation', 'Choose a valid inclusive date range.');
  }
}

function toDataError(error, entity, operation) {
  const code = String(error?.code || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();
  if (error instanceof TypeError || message.includes('fetch') || message.includes('network')) {
    return new DataError('network', networkMessage(entity, operation), error);
  }
  if (code === '42501' || message.includes('row-level security')) {
    return new DataError('permission', permissionMessage(entity, operation), error);
  }
  if (code === '23514' || code === '23502' || code === '22003' || code === '22p02') {
    return new DataError('validation', validationMessage(entity, code, message), error);
  }
  if (code === '23503') return new DataError('not_found', foreignKeyMessage(entity), error);
  return new DataError('unknown', unknownMessage(entity, operation), error);
}

function networkMessage(entity, operation) {
  if (entity === 'profile' && operation === 'read') return 'We could not load your profile. Check your connection and try again.';
  if (entity === 'profile') return 'We could not reach the database. Check your connection and try again.';
  if (['employment', 'shift', 'application', 'application_event'].includes(entity)) {
    return 'We could not reach the database. Check your connection and try again.';
  }
  return 'We could not reach the database. Check your connection and try again.';
}

function permissionMessage(entity, operation) {
  if (entity === 'profile' && operation === 'read') return 'We could not load your profile. Refresh the page and try again.';
  if (entity === 'profile') return 'We could not save these settings. Refresh the page and try again.';
  if (entity === 'employment') return 'You can only change your own jobs.';
  if (entity === 'shift') return 'You can only change your own shifts.';
  if (entity === 'application_event') return 'You can only change events on your own applications.';
  return 'You can only change your own applications.';
}

function validationMessage(entity, code, message) {
  if (entity === 'profile') {
    if (message.includes('profiles_onboarded_required_fields')) return 'Choose both a currency and a time zone before finishing setup.';
    if (message.includes('profiles_currency_format')) return 'Choose a valid three-letter currency code.';
    return 'Check the required profile details and try again.';
  }
  if (entity === 'employment') {
    if (code === '23514') return 'Check the job dates and hourly rate, then try again.';
    if (code === '23502') return 'Employer name is required.';
    if (code === '22003') return 'Hourly rate is too large. Enter a smaller amount.';
  }
  if (entity === 'shift') {
    if (code === '23514') return 'Check the shift times, day type, and break length.';
    if (code === '23502') return 'Add the required shift details and try again.';
  }
  if (entity === 'application_event' && code === '23502') return 'Add the required event details and try again.';
  if (entity === 'application' && code === '23502') return 'Company, position, and date applied are required.';
  return unknownMessage(entity, 'write');
}

function foreignKeyMessage(entity) {
  if (entity === 'shift') return 'Choose one of your jobs or select no employer.';
  if (entity === 'application_event') return 'This application is no longer available.';
  if (entity === 'application') return 'This record is no longer available.';
  return unknownMessage(entity, 'write');
}

function unknownMessage(entity, operation) {
  if (entity === 'profile' && operation === 'read') return 'We could not load your profile. Refresh the page and try again.';
  if (entity === 'profile') return 'We could not save your profile. Check your choices and try again.';
  if (entity === 'employment') return 'We could not save this job. Check the details and try again.';
  if (entity === 'shift') return 'We could not load or save shifts. Check the details and try again.';
  if (entity === 'application_event') return 'We could not load or save this timeline event. Try again.';
  if (entity === 'application') return 'We could not load or save applications. Check the details and try again.';
  return 'We could not complete that data request. Please try again.';
}
