/**
 * Recovery T2 Canonical Readiness & Semantic Invalidation Regression
 */

import assert from 'assert';
import { APP_BUILD_ID } from '../src/config/buildInfo';
import {
  classifyATPChange,
  classifyAssessmentCriteriaChange,
  classifyTPChange,
  validateATPReferences,
  validateKKTPData,
} from '../src/services/cpWorkflowService';
import { validateLearningPlan } from '../src/services/learningPlanService';
import { validateAssessmentPlan } from '../src/services/assessmentPlanService';
import { validateAssessmentPackage } from '../src/services/assessmentPackageService';
import {
  AcademicSetting,
  AssessmentCriterion,
  AssessmentPackage,
  AssessmentPlan,
  ATPData,
  LearningPlan,
  TPData,
} from '../src/types';

const setting: AcademicSetting = {
  id: 'set-t2',
  profileId: 'prof-t2',
  curriculum: 'Kurikulum Merdeka',
  curriculumType: 'KURIKULUM_MERDEKA',
  academicYear: '2026/2027',
  semester: '1',
  level: 'SMP',
  grade: '7',
  subject: 'Matematika',
  subjectCode: 'MAT',
  phase: 'D',
  updatedAt: '2026-09-22T00:00:00.000Z',
};

const readyTP: TPData = {
  id: 'tp-t2',
  academicSettingId: setting.id,
  workspaceId: 'ws-t2',
  subjectCode: 'MAT',
  phase: 'D',
  workflowStatus: 'SIAP',
  needsReview: false,
  updatedAt: '2026-09-22T01:00:00.000Z',
  items: [
    {
      id: 'tp-item-1',
      code: 'TP.1',
      statement: 'Peserta didik memahami operasi bilangan bulat.',
      competence: 'Memahami',
      contentScope: 'Bilangan bulat',
      order: 1,
    },
  ],
};

const readyATP: ATPData = {
  id: 'atp-t2',
  academicSettingId: setting.id,
  workspaceId: 'ws-t2',
  tpId: readyTP.id,
  subjectCode: 'MAT',
  phase: 'D',
  workflowStatus: 'SIAP',
  needsReview: false,
  basedOnTpUpdatedAt: readyTP.updatedAt,
  updatedAt: '2026-09-22T02:00:00.000Z',
  items: [
    {
      id: 'atp-item-1',
      stepNumber: 1,
      tpId: 'tp-item-1',
      tpCode: 'TP.1',
      tpStatement: 'Peserta didik memahami operasi bilangan bulat.',
      allocatedJP: 4,
      jp: 4,
    },
  ],
};

const readyCriterion: AssessmentCriterion = {
  id: 'crit-t2',
  academicSettingId: setting.id,
  workspaceId: 'ws-t2',
  tpId: 'tp-item-1',
  description: 'Menjelaskan operasi bilangan bulat dengan benar.',
  approach: 'DESCRIPTIVE',
  indicators: ['Menjelaskan operasi penjumlahan dan pengurangan bilangan bulat.'],
  levels: [
    { level: 'Baik', label: 'Baik', description: 'Mampu menjelaskan dengan tepat.' },
  ],
  workflowStatus: 'SIAP',
  needsReview: false,
  updatedAt: '2026-09-22T03:00:00.000Z',
};

const readyLearningPlan: LearningPlan = {
  id: 'lp-t2',
  academicSettingId: setting.id,
  curriculumType: 'KURIKULUM_MERDEKA',
  workspaceId: 'ws-t2',
  title: 'Rencana Pembelajaran TP.1',
  status: 'SIAP',
  sourceType: 'MANUAL',
  topic: 'Bilangan bulat',
  allocatedJP: 4,
  tpIds: ['tp-item-1'],
  atpItemIds: ['atp-item-1'],
  objectives: [{ id: 'obj-1', tpId: 'tp-item-1', code: 'TP.1', statement: 'Memahami operasi bilangan bulat.' }],
  learningSteps: {
    core: [{ id: 'act-1', title: 'Latihan', description: 'Diskusi dan latihan.', durationMinutes: 160 }],
  },
  assessmentPlan: {
    formative: [{ id: 'assess-1', type: 'FORMATIVE', linkedTpIds: ['tp-item-1'], description: 'Cek pemahaman.' }],
  },
  resources: [{ id: 'res-1', title: 'Buku siswa' }],
  createdAt: '2026-09-22T04:00:00.000Z',
  updatedAt: '2026-09-22T04:00:00.000Z',
  confirmedAt: '2026-09-22T04:30:00.000Z',
};

const readyAssessmentPlan: AssessmentPlan = {
  id: 'ap-t2',
  academicSettingId: setting.id,
  workspaceId: 'ws-t2',
  title: 'Asesmen TP.1',
  purpose: 'FORMATIVE',
  timing: 'POST',
  scopeType: 'TP',
  tpIds: ['tp-item-1'],
  criterionIds: ['crit-t2'],
  instruments: [{ id: 'inst-ref-1', type: 'WRITTEN_TEST', label: 'Tes Tertulis' }],
  workflowStatus: 'SIAP',
  needsReview: false,
  createdAt: '2026-09-22T05:00:00.000Z',
  updatedAt: '2026-09-22T05:00:00.000Z',
  confirmedAt: '2026-09-22T05:30:00.000Z',
};

