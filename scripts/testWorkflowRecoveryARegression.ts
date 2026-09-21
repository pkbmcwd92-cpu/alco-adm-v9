import assert from 'node:assert';
import {
  createAIDraftLearningPlan,
  createEmptyLearningPlan,
  validateLearningPlan,
  resolveLearningPlanAllocatedJP,
  normalizeLearningExperiencePhase,
} from '../src/services/learningPlanService';
import { AcademicSetting, TPData, ATPData, LearningPlan } from '../src/types';

console.log('=== RUNNING WORKFLOW RECOVERY A REGRESSION SUITE ===\n');

let passedTests = 0;
let totalTests = 0;

function runTest(name: string, fn: () => void) {
  totalTests++;
  try {
    fn();
    console.log(`[PASS] ${totalTests}. ${name}`);
    passedTests++;
  } catch (err: any) {
    console.error(`[FAIL] ${totalTests}. ${name}:`, err.message);
    throw err;
  }
}

const mockSetting: AcademicSetting = {
  id: 'setting-1',
  profileId: 'p1',
  subject: 'Bahasa Indonesia',
  level: 'SMP',
  grade: 'Kelas 7',
  phase: 'Fase D',
  semester: '1 (Ganjil)',
  academicYear: '2026/2027',
  curriculum: 'Kurikulum Merdeka',
  curriculumType: 'KURIKULUM_MERDEKA',
  updatedAt: new Date().toISOString(),
};

const mockTpData: TPData = {
  id: 'tpdata-1',
  academicSettingId: 'setting-1',
  updatedAt: new Date().toISOString(),
  items: [
    {
      id: 'tp-101',
      order: 1,
      code: 'TP 7.1',
      statement: 'Murid mampu mengidentifikasi gagasan utama teks deskripsi.',
      competence: 'Mengidentifikasi',
      contentScope: 'Teks Deskripsi',
      p3Dimensions: ['Bernalar Kritis'],
    },
    {
      id: 'tp-102',
      order: 2,
      code: 'TP 7.2',
      statement: 'Murid mampu menyusun teks deskripsi secara tertulis.',
      competence: 'Menyusun',
      contentScope: 'Teks Deskripsi',
      p3Dimensions: ['Kreatif', 'Mandiri'],
    },
  ],
};

const mockAtpData: ATPData = {
  id: 'atpdata-1',
  academicSettingId: 'setting-1',
  updatedAt: new Date().toISOString(),
  totalJP: 36,
  items: [
    {
      id: 'atp-201',
      stepNumber: 1,
      tpId: 'tp-101',
      tpCode: 'TP 7.1',
      tpStatement: 'Murid mampu mengidentifikasi gagasan utama teks deskripsi.',
      materialScope: 'Teks Deskripsi',
      jp: 8,
      semester: 1,
    },
  ],
};

// 1. AI Phase normalization tests
runTest('Contract: normalizeLearningExperiencePhase handles standard & localized phase strings', () => {
  assert.strictEqual(normalizeLearningExperiencePhase('UNDERSTAND'), 'UNDERSTAND');
  assert.strictEqual(normalizeLearningExperiencePhase('understand'), 'UNDERSTAND');
  assert.strictEqual(normalizeLearningExperiencePhase('Memahami'), 'UNDERSTAND');
  assert.strictEqual(normalizeLearningExperiencePhase('APPLY'), 'APPLY');
  assert.strictEqual(normalizeLearningExperiencePhase('mengaplikasi'), 'APPLY');
  assert.strictEqual(normalizeLearningExperiencePhase('Mengaplikasikan'), 'APPLY');
  assert.strictEqual(normalizeLearningExperiencePhase('REFLECT'), 'REFLECT');
  assert.strictEqual(normalizeLearningExperiencePhase('merefleksi'), 'REFLECT');
  assert.strictEqual(normalizeLearningExperiencePhase('Merefleksikan'), 'REFLECT');
  assert.strictEqual(normalizeLearningExperiencePhase('UNKNOWN_PHASE'), null);
  assert.strictEqual(normalizeLearningExperiencePhase(undefined), null);
});

