export async function cleanupE2EPrefix(page, prefix = 'E2E-') {
  return page.evaluate(async (recordPrefix) => {
    const { getRepo } = await import('/src/js/data/index.js');
    const repo = getRepo();
    const startsWithPrefix = (value) => typeof value === 'string' && value.startsWith(recordPrefix);
    const [employments, shifts, payrollEntries, applications] = await Promise.all([
      repo.employments.list(),
      repo.shifts.listBetween('0001-01-01', '9999-12-31'),
      repo.payrollEntries.list({ limit: 5000 }),
      repo.applications.list({ limit: 5000 })
    ]);
    const employerIds = new Set(employments
      .filter((row) => startsWithPrefix(row.employer_name))
      .map((row) => row.id));
    const targets = [
      ['shift', shifts.filter((row) => startsWithPrefix(row.notes) || employerIds.has(row.employment_id)),
        (row) => `${row.work_date} ${row.notes || '(no notes)'}`, repo.shifts],
      ['payday', payrollEntries.filter((row) => startsWithPrefix(row.notes) || employerIds.has(row.employment_id)),
        (row) => `${row.pay_date} ${row.notes || '(no notes)'}`, repo.payrollEntries],
      ['application', applications.filter((row) => startsWithPrefix(row.company) || startsWithPrefix(row.notes)),
        (row) => row.company, repo.applications],
      ['job', employments.filter((row) => startsWithPrefix(row.employer_name)),
        (row) => row.employer_name, repo.employments]
    ];
    const failedNames = [];
    for (const [kind, rows, nameOf, collection] of targets) {
      for (const row of rows) {
        try {
          await collection.remove(row.id);
        } catch {
          failedNames.push(`${kind}: ${nameOf(row)}`);
        }
      }
    }

    const [remainingEmployments, remainingShifts, remainingPayroll, remainingApplications] = await Promise.all([
      repo.employments.list(),
      repo.shifts.listBetween('0001-01-01', '9999-12-31'),
      repo.payrollEntries.list({ limit: 5000 }),
      repo.applications.list({ limit: 5000 })
    ]);
    const remainingEmployerIds = new Set(remainingEmployments
      .filter((row) => startsWithPrefix(row.employer_name))
      .map((row) => row.id));
    const leftoverNames = [
      ...remainingShifts.filter((row) => startsWithPrefix(row.notes) || remainingEmployerIds.has(row.employment_id))
        .map((row) => `shift: ${row.work_date} ${row.notes || '(no notes)'}`),
      ...remainingPayroll.filter((row) => startsWithPrefix(row.notes) || remainingEmployerIds.has(row.employment_id))
        .map((row) => `payday: ${row.pay_date} ${row.notes || '(no notes)'}`),
      ...remainingApplications.filter((row) => startsWithPrefix(row.company) || startsWithPrefix(row.notes))
        .map((row) => `application: ${row.company}`),
      ...remainingEmployments.filter((row) => startsWithPrefix(row.employer_name))
        .map((row) => `job: ${row.employer_name}`)
    ];
    return { leftovers: [...new Set([...failedNames, ...leftoverNames])] };
  }, prefix);
}

export function formatLeftovers(result) {
  return result.leftovers.length ? result.leftovers.join('; ') : '';
}
