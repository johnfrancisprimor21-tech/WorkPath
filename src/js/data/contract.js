/**
 * Data-layer contract for Workpath's current entities.
 *
 * All ids are UUID strings. Calendar dates are YYYY-MM-DD strings, timestamps
 * are ISO-8601 UTC strings, and money values are JavaScript numbers or null.
 * Entity inputs omit id, user_id, database-managed timestamps, and derived
 * worked_minutes; ownership always comes from the repository's active user.
 * Repositories return plain data objects and reject with DataError for failed
 * reads or writes. Every create returns the complete created row including id;
 * every update returns the complete updated row; remove resolves to undefined.
 * The current surface covers profiles, employments, shifts, applications, and
 * application events. Payroll entries will be added as a separate entity in
 * the later payroll task; future import/export work should enumerate all
 * entity collections through this same repository boundary.
 *
 * Ordering is part of the contract:
 * - employments: is_current descending, start_date descending (null last), id
 *   ascending; this matches the existing jobs screen.
 * - shifts: work_date ascending, time_in ascending (null last), id ascending.
 * - applications: date_applied descending, id ascending.
 * - application events: event_date ascending, id ascending. The schema has no
 *   created_at column, so events with the same event_date timestamp have no
 *   creation order and are only tie-broken by id. The timeline may reverse this
 *   order for presentation.
 *
 * Date range filters for shifts include both endpoints. Application list
 * limits are applied after the fixed ordering; an omitted limit means all rows.
 * changeStatus updates the application before creating its status_changed
 * event. If that event insert fails, the returned warning is true and the
 * status update remains committed.
 *
 * Method behavior:
 * - profile.get reads the current user's row; profile.update accepts partial
 *   editable values and returns that user's complete row.
 * - employments.list returns the ordered current user's rows. create and update
 *   return complete rows; remove is a no-op when the row is not visible and
 *   resolves with undefined.
 * - shifts.listBetween applies an inclusive work_date range. Shift reads and
 *   writes include a derived integer worked_minutes value in minutes.
 * - applications.list returns ordered rows (optionally limited). create and
 *   update return complete rows; remove cascades timeline events.
 * - applications.changeStatus returns { application, warning }; it updates
 *   first, then tries to add a status_changed event without rolling back the
 *   status when event insertion fails.
 * - applicationEvents.listForApplication returns events for one of the current
 *   user's applications. create and update return full rows; remove resolves
 *   with undefined when the row is absent or not visible.
 * - Failed operations reject with DataError: validation for bad values,
 *   permission for disallowed access, not_found for missing reads or updates,
 *   network for connectivity errors, and unknown for other failures.
 *
 * Task 8 can extend this module with payroll entity typedefs and methods without
 * changing the ownership, error, or serialization conventions above.
 */

/** @typedef {'employed'|'job_seeker'} UserMode */
/** @typedef {'weekly'|'biweekly'|'semi_monthly'|'monthly'} PayFrequency */
/** @typedef {'duty'|'off'|'leave'|'sick'|'holiday'} DayType */
/** @typedef {'pending'|'interview'|'offer'|'rejected'|'no_response'} ApplicationStatus */
/** @typedef {'validation'|'permission'|'not_found'|'network'|'unknown'} DataErrorCode */

/**
 * @typedef {Object} Profile
 * @property {string} id UUID and auth user id
 * @property {string|null} display_name
 * @property {UserMode} mode
 * @property {string|null} currency ISO 4217 code
 * @property {PayFrequency|null} pay_frequency
 * @property {string|null} timezone IANA time zone name
 * @property {boolean} onboarded
 * @property {string|null} created_at ISO-8601 UTC timestamp
 */
/** @typedef {Omit<Profile, 'id'|'created_at'>} ProfileValues */

/**
 * @typedef {Object} Employment
 * @property {string} id UUID
 * @property {string} user_id UUID of the current repository user
 * @property {string} employer_name
 * @property {string|null} job_title
 * @property {number|null} hourly_rate
 * @property {string|null} start_date YYYY-MM-DD
 * @property {string|null} end_date YYYY-MM-DD
 * @property {boolean} is_current
 */
/** @typedef {Omit<Employment, 'id'|'user_id'>} EmploymentInput */

