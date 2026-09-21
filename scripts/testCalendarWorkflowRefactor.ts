import { resolveOfficialCalendar, applyManualCalendarOverride, confirmCalendarWorkflow, resetCalendarToOfficial, getAvailableProvinces, getAvailableAcademicYears } from '../src/services/calendarResolver';
import { calculateEffectiveDays, calculateEffectiveWeeks, calculateAvailableJP } from '../src/services/jpEngine';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

console.log('--- STARTING CALENDAR WORKFLOW REFACTOR TESTS ---');

// Test 1: Auto Resolve for Jawa Barat 2026/2027 Semester 1
{
  const res = resolveOfficialCalendar({
    province: 'Jawa Barat',
    academicYear: '2026/2027',
    semester: '1',
    academicSettingId: 'acad-test-1',
    calendarId: 'cal-test-1',
    schoolDaysPerWeek: 5,
    subjectWeeklyJP: 4,
  });

  assert(res.isResolved === true, 'Jawa Barat 2026/2027 must resolve successfully');
  assert(res.calendar !== null, 'Calendar object must not be null');
  assert(res.calendar!.startDate === '2026-07-13', 'Start date must match official Jabar Kaldik 2026/2027');
  assert(res.calendar!.endDate === '2026-12-18', 'End date must match official Jabar Kaldik 2026/2027');
  assert(res.calendar!.workflowStatus === 'AUTO_RESOLVED', 'Workflow status must be AUTO_RESOLVED');
  assert(res.calendar!.sourceType === 'REGIONAL_EDUCATION_CALENDAR', 'Source type must be REGIONAL_EDUCATION_CALENDAR');
  assert(res.calendar!.provenance !== undefined, 'Provenance must be populated');
  assert(res.calendar!.provenance?.region === 'Jawa Barat', 'Provenance region must match');
  assert(res.days.length > 0, 'Calendar days must include regional events and national holidays');

  // Verify national holiday overlay presence (e.g., HUT RI 17 Agustus 2026)
  const hutRi = res.days.find(d => d.date === '2026-08-17');
  assert(hutRi !== undefined, 'HUT RI 2026-08-17 must be present from SKB 3 Menteri overlay');
  assert(hutRi!.sourceType === 'NATIONAL_HOLIDAY_OVERLAY', 'HUT RI must have source NATIONAL_HOLIDAY_OVERLAY');

  console.log('✅ Test 1 Passed: Auto-resolve for Jawa Barat 2026/2027');
}

// Test 2: Auto Resolve for DKI Jakarta 2025/2026 Semester 2
{
  const res = resolveOfficialCalendar({
    province: 'DKI Jakarta',
    academicYear: '2025/2026',
    semester: '2',
    academicSettingId: 'acad-test-2',
    calendarId: 'cal-test-2',
    schoolDaysPerWeek: 5,
    subjectWeeklyJP: 5,
  });

  assert(res.isResolved === true, 'DKI Jakarta 2025/2026 must resolve successfully');
  assert(res.calendar!.startDate === '2026-01-05', 'DKI Semester 2 start date must match');
  assert(res.calendar!.endDate === '2026-06-19', 'DKI Semester 2 end date must match');
  console.log('✅ Test 2 Passed: Auto-resolve for DKI Jakarta 2025/2026');
}

// Test 3: Fail Closed on Unknown Province or Academic Year (NO DATA > FAKE DATA)
{
  const resUnknown = resolveOfficialCalendar({
    province: 'Provinsi Antah Berantah',
    academicYear: '2099/2100',
    semester: '1',
    academicSettingId: 'acad-test-unknown',
  });

  console.log('resUnknown diagnostic:', resUnknown.diagnostic);
  assert(resUnknown.isResolved === false, 'Unknown region must fail closed');
  assert(resUnknown.calendar === null, 'Calendar must be null for unknown region');
  assert(resUnknown.days.length === 0, 'Days must be empty for unknown region');
  assert(resUnknown.diagnostic.includes('belum terdaftar') || resUnknown.diagnostic.includes('tidak ditemukan'), 'Diagnostic message must explain lack of official data');
  console.log('✅ Test 3 Passed: Fail closed without fabricating dates');
}

// Test 4: Manual Override Workflow
{
  const resolved = resolveOfficialCalendar({
    province: 'Jawa Tengah',
    academicYear: '2026/2027',
    semester: '1',
    academicSettingId: 'acad-test-4',
  });

  const overridden = applyManualCalendarOverride(
    resolved.calendar!,
    resolved.days,
    { startDate: '2026-07-25', overrideReason: 'Penyesuaian renovasi gedung sekolah' },
    [
      ...resolved.days,
      {
        id: 'day-custom-1',
        academicCalendarId: resolved.calendar!.id,
        date: '2026-08-10',
        status: 'holiday',
        notes: 'Hari Ulang Tahun Sekolah',
        sourceType: 'SCHOOL_OVERRIDE',
        isOverridden: true,
      }
    ]
  );

  assert(overridden.calendar.workflowStatus === 'MANUAL_OVERRIDE', 'Status must be MANUAL_OVERRIDE');
  assert(overridden.calendar.isOverridden === true, 'isOverridden must be true');
  assert(overridden.calendar.startDate === '2026-07-25', 'Updated start date must persist');
  assert(overridden.days.some(d => d.date === '2026-08-10'), 'Custom school holiday must be present');
  console.log('✅ Test 4 Passed: Manual Override flow');
}

// Test 5: Confirm Workflow
{
  const resolved = resolveOfficialCalendar({
    province: 'Jawa Timur',
    academicYear: '2026/2027',
    semester: '1',
    academicSettingId: 'acad-test-5',
  });

  const confirmed = confirmCalendarWorkflow(resolved.calendar!, resolved.days);
  assert(confirmed.calendar.workflowStatus === 'CONFIRMED', 'Status must be CONFIRMED');
  assert(confirmed.calendar.reviewStatus === 'CONFIRMED', 'Review status must be CONFIRMED');
  assert(confirmed.calendar.confirmedAt !== undefined, 'confirmedAt must be recorded');
  console.log('✅ Test 5 Passed: Confirm workflow');
}

// Test 6: Reset to Official
{
  const resolved = resolveOfficialCalendar({
    province: 'Jawa Barat',
    academicYear: '2026/2027',
    semester: '1',
    academicSettingId: 'acad-test-6',
  });

  const overridden = applyManualCalendarOverride(
    resolved.calendar!,
    resolved.days,
    { startDate: '2026-08-01' }
  );

  const reset = resetCalendarToOfficial('Jawa Barat', '2026/2027', '1', 'acad-test-6', resolved.calendar!.id);
  assert(reset.isResolved === true, 'Reset must successfully re-resolve');
  assert(reset.calendar!.startDate === '2026-07-13', 'Start date must be reset to official Kaldik Jabar');
  assert(reset.calendar!.workflowStatus === 'AUTO_RESOLVED', 'Status must be AUTO_RESOLVED');
  assert(reset.calendar!.isOverridden === false, 'isOverridden must be false');
  console.log('✅ Test 6 Passed: Reset to official');
}

console.log('🎉 ALL 6 CALENDAR WORKFLOW TESTS PASSED PERFECTLY!');
