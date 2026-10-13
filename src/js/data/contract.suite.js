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
      ...[sameDateA.id, sameDateB.id].sort(),
      fractionalEarlier.id,
      fractionalLater.id,
      later.id
    ]);
    const updated = await repo.applicationEvents.update(later.id, { notes: 'Updated event' });
    assert.equal(updated.notes, 'Updated event');
    assert.equal(await repo.applicationEvents.remove(later.id), undefined);
    assert.equal((await repo.applicationEvents.listForApplication(application.id)).some((row) => row.id === later.id), false);
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

      assert.equal((await userA.profile.get()).id, USER_A);
      await userA.profile.update({ display_name: 'A only' });
      assert.equal((await userB.profile.get()).display_name, profileB.display_name);
      assert.deepEqual((await userA.employments.list()).map((row) => row.id), [spoofedEmployment.id]);
      assert.deepEqual(await userA.shifts.listBetween('2025-01-01', '2025-01-01'), []);
      assert.deepEqual(await userA.applications.list(), []);
      assert.deepEqual(await userA.applicationEvents.listForApplication(applicationB.id), []);

      await assert.rejects(userA.employments.update(employmentB.id, { employer_name: 'Changed' }), (error) => error instanceof DataError && error.code === 'not_found');
      await assert.rejects(userA.shifts.update(shiftB.id, { notes: 'Changed' }), (error) => error instanceof DataError && error.code === 'not_found');
      await assert.rejects(userA.applications.update(applicationB.id, { company: 'Changed' }), (error) => error instanceof DataError && error.code === 'not_found');
      await assert.rejects(userA.applicationEvents.update(eventB.id, { notes: 'Changed' }), (error) => error instanceof DataError && error.code === 'not_found');
      await assert.rejects(userA.shifts.create({ work_date: '2025-01-02', employment_id: employmentB.id }), (error) => error instanceof DataError && error.code === 'permission');
      await assert.rejects(userA.applicationEvents.create({
        application_id: applicationB.id, event_type: 'note', event_date: '2025-01-02T12:00:00.000Z'
      }), (error) => error instanceof DataError && error.code === 'permission');

      await userA.employments.remove(employmentB.id);
      await userA.shifts.remove(shiftB.id);
      await userA.applications.remove(applicationB.id);
      await userA.applicationEvents.remove(eventB.id);
      assert.equal((await userB.employments.list()).length, 1);
      assert.equal((await userB.shifts.listBetween('2025-01-01', '2025-01-01')).length, 1);
      assert.equal((await userB.applications.list()).length, 1);
      assert.equal((await userB.applicationEvents.listForApplication(applicationB.id)).length, 1);
    });
  } else {
    test('repository scopes reads and writes to the current user', { skip: 'This repository factory does not model multiple users.' }, () => {});
  }
}