/**
 * @typedef {Object} Shift
 * @property {string} id UUID
 * @property {string} user_id UUID of the current repository user
 * @property {string|null} employment_id UUID
 * @property {string} work_date YYYY-MM-DD
 * @property {DayType} day_type
 * @property {string|null} time_in ISO-8601 UTC timestamp
 * @property {string|null} time_out ISO-8601 UTC timestamp
 * @property {number} break_minutes Whole minutes
 * @property {boolean} is_overtime
 * @property {string|null} notes
 * @property {number} worked_minutes Derived whole minutes; never persisted
 */
/** @typedef {Omit<Shift, 'id'|'user_id'|'worked_minutes'>} ShiftInput */

/**
 * @typedef {Object} Application
 * @property {string} id UUID
 * @property {string} user_id UUID of the current repository user
 * @property {string} company
 * @property {string} position
 * @property {string|null} source
 * @property {string|null} job_url
 * @property {string|null} location
 * @property {string} date_applied YYYY-MM-DD
 * @property {ApplicationStatus} status
 * @property {string|null} contact_name
 * @property {string|null} contact_email
 * @property {string|null} notes
 * @property {string} updated_at ISO-8601 UTC timestamp
 */
/** @typedef {Omit<Application, 'id'|'user_id'|'updated_at'>} ApplicationInput */

/**
 * @typedef {Object} ApplicationEvent
 * @property {string} id UUID
 * @property {string} application_id UUID
 * @property {string} user_id UUID of the current repository user
 * @property {string} event_type
 * @property {string} event_date ISO-8601 UTC timestamp
 * @property {string|null} notes
 */
/** @typedef {Omit<ApplicationEvent, 'id'|'user_id'>} ApplicationEventInput */

/** @typedef {Object} StatusChangeResult @property {Application} application @property {boolean} warning */

/**
 * @typedef {Object} WorkpathRepo
 * @property {{get(): Promise<Profile>, update(values: Partial<ProfileValues>): Promise<Profile>}} profile
 * @property {{list(): Promise<Employment[]>, create(input: EmploymentInput): Promise<Employment>, update(id: string, input: Partial<EmploymentInput>): Promise<Employment>, remove(id: string): Promise<void>}} employments
 * @property {{listBetween(fromDate: string, toDate: string): Promise<Shift[]>, create(input: ShiftInput): Promise<Shift>, update(id: string, input: Partial<ShiftInput>): Promise<Shift>, remove(id: string): Promise<void>}} shifts
 * @property {{list(options?: {limit?: number}): Promise<Application[]>, create(input: ApplicationInput): Promise<Application>, update(id: string, input: Partial<ApplicationInput>): Promise<Application>, remove(id: string): Promise<void>, changeStatus(id: string, newStatus: ApplicationStatus): Promise<StatusChangeResult>}} applications
 * @property {{listForApplication(applicationId: string): Promise<ApplicationEvent[]>, create(input: ApplicationEventInput): Promise<ApplicationEvent>, update(id: string, input: Partial<ApplicationEventInput>): Promise<ApplicationEvent>, remove(id: string): Promise<void>}} applicationEvents
 */

export function compareEmployments(a, b) {
  return Number(b.is_current) - Number(a.is_current)
    || compareNullableText(a.start_date, b.start_date, true)
    || compareText(a.id, b.id);
}

export function compareShifts(a, b) {
  return compareText(a.work_date, b.work_date)
    || compareNullableTimestamp(a.time_in, b.time_in)
    || compareText(a.id, b.id);
}

export function compareApplications(a, b) {
  return compareText(b.date_applied, a.date_applied)
    || compareText(a.id, b.id);
}

export function compareApplicationEvents(a, b) {
  return compareTimestamp(a.event_date, b.event_date)
    || compareText(a.id, b.id);
}

function compareNullableText(a, b, descending) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return compareText(a, b) * (descending ? -1 : 1);
}

function compareNullableTimestamp(a, b) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return compareTimestamp(a, b);
}

function compareTimestamp(a, b) {
  const millisecondDifference = Date.parse(a) - Date.parse(b);
  if (millisecondDifference) return millisecondDifference;
  return compareText(timestampFraction(a), timestampFraction(b));
}

function timestampFraction(timestamp) {
  return String(timestamp).match(/\.(\d+)(?=Z|[+-]\d{2}:?\d{2}$)/i)?.[1].padEnd(9, '0') || '000000000';
}

function compareText(a, b) {
  const left = String(a ?? '');
  const right = String(b ?? '');
  return left < right ? -1 : left > right ? 1 : 0;
}