// 2. Missing JP does not fabricate numbers
runTest('No Fake JP: resolveLearningPlanAllocatedJP returns UNRESOLVED when no real JP exists', () => {
  const planWithoutJp: LearningPlan = {
    id: 'lp-no-jp',
    academicSettingId: 'setting-1',
    curriculumType: 'KURIKULUM_MERDEKA',
    sourceType: 'AI_DRAFT',
    status: 'DRAFT',
    tpIds: ['tp-101'],
    atpItemIds: [],
    title: 'Draf Modul Ajar',
    topic: 'Teks Deskripsi',
    objectives: [{ id: 'tp-101', tpId: 'tp-101', statement: 'Statement' }],
    learningExperiences: [
      { id: 'exp-1', phase: 'UNDERSTAND', description: 'Memahami' },
    ],
    assessmentPlan: { initial: [], formative: [], summative: [] },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // With no ATP and no time allocations
  const res = resolveLearningPlanAllocatedJP(planWithoutJp, { atp: null, timeAllocations: null });
  assert.strictEqual(res.allocatedJP, undefined);
  assert.strictEqual(res.source, 'UNRESOLVED');
});

runTest('Real JP Resolution: resolveLearningPlanAllocatedJP resolves from canonical ATP and explicit plan', () => {
  const planWithAtp: LearningPlan = {
    id: 'lp-atp-jp',
    academicSettingId: 'setting-1',
    curriculumType: 'KURIKULUM_MERDEKA',
    sourceType: 'AI_DRAFT',
    status: 'DRAFT',
    tpIds: ['tp-101'],
    atpItemIds: ['atp-201'],
    title: 'Draf Modul Ajar',
    topic: 'Teks Deskripsi',
    objectives: [{ id: 'tp-101', tpId: 'tp-101', statement: 'Statement' }],
    learningExperiences: [
      { id: 'exp-1', phase: 'UNDERSTAND', description: 'Memahami' },
    ],
    assessmentPlan: { initial: [], formative: [], summative: [] },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const resAtp = resolveLearningPlanAllocatedJP(planWithAtp, { atp: mockAtpData });
  assert.strictEqual(resAtp.allocatedJP, 8);
  assert.strictEqual(resAtp.source, 'CANONICAL_ATP');

  const planExplicit: LearningPlan = {
    ...planWithAtp,
    allocatedJP: 10,
  };
  const resExplicit = resolveLearningPlanAllocatedJP(planExplicit, { atp: mockAtpData });
  assert.strictEqual(resExplicit.allocatedJP, 10);
  assert.strictEqual(resExplicit.source, 'EXPLICIT_PLAN');
});

// 3. createAIDraftLearningPlan normalizes AI experiences and preserves true JP
runTest('createAIDraftLearningPlan: normalizes Indonesian phases and does not fabricate 2 JP', () => {
  const aiDraftRaw = {
    title: 'Draf Modul Deskripsi',
    topic: 'Teks Deskripsi',
    learningExperiences: [
      { phase: 'Memahami', description: 'Murid menyimak penjelasan' } as any,
      { phase: 'Mengaplikasikan', description: 'Murid menulis deskripsi' } as any,
      { phase: 'Merefleksikan', description: 'Murid menyimpulkan' } as any,
    ],
    assessmentPlan: {
      initial: [{ id: 'a1', type: 'INITIAL' as const, description: 'Pre-test', linkedTpIds: ['tp-101'] }],
      formative: [],
      summative: [],
    },
  };

  const plan = createAIDraftLearningPlan({
    academicSetting: mockSetting,
    curriculumType: 'KURIKULUM_MERDEKA',
    tpIds: ['tp-101'],
    aiDraft: aiDraftRaw,
    context: { tp: mockTpData, atp: mockAtpData },
  });

  assert.strictEqual(plan.status, 'DRAFT');
  assert.strictEqual(plan.sourceType, 'AI_DRAFT');
  assert.strictEqual(plan.allocatedJP, undefined); // NOT fabricated to 2!
  assert.strictEqual(plan.learningExperiences.length, 3);
  assert.strictEqual(plan.learningExperiences[0].phase, 'UNDERSTAND');
  assert.strictEqual(plan.learningExperiences[1].phase, 'APPLY');
  assert.strictEqual(plan.learningExperiences[2].phase, 'REFLECT');
  assert.ok(plan.learningExperiences[0].id.startsWith('exp-ai-1'));
});

// 4. Missing calendar / time allocation does NOT block DRAFT creation and validation
runTest('Missing Calendar/TimeAllocation: does NOT block DRAFT plan validation', () => {
  const plan = createAIDraftLearningPlan({
    academicSetting: mockSetting,
    curriculumType: 'KURIKULUM_MERDEKA',
    tpIds: ['tp-101'],
    aiDraft: {
      learningExperiences: [
        { id: 'e1', phase: 'UNDERSTAND', description: 'Memahami' },
      ],
      assessmentPlan: {
        initial: [{ id: 'a1', type: 'INITIAL', description: 'Pre-test', linkedTpIds: ['tp-101'] }],
        formative: [],
        summative: [],
      },
    },
    context: { tp: mockTpData, atp: null },
  });

  // Validate with NO calendar, NO timeAllocations, NO atp
  const validation = validateLearningPlan(plan, {
    academicSetting: mockSetting,
    tp: mockTpData,
    atp: null,
    timeAllocations: null,
  });

  assert.strictEqual(validation.valid, true);
  assert.strictEqual(validation.draftErrors.length, 0);
  assert.strictEqual(validation.errors.length, 0);
  assert.ok(validation.warnings.some((w) => w.includes('Alokasi JP belum ditentukan')));
});

// 5. Distinct lifecycle contracts: DRAFT vs SIAP
runTest('Lifecycle: SIAP requires confirmation and blocks on draft integrity errors', () => {
  const unconfirmedPlan: LearningPlan = {
    id: 'lp-unconfirmed',
    academicSettingId: 'setting-1',
    curriculumType: 'KURIKULUM_MERDEKA',
    sourceType: 'AI_DRAFT',
    status: 'SIAP', // Invalid because unconfirmed
    tpIds: ['tp-101'],
    atpItemIds: [],
    title: 'Draf Modul',
    topic: 'Teks Deskripsi',
    objectives: [{ id: 'tp-101', tpId: 'tp-101', statement: 'Gagasan utama' }],
    learningExperiences: [{ id: 'e1', phase: 'UNDERSTAND', description: 'Memahami' }],
    assessmentPlan: {
      initial: [{ id: 'a1', type: 'INITIAL', description: 'Pre-test', linkedTpIds: ['tp-101'] }],
      formative: [],
      summative: [],
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const resUnconfirmed = validateLearningPlan(unconfirmedPlan, {
    academicSetting: mockSetting,
    tp: mockTpData,
  });

  assert.strictEqual(resUnconfirmed.valid, false);
  assert.ok(resUnconfirmed.finalizationErrors.some((e) => e.includes('confirmedAt')));

  // Now confirm it
  const confirmedPlan: LearningPlan = {
    ...unconfirmedPlan,
    confirmedAt: new Date().toISOString(),
  };

  const resConfirmed = validateLearningPlan(confirmedPlan, {
    academicSetting: mockSetting,
    tp: mockTpData,
  });

  assert.strictEqual(resConfirmed.valid, true);
  assert.strictEqual(resConfirmed.errors.length, 0);
});

console.log(`\nAll ${totalTests} Workflow Recovery A Regression tests PASSED successfully!`);
