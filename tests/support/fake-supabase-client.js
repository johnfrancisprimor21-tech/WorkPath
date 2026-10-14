const TABLES = ['profiles', 'employments', 'shifts', 'applications', 'application_events', 'payroll_entries'];

export function createFakeSupabaseStore() {
  return Object.fromEntries(TABLES.map((table) => [table, []]));
}

export function seedFakeProfile(store, userId) {
  if (!store.profiles.some((row) => row.id === userId)) {
    store.profiles.push({
      id: userId,
      display_name: null,
      mode: 'job_seeker',
      currency: null,
      pay_frequency: null,
      timezone: null,
      onboarded: false,
      created_at: new Date().toISOString()
    });
  }
}

/** A small PostgREST-shaped client for testing the account repository without network access. */
export function createFakeSupabaseClient({ store = createFakeSupabaseStore(), userId }) {
  return {
    store,
    from(table) {
      if (!TABLES.includes(table)) throw new Error('Unsupported fake table: ' + table);
      return new FakeQuery(store, table, userId);
    }
  };
}

class FakeQuery {
  constructor(store, table, userId) {
    this.store = store;
    this.table = table;
    this.userId = userId;
    this.action = 'select';
    this.values = null;
    this.filters = [];
    this.orders = [];
    this.maximum = null;
    this.rangeStart = null;
    this.rangeEnd = null;
    this.returnRows = false;
    this.cardinality = 'many';
  }

  select() {
    this.returnRows = true;
    return this;
  }

  insert(values) {
    this.action = 'insert';
    this.values = values;
    return this;
  }

  update(values) {
    this.action = 'update';
    this.values = values;
    return this;
  }

  delete() {
    this.action = 'delete';
    return this;
  }

  eq(column, value) { this.filters.push({ column, operator: 'eq', value }); return this; }
  gte(column, value) { this.filters.push({ column, operator: 'gte', value }); return this; }
  lte(column, value) { this.filters.push({ column, operator: 'lte', value }); return this; }
  order(column, options = {}) {
    this.orders.push({
      column,
      ascending: options.ascending !== false,
      nullsFirst: options.nullsFirst ?? options.ascending === false
    });
    return this;
  }
  limit(value) { this.maximum = value; return this; }
  range(start, end) { this.rangeStart = start; this.rangeEnd = end; return this; }
  single() { this.cardinality = 'single'; return this.execute(); }
  maybeSingle() { this.cardinality = 'maybeSingle'; return this.execute(); }
  then(resolve, reject) { return this.execute().then(resolve, reject); }

  async execute() {
    try {
      const rows = this.store[this.table];
      if (this.action === 'insert') return result(this.insertRows(rows));
      const visible = rows.filter((row) => this.isVisible(row) && this.matches(row));
      if (this.action === 'select') return result(this.selectRows(visible));
      if (this.action === 'update') return result(this.updateRows(visible));
      if (this.action === 'delete') return result(this.deleteRows(rows, visible));
      return result(null);
    } catch (error) {
      return { data: null, error: { code: error.code || 'UNKNOWN', message: error.message } };
    }
  }

  insertRows(rows) {
    const inputs = Array.isArray(this.values) ? this.values : [this.values];
    const created = inputs.map((input) => {
      const row = { ...defaultsFor(this.table), ...input };
      if (this.table !== 'profiles' && !row.id) row.id = crypto.randomUUID();
      if (this.table !== 'profiles' && row.user_id !== this.userId) throw fakeError('42501', 'row-level security policy');
      if (this.table === 'payroll_entries' && row.employment_id != null) {
        const employment = this.store.employments.find((job) => job.id === row.employment_id && job.user_id === this.userId);
        if (!employment) throw fakeError('23503', 'employment foreign key violation');
      }
      if (this.table === 'shifts' && row.employment_id != null) {
        const employment = this.store.employments.find((job) => job.id === row.employment_id && job.user_id === this.userId);
        if (!employment) throw fakeError('23503', 'employment foreign key violation');
      }
      if (this.table === 'application_events') {
        const application = this.store.applications.find((app) => app.id === row.application_id && app.user_id === this.userId);
        if (!application) throw fakeError('23503', 'application foreign key violation');
      }
      rows.push(row);
      return { ...row };
    });
    return this.returnRows ? this.cardinalResult(created) : null;
  }

  selectRows(rows) {
    let selected = rows.slice();
    for (const order of this.orders.slice().reverse()) {
      selected.sort((a, b) => compareForOrder(a[order.column], b[order.column], order));
    }
    if (this.rangeStart != null) selected = selected.slice(this.rangeStart, this.rangeEnd + 1);
    if (this.maximum != null) selected = selected.slice(0, this.maximum);
    selected = selected.map((row) => ({ ...row }));
    return this.cardinalityResult(selected);
  }

  updateRows(rows) {
    const updated = rows.map((row) => {
      Object.assign(row, this.values);
      if (this.table === 'applications') row.updated_at = new Date().toISOString();
      return { ...row };
    });
    return this.returnRows ? this.cardinalityResult(updated) : null;
  }

  deleteRows(allRows, rows) {
    for (const row of rows) {
      const index = allRows.indexOf(row);
      if (index >= 0) allRows.splice(index, 1);
      if (this.table === 'applications') {
        this.store.application_events = this.store.application_events.filter((event) => event.application_id !== row.id);
      }
      if (this.table === 'employments') {
        for (const linked of [...this.store.shifts, ...this.store.payroll_entries]) {
          if (linked.user_id === row.user_id && linked.employment_id === row.id) linked.employment_id = null;
        }
      }
    }
    return this.returnRows ? this.cardinalityResult(rows.map((row) => ({ ...row }))) : null;
  }

  cardinalityResult(rows) {
    if (this.cardinality === 'many') return rows;
    if (rows.length > 1) throw fakeError('PGRST116', 'Multiple rows returned');
    if (!rows.length && this.cardinality === 'single') throw fakeError('PGRST116', 'No rows returned');
    return rows[0] || null;
  }

  cardinalResult(rows) { return this.cardinalityResult(rows); }

  isVisible(row) {
    return this.table === 'profiles' ? row.id === this.userId : row.user_id === this.userId;
  }

  matches(row) {
    return this.filters.every(({ column, operator, value }) => {
      if (operator === 'eq') return row[column] === value;
      if (operator === 'gte') return row[column] >= value;
      if (operator === 'lte') return row[column] <= value;
      return false;
    });
  }
}

function defaultsFor(table) {
  const now = new Date().toISOString();
  if (table === 'employments') return { job_title: null, hourly_rate: null, start_date: null, end_date: null, is_current: true };
  if (table === 'shifts') return { employment_id: null, day_type: 'duty', time_in: null, time_out: null, break_minutes: 0, is_overtime: false, notes: null };
  if (table === 'applications') return { status: 'pending', source: null, job_url: null, location: null, contact_name: null, contact_email: null, notes: null, updated_at: now };
  if (table === 'application_events') return { notes: null };
  if (table === 'payroll_entries') return { employment_id: null, period_start: null, period_end: null, gross: null, deductions: 0, notes: null };
  return {};
}

function result(data) { return { data, error: null, count: null }; }
function fakeError(code, message) { return Object.assign(new Error(message), { code }); }
function compareForOrder(a, b, order) {
  if (a == null || b == null) {
    if (a == null && b == null) return 0;
    return (a == null) === order.nullsFirst ? -1 : 1;
  }
  if (a === b) return 0;
  const result = a < b ? -1 : a > b ? 1 : 0;
  return result * (order.ascending ? 1 : -1);
}
