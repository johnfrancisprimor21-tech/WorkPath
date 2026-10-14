import test from 'node:test';
import assert from 'node:assert/strict';
import { DataError } from './errors.js';

const USER_A = '00000000-0000-4000-8000-000000000001';
const USER_B = '00000000-0000-4000-8000-000000000002';

/** Register reusable tests for an implementation of WorkpathRepo. */
export function runContractTests(makeRepo) {
  test('profile get and update', async () => {
    const repo = await makeRepo();
    const initial = await repo.profile.get();
    assert.equal(initial.id, USER_A);
    const updated = await repo.profile.update({ display_name: 'Contract user' });
    assert.equal(updated.id, USER_A);
    assert.equal(updated.display_name, 'Contract user');
    assert.equal((await repo.profile.get()).display_name, 'Contract user');
  });

  test('new profiles and records use the database defaults', async () => {
    const repo = await makeRepo();
    const profile = await repo.profile.get();
    assert.equal(profile.mode, 'job_seeker');
    assert.equal(profile.currency, null);
    assert.equal(profile.pay_frequency, null);
    assert.equal(profile.timezone, null);
    assert.equal(profile.onboarded, false);

    const employment = await repo.employments.create({ employer_name: 'Defaults Co' });
    assert.equal(employment.job_title, null);
    assert.equal(employment.hourly_rate, null);
    assert.equal(employment.start_date, null);
    assert.equal(employment.end_date, null);
    assert.equal(employment.is_current, true);

    const shift = await repo.shifts.create({ work_date: '2025-04-01' });
    assert.equal(shift.employment_id, null);
    assert.equal(shift.day_type, 'duty');
    assert.equal(shift.time_in, null);
    assert.equal(shift.time_out, null);
    assert.equal(shift.break_minutes, 0);
    assert.equal(shift.is_overtime, false);
    assert.equal(shift.notes, null);

    const application = await repo.applications.create({ company: 'Defaults Co', position: 'Role', date_applied: '2025-04-01' });
    assert.equal(application.status, 'pending');
    assert.equal(application.source, null);
    const event = await repo.applicationEvents.create({
      application_id: application.id, event_type: 'note', event_date: '2025-04-01T12:00:00Z'
    });
    assert.equal(event.notes, null);
  });

  test('employments create, list order, update, remove, and set-null shift links', async () => {
    const repo = await makeRepo();
    const olderCurrent = await repo.employments.create({ employer_name: 'Older current', start_date: '2024-01-01' });
    const recentCurrentA = await repo.employments.create({ employer_name: 'Recent current A', start_date: '2025-01-01' });
    const recentCurrentB = await repo.employments.create({ employer_name: 'Recent current B', start_date: '2025-01-01' });
    const ended = await repo.employments.create({ employer_name: 'Ended', is_current: false, start_date: '2026-01-01' });
    const undated = await repo.employments.create({ employer_name: 'Undated', is_current: false });
    for (const row of [olderCurrent, recentCurrentA, recentCurrentB, ended, undated]) {
      assert.match(row.id, /^[0-9a-f-]{36}$/i);
      assert.equal(row.user_id, USER_A);
    }
    assert.deepEqual((await repo.employments.list()).map((row) => row.id), [
      ...[recentCurrentA.id, recentCurrentB.id].sort(),
      olderCurrent.id,
      ended.id,
      undated.id
    ]);
    const changed = await repo.employments.update(olderCurrent.id, { job_title: 'Updated title', hourly_rate: 25.5 });
    assert.equal(changed.job_title, 'Updated title');
    assert.equal(changed.hourly_rate, 25.5);
    const linkedShift = await repo.shifts.create({
      employment_id: olderCurrent.id,
      work_date: '2025-03-04',
      day_type: 'duty'
    });
    assert.equal(await repo.employments.remove(olderCurrent.id), undefined);
    assert.equal((await repo.shifts.listBetween('2025-03-04', '2025-03-04')).find((row) => row.id === linkedShift.id).employment_id, null);
    await repo.employments.remove(recentCurrentA.id);
    assert.equal((await repo.employments.list()).some((row) => row.id === recentCurrentA.id), false);
  });

  test('shifts create, inclusive range, fixed order, worked minutes, update, remove', async () => {
    const repo = await makeRepo();
    const one = await repo.shifts.create({
      work_date: '2025-04-02', day_type: 'duty',
      time_in: '2025-04-02T10:00:00.000Z', time_out: '2025-04-02T18:00:00.000Z', break_minutes: 30
    });
    const sameStartA = await repo.shifts.create({
      work_date: '2025-04-02', day_type: 'duty', time_in: '2025-04-02T08:00:00.000Z', time_out: '2025-04-02T09:00:00.000Z'
    });
    const sameStartB = await repo.shifts.create({
      work_date: '2025-04-02', day_type: 'duty', time_in: '2025-04-02T08:00:00.000Z', time_out: '2025-04-02T09:00:00.000Z'
    });
    const noTime = await repo.shifts.create({ work_date: '2025-04-02', day_type: 'off' });
    const lastDay = await repo.shifts.create({ work_date: '2025-04-03', day_type: 'holiday' });
    const beforeRange = await repo.shifts.create({ work_date: '2025-04-01', day_type: 'leave' });
    const outsideRange = await repo.shifts.create({ work_date: '2025-04-04', day_type: 'duty' });
    assert.equal(one.worked_minutes, 450);
    const listed = await repo.shifts.listBetween('2025-04-02', '2025-04-03');
    assert.deepEqual(listed.map((row) => row.id), [
      ...[sameStartA.id, sameStartB.id].sort(),
      one.id,
      noTime.id,
      lastDay.id
    ]);
    assert.equal(listed.some((row) => row.id === beforeRange.id), false);
    assert.equal(listed.some((row) => row.id === outsideRange.id), false);
    const updated = await repo.shifts.update(one.id, { notes: 'Updated note' });
    assert.equal(updated.notes, 'Updated note');
    assert.equal(await repo.shifts.remove(one.id), undefined);
    assert.equal((await repo.shifts.listBetween('2025-04-02', '2025-04-02')).some((row) => row.id === one.id), false);
  });

  test('applications create, fixed order, update, remove, and cascade events', async () => {
    const repo = await makeRepo();
    const old = await repo.applications.create({ company: 'Old', position: 'Role', date_applied: '2025-01-01' });
    const sameDateA = await repo.applications.create({ company: 'Same A', position: 'Role', date_applied: '2025-02-01' });
    const sameDateB = await repo.applications.create({ company: 'Same B', position: 'Role', date_applied: '2025-02-01' });
    const newest = await repo.applications.create({ company: 'New', position: 'Role', date_applied: '2025-03-01' });
    assert.deepEqual((await repo.applications.list()).map((row) => row.id), [
      newest.id,
      ...[sameDateA.id, sameDateB.id].sort(),
      old.id
    ]);
    assert.deepEqual((await repo.applications.list({ limit: 2 })).map((row) => row.id), [newest.id, ...[sameDateA.id, sameDateB.id].sort()].slice(0, 2));
    const updated = await repo.applications.update(old.id, { company: 'Updated company' });
    assert.equal(updated.company, 'Updated company');
    const event = await repo.applicationEvents.create({
      application_id: old.id, event_type: 'note', event_date: '2025-01-02T10:00:00.000Z', notes: 'Will cascade'
    });
    assert.equal(event.user_id, USER_A);
    assert.equal(await repo.applications.remove(old.id), undefined);
    assert.deepEqual(await repo.applicationEvents.listForApplication(old.id), []);
  });

  test('application status change updates first and creates a timeline event', async () => {
    const repo = await makeRepo();
    const application = await repo.applications.create({ company: 'Status Co', position: 'Role', date_applied: '2025-04-01' });
    const result = await repo.applications.changeStatus(application.id, 'interview');
    assert.equal(result.application.status, 'interview');
    assert.equal(result.warning, false);
    const [event] = await repo.applicationEvents.listForApplication(application.id);
    assert.equal(event.event_type, 'status_changed');
    assert.equal(event.notes, 'pending -> interview');
    assert.ok(Number.isFinite(Date.parse(event.event_date)));
  });

  test('application events create, fixed order, update, and remove', async () => {
    const repo = await makeRepo();
    const application = await repo.applications.create({ company: 'Timeline Co', position: 'Role', date_applied: '2025-04-01' });
    const later = await repo.applicationEvents.create({ application_id: application.id, event_type: 'note', event_date: '2025-04-03T10:00:00.000Z' });
    const sameDateA = await repo.applicationEvents.create({ application_id: application.id, event_type: 'note', event_date: '2025-04-02T10:00:00.000Z' });
    const sameDateB = await repo.applicationEvents.create({ application_id: application.id, event_type: 'note', event_date: '2025-04-02T10:00:00.000Z' });
    const fractionalLater = await repo.applicationEvents.create({ application_id: application.id, event_type: 'note', event_date: '2025-04-02T10:00:00.000900Z' });
    const fractionalEarlier = await repo.applicationEvents.create({ application_id: application.id, event_type: 'note', event_date: '2025-04-02T10:00:00.000100Z' });
    const earlier = await repo.applicationEvents.create({ application_id: application.id, event_type: 'note', event_date: '2025-04-01T10:00:00.000Z' });
    assert.deepEqual((await repo.applicationEvents.listForApplication(application.id)).map((row) => row.id), [
      earlier.id,
      ...[sameDateA.id, sameDateB.id, fractionalEarlier.id, fractionalLater.id].sort(),
      later.id
    ]);
    const updated = await repo.applicationEvents.update(later.id, { notes: 'Updated event' });
    assert.equal(updated.notes, 'Updated event');
    assert.equal(await repo.applicationEvents.remove(later.id), undefined);
    assert.equal((await repo.applicationEvents.listForApplication(application.id)).some((row) => row.id === later.id), false);
  });

  test('payroll entries create, order, filter inclusively, update, remove, and set-null jobs', async () => {
    const repo = await makeRepo();
    const job = await repo.employments.create({ employer_name: 'Pay Co' });
    const older = await repo.payrollEntries.create({
      employment_id: job.id,
      pay_date: '2025-03-31',
      period_start: '2025-03-16',
      period_end: '2025-03-31',
      gross: 100.005,
      net: 90.001,
      notes: 'Month end'
    });
    const sameDayA = await repo.payrollEntries.create({ pay_date: '2025-04-01', net: 100 });
    const sameDayB = await repo.payrollEntries.create({ pay_date: '2025-04-01', gross: 110, deductions: 10, net: 100 });
    const newest = await repo.payrollEntries.create({ pay_date: '2025-04-02', net: 75 });

    assert.equal(older.gross, 100.01);
    assert.equal(older.net, 90);
    assert.equal(typeof older.deductions, 'number');
    assert.equal(older.deductions, 0);
    assert.equal(older.user_id, USER_A);
    assert.equal(sameDayA.employment_id, null);
    assert.equal(sameDayA.period_start, null);
    assert.equal(sameDayA.period_end, null);
    assert.equal(sameDayA.gross, null);
    assert.equal(sameDayA.deductions, 0);
    assert.equal(sameDayA.notes, null);
    assert.deepEqual((await repo.payrollEntries.list()).map((entry) => entry.id), [
      newest.id,
      ...[sameDayA.id, sameDayB.id].sort(),
      older.id
    ]);
    assert.deepEqual((await repo.payrollEntries.list({ limit: 2 })).map((entry) => entry.id), [
      newest.id,
      ...[sameDayA.id, sameDayB.id].sort()
    ].slice(0, 2));
    assert.deepEqual((await repo.payrollEntries.listBetween('2025-04-01', '2025-04-01')).map((entry) => entry.id),
      [sameDayA.id, sameDayB.id].sort());
    const updated = await repo.payrollEntries.update(older.id, { net: 88.888, notes: 'Adjusted' });
    assert.equal(updated.net, 88.89);
    assert.equal(updated.notes, 'Adjusted');

    const linked = await repo.payrollEntries.create({ employment_id: job.id, pay_date: '2025-04-03', net: 50 });
    assert.equal(await repo.employments.remove(job.id), undefined);
    assert.equal((await repo.payrollEntries.list()).find((entry) => entry.id === linked.id).employment_id, null);
    assert.equal(await repo.payrollEntries.remove(older.id), undefined);
    assert.equal((await repo.payrollEntries.list()).some((entry) => entry.id === older.id), false);
    await assert.rejects(repo.payrollEntries.listBetween('2025-04-02', '2025-04-01'),
      (error) => error instanceof DataError && error.code === 'validation');
    await assert.rejects(repo.payrollEntries.list({ limit: -1 }),
      (error) => error instanceof DataError && error.code === 'validation');
  });

  test('payroll amount and date validation uses validation DataErrors', async () => {
    const repo = await makeRepo();
    const invalidEntries = [
      { net: 10 },
      { pay_date: '2025-02-30', net: 10 },
      { pay_date: '2025-04-01', period_start: '2025-02-30', period_end: '2025-04-02', net: 10 },
      { pay_date: '2025-04-01', period_start: '2025-04-02', period_end: '2025-04-01', net: 10 },
      { pay_date: '2025-04-01', net: null },
      { pay_date: '2025-04-01', net: -0.01 },
      { pay_date: '2025-04-01', gross: -1, net: 1 },
      { pay_date: '2025-04-01', deductions: -1, net: 1 },
      { pay_date: '2025-04-01', net: 10_000_000_000 },
      { pay_date: '2025-04-01', gross: 10_000_000_000, net: 1 },
      { pay_date: '2025-04-01', deductions: 10_000_000_000, net: 1 }
    ];
    for (const input of invalidEntries) {
      await assert.rejects(repo.payrollEntries.create(input),
        (error) => error instanceof DataError && error.code === 'validation');
    }
    const job = await repo.employments.create({ employer_name: 'Own job' });
    await assert.rejects(repo.payrollEntries.create({ pay_date: '2025-04-01', employment_id: 'not-a-job', net: 1 }),
      (error) => error instanceof DataError && error.code === 'permission');
    const entry = await repo.payrollEntries.create({ pay_date: '2025-04-01', employment_id: job.id, net: 1 });
    await assert.rejects(repo.payrollEntries.update(entry.id, { net: -1 }),
      (error) => error instanceof DataError && error.code === 'validation');
  });

  test('invalid entity values reject with validation errors', async () => {
    const repo = await makeRepo();
    await repo.profile.get();
    await assert.rejects(
      repo.profile.update({ onboarded: true }),
      (error) => error instanceof DataError && error.code === 'validation'
    );
    await assert.rejects(
      repo.profile.update({ currency: 'usd' }),
      (error) => error instanceof DataError && error.code === 'validation'
    );
    await assert.rejects(
      repo.profile.update({ pay_frequency: 'yearly' }),
      (error) => error instanceof DataError && error.code === 'validation'
    );
    await assert.rejects(
      repo.profile.update({ mode: 'freelancer' }),
      (error) => error instanceof DataError && error.code === 'validation'
    );
    await assert.rejects(
      repo.employments.create({ employer_name: null }),
      (error) => error instanceof DataError && error.code === 'validation'
    );
    await assert.rejects(
      repo.employments.create({ employer_name: 'Invalid rate', hourly_rate: 100000000 }),
      (error) => error instanceof DataError && error.code === 'validation'
    );
    await assert.rejects(
      repo.employments.create({ employer_name: 'Invalid dates', start_date: '2025-05-01', end_date: '2025-04-01' }),
      (error) => error instanceof DataError && error.code === 'validation'
    );
    await assert.rejects(
      repo.shifts.create({ work_date: '2025-04-01', break_minutes: -1 }),
      (error) => error instanceof DataError && error.code === 'validation'
    );
    await assert.rejects(
      repo.shifts.create({ work_date: '2025-04-01', break_minutes: 2_147_483_648 }),
      (error) => error instanceof DataError && error.code === 'validation'
    );
    await assert.rejects(
      repo.shifts.create({ work_date: '2025-04-01', day_type: 'vacation' }),
      (error) => error instanceof DataError && error.code === 'validation'
    );
    await assert.rejects(
      repo.shifts.create({ work_date: '2025-04-01', time_in: '2025-04-01T10:00:00Z', time_out: '2025-04-01T09:00:00Z' }),
      (error) => error instanceof DataError && error.code === 'validation'
    );
    await assert.rejects(
      repo.applications.create({ company: 'Invalid', position: 'Role', date_applied: '2025-04-01', status: 'unknown' }),
      (error) => error instanceof DataError && error.code === 'validation'
    );
    const application = await repo.applications.create({ company: 'Valid', position: 'Role', date_applied: '2025-04-01' });
    await assert.rejects(
      repo.applicationEvents.create({ application_id: application.id, event_type: '', event_date: '2025-04-01T00:00:00Z' }),
      (error) => error instanceof DataError && error.code === 'validation'
    );
  });

  test('repository timestamps are normalized ISO UTC strings ending in Z', async () => {
    const repo = await makeRepo();
    const profile = await repo.profile.get();
    assertIsoUtc(profile.created_at);
    const shift = await repo.shifts.create({
      work_date: '2025-04-01',
      time_in: '2025-04-01T08:00:00+08:00',
      time_out: '2025-04-01T16:00:00+08:00'
    });
    assertIsoUtc(shift.time_in);
    assertIsoUtc(shift.time_out);
    assert.equal(shift.time_in, '2025-04-01T00:00:00.000Z');
    const application = await repo.applications.create({ company: 'UTC Co', position: 'Role', date_applied: '2025-04-01' });
    assertIsoUtc(application.updated_at);
    const event = await repo.applicationEvents.create({
      application_id: application.id,
      event_type: 'note',
      event_date: '2025-04-01T12:00:00+08:00'
    });
    assertIsoUtc(event.event_date);
    assert.equal(event.event_date, '2025-04-01T04:00:00.000Z');
  });

  if (typeof makeRepo.createStore === 'function') {
    test('repository scopes reads and writes to the current user', async () => {
      const store = makeRepo.createStore();
      const userA = await makeRepo({ userId: USER_A, store });
      const userB = await makeRepo({ userId: USER_B, store });
      const profileB = await userB.profile.get();
      const spoofedEmployment = await userA.employments.create({ employer_name: 'A-owned', user_id: USER_B });
      assert.equal(spoofedEmployment.user_id, USER_A);
      const employmentB = await userB.employments.create({ employer_name: 'B job' });
      const shiftB = await userB.shifts.create({ work_date: '2025-01-01', employment_id: employmentB.id });
      const applicationB = await userB.applications.create({ company: 'B company', position: 'Role', date_applied: '2025-01-01' });
      const eventB = await userB.applicationEvents.create({
        application_id: applicationB.id, event_type: 'note', event_date: '2025-01-01T12:00:00.000Z'
      });
      const payrollB = await userB.payrollEntries.create({ pay_date: '2025-01-01', net: 250 });

      assert.equal((await userA.profile.get()).id, USER_A);
      await userA.profile.update({ display_name: 'A only' });
      assert.equal((await userB.profile.get()).display_name, profileB.display_name);
      assert.deepEqual((await userA.employments.list()).map((row) => row.id), [spoofedEmployment.id]);
      assert.deepEqual(await userA.shifts.listBetween('2025-01-01', '2025-01-01'), []);
      assert.deepEqual(await userA.applications.list(), []);
      assert.deepEqual(await userA.applicationEvents.listForApplication(applicationB.id), []);
      assert.deepEqual(await userA.payrollEntries.list(), []);

      await assert.rejects(userA.employments.update(employmentB.id, { employer_name: 'Changed' }), (error) => error instanceof DataError && error.code === 'not_found');
      await assert.rejects(userA.shifts.update(shiftB.id, { notes: 'Changed' }), (error) => error instanceof DataError && error.code === 'not_found');
      await assert.rejects(userA.applications.update(applicationB.id, { company: 'Changed' }), (error) => error instanceof DataError && error.code === 'not_found');
      await assert.rejects(userA.applicationEvents.update(eventB.id, { notes: 'Changed' }), (error) => error instanceof DataError && error.code === 'not_found');
      await assert.rejects(userA.payrollEntries.update(payrollB.id, { net: 1 }), (error) => error instanceof DataError && error.code === 'not_found');
      await assert.rejects(userA.shifts.create({ work_date: '2025-01-02', employment_id: employmentB.id }), (error) => error instanceof DataError && error.code === 'permission');
      await assert.rejects(userA.applicationEvents.create({
        application_id: applicationB.id, event_type: 'note', event_date: '2025-01-02T12:00:00.000Z'
      }), (error) => error instanceof DataError && error.code === 'permission');
      await assert.rejects(userA.payrollEntries.create({ pay_date: '2025-01-02', employment_id: employmentB.id, net: 1 }),
        (error) => error instanceof DataError && error.code === 'permission');

      await userA.employments.remove(employmentB.id);
      await userA.shifts.remove(shiftB.id);
      await userA.applications.remove(applicationB.id);
      await userA.applicationEvents.remove(eventB.id);
      await userA.payrollEntries.remove(payrollB.id);
      assert.equal((await userB.employments.list()).length, 1);
      assert.equal((await userB.shifts.listBetween('2025-01-01', '2025-01-01')).length, 1);
      assert.equal((await userB.applications.list()).length, 1);
      assert.equal((await userB.applicationEvents.listForApplication(applicationB.id)).length, 1);
      assert.equal((await userB.payrollEntries.list()).length, 1);
    });
  } else {
    test('repository scopes reads and writes to the current user', { skip: 'This repository factory does not model multiple users.' }, () => {});
  }
}

function assertIsoUtc(value) {
  assert.match(value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
}
