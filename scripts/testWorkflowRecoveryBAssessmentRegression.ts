import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  deriveAutoDraftAssessmentPlan,
  generateAutoDraftPlansFromCanonicalContext,
  recommendInstrumentsForCompetency,
  resolveTargetTPSelection,
  validateAssessmentPlan,
  confirmAssessmentPlan,
  createEmptyAssessmentPlan,
} from '../src/services/assessmentPlanService';
import {
  AcademicSetting,
  TPData,
  K13Analysis,
  AssessmentCriterion,
  LearningPlan,
  AssessmentPlan,
} from '../src/types';

console.log('=== RUNNING WORKFLOW RECOVERY B ASSESSMENT REGRESSION SUITE ===');

const mockSettingMerdeka: AcademicSetting = {
  id: 'set-merdeka-1',
  profileId: 'prof-1',
  phase: 'E',
  curriculum: 'Kurikulum Merdeka',
  curriculumType: 'KURIKULUM_MERDEKA',
  academicYear: '2026/2027',
  semester: '1 (Ganjil)',
  level: 'SMA',
  grade: '10',
  subject: 'Bahasa Indonesia',
  subjectWeeklyJP: 3,
  updatedAt: new Date().toISOString(),
};

const mockSettingK13: AcademicSetting = {
  id: 'set-k13-1',
  profileId: 'prof-1',
  phase: 'D',
  curriculum: 'Kurikulum 2013',
  curriculumType: 'K13',
  academicYear: '2026/2027',
  semester: '1 (Ganjil)',
  level: 'SMP',
  grade: '8',
  subject: 'IPA',
  subjectWeeklyJP: 4,
  updatedAt: new Date().toISOString(),
};

const mockTPDataMulti: TPData = {
  id: 'tp-data-1',
  academicSettingId: 'set-merdeka-1',
  items: [
    {
      id: 'tp-101',
      code: 'TP 1.1',
      statement: 'Menganalisis struktur dan kaidah kebahasaan teks laporan hasil observasi',
      competence: 'Menganalisis',
      contentScope: 'Teks Laporan Hasil Observasi',
      order: 1,
    },
    {
      id: 'tp-102',
      code: 'TP 1.2',
      statement: 'Mempresentasikan hasil pengamatan dalam bentuk video demonstrasi',
      competence: 'Mempresentasikan',
      contentScope: 'Video Demonstrasi Pengamatan',
      order: 2,
    },
    {
      id: 'tp-103',
      code: 'TP 1.3',
      statement: 'Menyusun laporan tertulis secara objektif dan sistematis',
      competence: 'Menyusun',
      contentScope: 'Laporan Tertulis',
      order: 3,
    },
  ],
  updatedAt: new Date().toISOString(),
};

const mockTPDataSingle: TPData = {
  id: 'tp-data-single',
  academicSettingId: 'set-merdeka-1',
  items: [
    {
      id: 'tp-single-1',
      code: 'TP 2.1',
      statement: 'Mendemonstrasikan prosedur keselamatan kerja di laboratorium kimia',
      competence: 'Mendemonstrasikan',
      contentScope: 'Prosedur Keselamatan Kerja',
      order: 1,
    },
  ],
  updatedAt: new Date().toISOString(),
};

const mockCriteria: AssessmentCriterion[] = [
  {
    id: 'crit-101-1',
    academicSettingId: 'set-merdeka-1',
    tpId: 'tp-101',
    description: 'Mampu mengidentifikasi struktur teks laporan observasi dengan tepat',
    approach: 'rubrik',
    indicators: ['Identifikasi struktur', 'Kaidah kebahasaan'],
    levels: [],
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'crit-102-1',
    academicSettingId: 'set-merdeka-1',
    tpId: 'tp-102',
    description: 'Mampu mempresentasikan hasil pengamatan dengan artikulasi yang jelas',
    approach: 'rubrik',
    indicators: ['Artikulasi', 'Ketepatan materi'],
    levels: [],
    updatedAt: new Date().toISOString(),
  },
];