const readyPackage: AssessmentPackage = {
  id: 'pkg-t2',
  assessmentPlanId: readyAssessmentPlan.id,
  academicSettingId: setting.id,
  workspaceId: 'ws-t2',
  title: 'Perangkat Asesmen TP.1',
  blueprintItems: [
    {
      id: 'bp-1',
      objectiveRefId: 'tp-item-1',
      criterionId: 'crit-t2',
      instrumentType: 'WRITTEN_TEST',
      instrumentItemIds: ['wi-1'],
      order: 1,
    },
  ],
  instruments: [
    {
      id: 'inst-1',
      type: 'WRITTEN_TEST',
      title: 'Tes Tertulis',
      instructions: 'Jawab pertanyaan berikut.',
      items: [
        {
          id: 'wi-1',
          blueprintItemId: 'bp-1',
          itemType: 'SHORT_ANSWER',
          prompt: 'Jelaskan operasi bilangan bulat.',
          order: 1,
        },
      ],
    },
  ],
  answerKeys: [],
  scoringGuides: [],
  rubrics: [],
  workflowStatus: 'SIAP',
  needsReview: false,
  createdAt: '2026-09-22T06:00:00.000Z',
  updatedAt: '2026-09-22T06:00:00.000Z',
};

const reviewedTP: TPData = { ...readyTP, needsReview: true, reviewReason: 'CP berubah.' };
const staleATP: ATPData = { ...readyATP, basedOnTpUpdatedAt: '2026-09-21T00:00:00.000Z' };
const reviewedCriterion: AssessmentCriterion = { ...readyCriterion, needsReview: true, reviewReason: 'TP berubah.' };
const reviewedPlan: AssessmentPlan = { ...readyAssessmentPlan, needsReview: true, reviewReason: 'KKTP berubah.' };

assert.strictEqual(APP_BUILD_ID, 'T2-20260922-1', 'T2 build fingerprint must be set');

assert.strictEqual(
  classifyTPChange(readyTP, { ...readyTP, workflowStatus: 'DRAFT', needsReview: true, reviewReason: 'Sync status only' }),
  'NON_SUBSTANTIVE',
  'TP status/review-only save must be non-substantive'
);
assert.strictEqual(
  classifyTPChange(readyTP, { ...readyTP, items: [{ ...readyTP.items[0], statement: 'Peserta didik menerapkan operasi bilangan bulat.' }] }),
  'SUBSTANTIVE',
  'TP pedagogical content change must be substantive'
);
assert.strictEqual(
  classifyATPChange(readyATP, { ...readyATP, workflowStatus: 'DRAFT', reviewReason: 'Status sync' }),
  'NON_SUBSTANTIVE',
  'ATP status-only save must be non-substantive'
);
assert.strictEqual(
  classifyAssessmentCriteriaChange([readyCriterion], [{ ...readyCriterion, indicators: ['Indikator substantif baru.'] }]),
  'SUBSTANTIVE',
  'KKTP criteria content change must be substantive'
);

assert.strictEqual(validateATPReferences(readyATP, reviewedTP).isValid, false, 'ATP must reject TP that still needs review');
assert.strictEqual(validateATPReferences(staleATP, readyTP).isValid, false, 'ATP must reject stale basedOnTpUpdatedAt');
assert.strictEqual(validateKKTPData([readyCriterion], reviewedTP).isValid, false, 'KKTP must reject TP that still needs review');

assert.strictEqual(
  validateLearningPlan(readyLearningPlan, { academicSetting: setting, tp: reviewedTP, atp: readyATP }).isValid,
  false,
  'LearningPlan must reject upstream TP that still needs review'
);
assert.strictEqual(
  validateLearningPlan(readyLearningPlan, { academicSetting: setting, tp: readyTP, atp: staleATP }).isValid,
  false,
  'LearningPlan must reject stale ATP runtime validation'
);
assert.strictEqual(
  validateAssessmentPlan(readyAssessmentPlan, {
    academicSetting: setting,
    tp: reviewedTP,
    assessmentCriteria: [readyCriterion],
  }).isValid,
  false,
  'AssessmentPlan must reject TP that still needs review'
);
assert.strictEqual(
  validateAssessmentPlan(readyAssessmentPlan, {
    academicSetting: setting,
    tp: readyTP,
    assessmentCriteria: [reviewedCriterion],
  }).isValid,
  false,
  'AssessmentPlan must reject KKTP that still needs review'
);
assert.strictEqual(
  validateAssessmentPackage(readyPackage, {
    academicSetting: setting,
    assessmentPlan: reviewedPlan,
    tp: readyTP,
    assessmentCriteria: [readyCriterion],
  }).isValid,
  false,
  'AssessmentPackage must reject parent AssessmentPlan that still needs review'
);
assert.strictEqual(
  validateAssessmentPackage(readyPackage, {
    academicSetting: setting,
    assessmentPlan: readyAssessmentPlan,
    tp: readyTP,
    assessmentCriteria: [reviewedCriterion],
  }).isValid,
  false,
  'AssessmentPackage must reject KKTP that still needs review'
);

console.log('Recovery T2 chain integrity regression passed.');