// TEST SUITE
describe('Workflow Recovery B - Assessment Auto-Drafting & Canonical TP Mapping', () => {
  it('1. recommendInstrumentsForCompetency maps cognitive verbs to WRITTEN_TEST/ASSIGNMENT', () => {
    const recs = recommendInstrumentsForCompetency({
      competence: 'Menganalisis',
      statement: 'Menganalisis struktur dan kaidah kebahasaan',
      subject: 'Bahasa Indonesia',
    });
    assert.ok(recs.length > 0);
    const types = recs.map((r) => r.type);
    assert.ok(types.includes('WRITTEN_TEST') || types.includes('ASSIGNMENT'), 'Should recommend written test or assignment for analytical competence');
    console.log('[PASS] 1. recommendInstrumentsForCompetency maps cognitive verbs to written instruments');
  });

  it('2. recommendInstrumentsForCompetency maps psychomotor verbs to PERFORMANCE/OBSERVATION', () => {
    const recs = recommendInstrumentsForCompetency({
      competence: 'Mendemonstrasikan',
      statement: 'Mendemonstrasikan teknik lompat jauh gaya menggantung',
      subject: 'PJOK',
    });
    assert.ok(recs.length > 0);
    const types = recs.map((r) => r.type);
    assert.ok(types.includes('PERFORMANCE') || types.includes('OBSERVATION'), 'Should recommend performance or observation for psychomotor competence');
    console.log('[PASS] 2. recommendInstrumentsForCompetency maps psychomotor verbs to PERFORMANCE/OBSERVATION');
  });

  it('3. resolveTargetTPSelection with explicit valid ID resolves directly', () => {
    const resolved = resolveTargetTPSelection({
      academicSetting: mockSettingMerdeka,
      tp: mockTPDataMulti,
      targetTpId: 'tp-102',
    });
    assert.strictEqual(resolved.status, 'RESOLVED');
    assert.strictEqual(resolved.selectedTpId, 'tp-102');
    console.log('[PASS] 3. resolveTargetTPSelection with explicit ID resolves unambiguously');
  });

  it('4. resolveTargetTPSelection with single TP in context resolves unambiguously without guessing', () => {
    const resolved = resolveTargetTPSelection({
      academicSetting: mockSettingMerdeka,
      tp: mockTPDataSingle,
    });
    assert.strictEqual(resolved.status, 'RESOLVED');
    assert.strictEqual(resolved.selectedTpId, 'tp-single-1');
    console.log('[PASS] 4. resolveTargetTPSelection with single TP in context resolves unambiguously');
  });

  it('5. resolveTargetTPSelection with multiple TPs and no targetTpId returns AMBIGUOUS without silent first-match', () => {
    const resolved = resolveTargetTPSelection({
      academicSetting: mockSettingMerdeka,
      tp: mockTPDataMulti,
    });
    assert.strictEqual(resolved.status, 'AMBIGUOUS');
    assert.strictEqual(resolved.selectedTpId, undefined);
    assert.strictEqual(resolved.candidateIds?.length, 3);
    console.log('[PASS] 5. resolveTargetTPSelection with multiple TPs returns AMBIGUOUS without first-match guessing');
  });

  it('6. deriveAutoDraftAssessmentPlan produces DRAFT status with needsReview: true', () => {
    const result = deriveAutoDraftAssessmentPlan({
      academicSetting: mockSettingMerdeka,
      tp: mockTPDataMulti,
      targetTpId: 'tp-101',
      assessmentCriteria: mockCriteria,
    });
    assert.ok(result.plan, 'Plan should be created');
    assert.strictEqual(result.plan.workflowStatus, 'DRAFT', 'Auto-draft plan MUST have DRAFT status');
    assert.strictEqual(result.plan.needsReview, true, 'Auto-draft plan MUST require teacher review');
    assert.ok(result.plan.reviewReason?.toLowerCase().includes('otomatis'), 'Review reason must state auto-generation');
    console.log('[PASS] 6. deriveAutoDraftAssessmentPlan produces DRAFT with needsReview: true');
  });

  it('7. deriveAutoDraftAssessmentPlan links matching KKTP criteria without fabricating fake ones', () => {
    const result = deriveAutoDraftAssessmentPlan({
      academicSetting: mockSettingMerdeka,
      tp: mockTPDataMulti,
      targetTpId: 'tp-101',
      assessmentCriteria: mockCriteria,
    });
    assert.ok(result.plan);
    assert.deepStrictEqual(result.plan.criterionIds, ['crit-101-1'], 'Must link existing matching criterion');
    assert.strictEqual(result.hasCriteria, true);

    // Now test with TP that has no criteria:
    const resultNoCrit = deriveAutoDraftAssessmentPlan({
      academicSetting: mockSettingMerdeka,
      tp: mockTPDataMulti,
      targetTpId: 'tp-103',
      assessmentCriteria: mockCriteria,
    });
    assert.ok(resultNoCrit.plan);
    assert.deepStrictEqual(resultNoCrit.plan.criterionIds, [], 'Must NOT fabricate fake criteria');
    assert.strictEqual(resultNoCrit.hasCriteria, false);
    console.log('[PASS] 7. deriveAutoDraftAssessmentPlan links real KKTP criteria and never fabricates fake ones');
  });

  it('8. deriveAutoDraftAssessmentPlan works without calendar or time allocation (non-blocking)', () => {
    const result = deriveAutoDraftAssessmentPlan({
      academicSetting: mockSettingMerdeka,
      tp: mockTPDataSingle,
      // No calendar or time allocation provided
    });
    assert.ok(result.plan);
    assert.strictEqual(result.plan.workflowStatus, 'DRAFT');
    assert.strictEqual(result.plan.tpIds[0], 'tp-single-1');
    console.log('[PASS] 8. deriveAutoDraftAssessmentPlan works without calendar or time allocation');
  });

  it('9. generateAutoDraftPlansFromCanonicalContext generates batch plans for all available TPs', () => {
    const plans = generateAutoDraftPlansFromCanonicalContext({
      academicSetting: mockSettingMerdeka,
      tp: mockTPDataMulti,
      assessmentCriteria: mockCriteria,
    });
    assert.strictEqual(plans.length, 3, 'Should generate one plan per TP');
    plans.forEach((p) => {
      assert.strictEqual(p.workflowStatus, 'DRAFT');
      assert.strictEqual(p.needsReview, true);
      assert.ok(p.instruments.length > 0);
      assert.ok(p.tpIds.length === 1);
    });
    console.log('[PASS] 9. generateAutoDraftPlansFromCanonicalContext generates batch DRAFT plans');
  });

  it('10. generateAutoDraftPlansFromCanonicalContext respects existing plans and avoids duplicate creation', () => {
    const existingPlan: AssessmentPlan = {
      id: 'existing-p1',
      academicSettingId: 'set-merdeka-1',
      title: 'Existing Plan for TP 1.1',
      purpose: 'FORMATIVE',
      timing: 'POST',
      scopeType: 'TP',
      tpIds: ['tp-101'],
      criterionIds: ['crit-101-1'],
      instruments: [{ id: 'inst-1', type: 'WRITTEN_TEST', label: 'Tes Tertulis' }],
      workflowStatus: 'SIAP',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const newPlans = generateAutoDraftPlansFromCanonicalContext({
      academicSetting: mockSettingMerdeka,
      tp: mockTPDataMulti,
      assessmentCriteria: mockCriteria,
      existingPlans: [existingPlan],
    });

    assert.strictEqual(newPlans.length, 2, 'Should only generate plans for tp-102 and tp-103');
    const targetTpIds = newPlans.map((p) => p.tpIds[0]);
    assert.ok(!targetTpIds.includes('tp-101'), 'Must not duplicate tp-101');
    console.log('[PASS] 10. generateAutoDraftPlansFromCanonicalContext respects existing plans');
  });

  it('11. validateAssessmentPlan blocks SIAP when title, tpIds, or instruments are missing', () => {
    const invalidPlan: AssessmentPlan = {
      id: 'inv-1',
      academicSettingId: 'set-merdeka-1',
      title: '',
      purpose: 'FORMATIVE',
      timing: 'POST',
      scopeType: 'TP',
      tpIds: [],
      criterionIds: [],
      instruments: [],
      workflowStatus: 'DRAFT',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const val = validateAssessmentPlan(invalidPlan, {
      academicSetting: mockSettingMerdeka,
      tp: mockTPDataMulti,
    });
    assert.strictEqual(val.valid, false);
    assert.ok(val.errors.some((e) => e.includes('Judul')));
    assert.ok(val.errors.some((e) => e.includes('Tujuan Pembelajaran') || e.includes('TP')));
    assert.ok(val.errors.some((e) => e.toLowerCase().includes('instrumen')));
    console.log('[PASS] 11. validateAssessmentPlan strictly checks required fields for SIAP gate');
  });

  it('12. confirmAssessmentPlan promotes valid DRAFT to SIAP status with confirmedAt timestamp', () => {
    const draftPlan: AssessmentPlan = {
      id: 'plan-to-confirm',
      academicSettingId: 'set-merdeka-1',
      title: 'Sumatif Lingkup Materi 1',
      purpose: 'SUMMATIVE',
      timing: 'POST',
      scopeType: 'TP',
      tpIds: ['tp-101'],
      criterionIds: ['crit-101-1'],
      instruments: [{ id: 'inst-1', type: 'WRITTEN_TEST', label: 'Tes Tertulis' }],
      workflowStatus: 'DRAFT',
      needsReview: true,
      reviewReason: 'Draf dibuat otomatis',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const res = confirmAssessmentPlan(draftPlan, {
      academicSetting: mockSettingMerdeka,
      tp: mockTPDataMulti,
      assessmentCriteria: mockCriteria,
    });
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.plan.workflowStatus, 'SIAP');
    assert.strictEqual(res.plan.needsReview, false);
    assert.strictEqual(res.plan.reviewReason, undefined);
    assert.ok(res.plan.confirmedAt);
    console.log('[PASS] 12. confirmAssessmentPlan promotes valid DRAFT to SIAP with confirmedAt');
  });

  it('13. confirmAssessmentPlan rejects invalid plan and leaves it DRAFT', () => {
    const invalidPlan: AssessmentPlan = {
      id: 'plan-invalid',
      academicSettingId: 'set-merdeka-1',
      title: '',
      purpose: 'SUMMATIVE',
      timing: 'POST',
      scopeType: 'TP',
      tpIds: [],
      criterionIds: [],
      instruments: [],
      workflowStatus: 'DRAFT',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const res = confirmAssessmentPlan(invalidPlan, {
      academicSetting: mockSettingMerdeka,
      tp: mockTPDataMulti,
    });
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.plan.workflowStatus, 'DRAFT');
    console.log('[PASS] 13. confirmAssessmentPlan rejects invalid plan');
  });
});

console.log('All 13 Workflow Recovery B Assessment Regression tests passed successfully!');
