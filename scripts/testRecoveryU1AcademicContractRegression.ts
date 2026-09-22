/**
 * Recovery U1.2 Regression Test Suite
 * Tests Academic Save & Routing Contract (Cases U1.2-A through U1.2-L)
 */

// Mock localStorage in Node.js environment
const memoryStore: Record<string, string> = {};
if (typeof globalThis.localStorage === 'undefined') {
  (globalThis as any).localStorage = {
    getItem: (key: string) => memoryStore[key] || null,
    setItem: (key: string, value: string) => {
      memoryStore[key] = value;
    },
    removeItem: (key: string) => {
      delete memoryStore[key];
    },
    clear: () => {
      Object.keys(memoryStore).forEach((k) => delete memoryStore[k]);
    },
  };
}

import {
  validateAcademicSettingReadiness,
  getCurriculumTypeFromSetting,
  isK13,
  isMerdeka,
} from '../src/services/curriculumRouter';
import { validateWorkflowDependencies } from '../src/services/workflowEngine';
import { APP_BUILD_ID } from '../src/config/buildInfo';
import { saveAcademicSetting, loadAppStorage, saveAppStorage } from '../src/services/storage';
import { generateModulAjar } from '../src/services/documentEngine/generators/modulAjarGenerator';
import { AcademicSetting, TeacherProfile, AdministrationWorkspace, LearningPlan } from '../src/types';
import * as fs from 'fs';
import * as path from 'path';

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    console.log(`[PASS] ${msg}`);
    passed++;
  } else {
    console.error(`[FAIL] ${msg}`);
    failed++;
  }
}

console.log('=== RUNNING RECOVERY U1.2 ACADEMIC SAVE & ROUTING REGRESSION ===\n');

// -------------------------------------------------------------
// Case U1.2-A: Pure validator validateAcademicSettingReadiness
// -------------------------------------------------------------
const nullRes = validateAcademicSettingReadiness(null);
assert(!nullRes.valid, 'U1.2-A.1: Null setting is invalid');
assert(nullRes.errors.length > 0, 'U1.2-A.2: Null setting has errors');

const incompleteSetting: AcademicSetting = {
  id: 'set-inc-1',
  profileId: 'prof-1',
  curriculum: 'Kurikulum Merdeka',
  curriculumType: 'KURIKULUM_MERDEKA',
  academicYear: '2026/2027',
  semester: '1 (Ganjil)',
  level: 'SMP',
  grade: 'VII',
  subject: '', // empty
  phase: 'D',
  updatedAt: new Date().toISOString(),
};
const incRes = validateAcademicSettingReadiness(incompleteSetting);
assert(!incRes.valid, 'U1.2-A.3: Incomplete setting (empty subject) is invalid');
assert(incRes.errors.some((e) => e.includes('Mata pelajaran')), 'U1.2-A.4: Error specifies subject missing');

const unknownCurriculumSetting: AcademicSetting = {
  id: 'set-unk-1',
  profileId: 'prof-1',
  curriculum: 'Kurikulum 2006 (KTSP)',
  curriculumType: undefined as any,
  academicYear: '2026/2027',
  semester: '1 (Ganjil)',
  level: 'SMP',
  grade: 'VII',
  subject: 'Matematika',
  phase: 'D',
  updatedAt: new Date().toISOString(),
};
const unkRes = validateAcademicSettingReadiness(unknownCurriculumSetting);
assert(!unkRes.valid, 'U1.2-A.5: Unknown curriculum setting is invalid');
assert(unkRes.errors.some((e) => e.includes('kurikulum')), 'U1.2-A.6: Error specifies curriculum unresolved');

const validMerdekaSetting: AcademicSetting = {
  id: 'set-merdeka-1',
  profileId: 'prof-1',
  curriculum: 'Kurikulum Merdeka',
  curriculumType: 'KURIKULUM_MERDEKA',
  academicYear: '2026/2027',
  semester: '1 (Ganjil)',
  level: 'SMP',
  grade: 'VII',
  subject: 'Informatika',
  phase: 'D',
  updatedAt: new Date().toISOString(),
};
const merdekaRes = validateAcademicSettingReadiness(validMerdekaSetting);
assert(merdekaRes.valid, 'U1.2-A.7: Complete Merdeka setting is valid');
assert(merdekaRes.curriculumType === 'KURIKULUM_MERDEKA', 'U1.2-A.8: Resolves KURIKULUM_MERDEKA');

const validK13Setting: AcademicSetting = {
  id: 'set-k13-1',
  profileId: 'prof-1',
  curriculum: 'Kurikulum 2013',
  curriculumType: 'K13',
  academicYear: '2026/2027',
  semester: '1 (Ganjil)',
  level: 'SMA',
  grade: 'X',
  subject: 'Fisika',
  phase: 'E',
  updatedAt: new Date().toISOString(),
};
const k13Res = validateAcademicSettingReadiness(validK13Setting);
assert(k13Res.valid, 'U1.2-A.9: Complete K13 setting is valid');
assert(k13Res.curriculumType === 'K13', 'U1.2-A.10: Resolves K13');

// -------------------------------------------------------------
// Case U1.2-B: Incomplete setting readiness prevents saving in form contract
// -------------------------------------------------------------
const academicSettingsCode = fs.readFileSync(
  path.join(process.cwd(), 'src/components/AcademicSettings.tsx'),
  'utf-8'
);
assert(
  academicSettingsCode.includes('validateAcademicSettingReadiness(formData)'),
  'U1.2-B.1: AcademicSettings handleSave checks validateAcademicSettingReadiness(formData)'
);
assert(
  academicSettingsCode.includes('if (!readiness.valid)'),
  'U1.2-B.2: AcademicSettings handleSave aborts when readiness is not valid'
);

// -------------------------------------------------------------
// Case U1.2-C: onSaveSetting is synchronous boolean
// -------------------------------------------------------------
// Setup storage for testing saveAcademicSetting
const initialStorage = loadAppStorage();
const mockProfileId = 'prof-u12-test';
const mockSchoolId = 'sch-u12-test';
const mockWsId = 'ws-u12-test';
const mockSettingId = 'set-u12-test';

const testStorage = {
  ...initialStorage,
  profiles: [{ id: mockProfileId, name: 'Budi Santoso', schoolId: mockSchoolId } as any],
  workspaces: [
    {
      id: mockWsId,
      profileId: mockProfileId,
      schoolId: mockSchoolId,
      academicSettingId: mockSettingId,
      name: 'Test Workspace',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ],
  academicSettings: [
    {
      ...validMerdekaSetting,
      id: mockSettingId,
    },
  ],
};
saveAppStorage(testStorage);

const syncResult = saveAcademicSetting({
  ...validMerdekaSetting,
  id: mockSettingId,
  subject: 'Bahasa Indonesia',
});
assert(typeof syncResult === 'boolean', 'U1.2-C.1: saveAcademicSetting returns synchronous boolean');
assert(syncResult === true, 'U1.2-C.2: saveAcademicSetting returned true on valid workspace-backed setting');

// Check prop type in AcademicSettings
assert(
  academicSettingsCode.includes('onSaveSetting: (setting: AcademicSetting, customWorkspaceName?: string) => boolean;'),
  'U1.2-C.3: onSaveSetting prop interface is strictly boolean (not Promise<boolean>)'
);

// -------------------------------------------------------------
// Case U1.2-D: App onNextStep uses just-saved data (no stale routing)
// -------------------------------------------------------------
const appCode = fs.readFileSync(path.join(process.cwd(), 'src/App.tsx'), 'utf-8');
assert(
  appCode.includes('onNextStep={(savedSetting?: AcademicSetting) => {'),
  'U1.2-D.1: App onNextStep accepts savedSetting parameter'
);
assert(
  appCode.includes('const effectiveSetting = savedSetting || activeAcademicSetting;'),
  'U1.2-D.2: App onNextStep prioritizes savedSetting over activeAcademicSetting'
);
assert(
  appCode.includes('validateAcademicSettingReadiness(effectiveSetting)'),
  'U1.2-D.3: App onNextStep validates readiness of effectiveSetting'
);

// -------------------------------------------------------------
// Case U1.2-E: workflow completeness matches readiness
// -------------------------------------------------------------
const mockTeacher: TeacherProfile = {
  id: 'prof-1',
  name: 'Siti Guru',
  nip: '198001012005012001',
  status: 'PNS',
  schoolId: 'sch-1',
  defaultLevel: 'SMP',
  defaultSubject: 'Informatika',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const incompleteWorkflow = validateWorkflowDependencies({
  profile: mockTeacher,
  academicSetting: incompleteSetting,
});
assert(
  !incompleteWorkflow.stepStates.academic.isComplete,
  'U1.2-E.1: Workflow academic is NOT complete for incomplete setting'
);
assert(
  incompleteWorkflow.stepStates.academic.status === 'IN_PROGRESS',
  'U1.2-E.2: Workflow academic status is IN_PROGRESS when incomplete'
);
assert(
  incompleteWorkflow.stepStates.cp.isBlocked,
  'U1.2-E.3: Downstream CP is BLOCKED when academic is incomplete'
);

const completeWorkflow = validateWorkflowDependencies({
  profile: mockTeacher,
  academicSetting: validMerdekaSetting,
});
assert(
  completeWorkflow.stepStates.academic.isComplete,
  'U1.2-E.4: Workflow academic IS complete for valid setting'
);
assert(
  completeWorkflow.stepStates.academic.status === 'COMPLETE',
  'U1.2-E.5: Workflow academic status is COMPLETE for valid setting'
);

// -------------------------------------------------------------
// Case U1.2-F: Unresolved curriculum blocks both branches
// -------------------------------------------------------------
const unresolvedWorkflow = validateWorkflowDependencies({
  profile: mockTeacher,
  academicSetting: unknownCurriculumSetting,
});
assert(
  unresolvedWorkflow.stepStates.cp.isBlocked,
  'U1.2-F.1: cp is BLOCKED for unresolved curriculum'
);
assert(
  unresolvedWorkflow.stepStates['k13-kd'].isBlocked,
  'U1.2-F.2: k13-kd is BLOCKED for unresolved curriculum'
);
assert(
  unresolvedWorkflow.stepStates.admin.isBlocked,
  'U1.2-F.3: admin is BLOCKED for unresolved curriculum'
);
assert(
  !unresolvedWorkflow.stepStates.academic.isComplete,
  'U1.2-F.4: academic is NOT complete for unresolved curriculum'
);

// -------------------------------------------------------------
// Case U1.2-G: K13 route goes to k13-kd
// -------------------------------------------------------------
// Simulate routing logic from App.tsx
function simulateAppNextStep(savedSetting?: AcademicSetting): string | null {
  const effectiveSetting = savedSetting || validMerdekaSetting;
  const readiness = validateAcademicSettingReadiness(effectiveSetting);
  if (!readiness.valid || !readiness.curriculumType) {
    return null;
  }
  if (readiness.curriculumType === 'K13') {
    return 'k13-kd';
  } else if (readiness.curriculumType === 'KURIKULUM_MERDEKA') {
    return 'cp';
  }
  return null;
}

assert(
  simulateAppNextStep(validK13Setting) === 'k13-kd',
  'U1.2-G.1: K13 setting routes directly to k13-kd'
);

// -------------------------------------------------------------
// Case U1.2-H: Merdeka route goes to cp
// -------------------------------------------------------------
assert(
  simulateAppNextStep(validMerdekaSetting) === 'cp',
  'U1.2-H.1: Merdeka setting routes directly to cp'
);

// -------------------------------------------------------------
// Case U1.2-I: Abaikan & Lanjut blocked when stored invalid
// -------------------------------------------------------------
assert(
  academicSettingsCode.includes('const storedReadiness = validateAcademicSettingReadiness(setting);'),
  'U1.2-I.1: AcademicSettings inspects stored setting readiness for modal'
);
assert(
  academicSettingsCode.includes('storedReadiness.valid ?'),
  'U1.2-I.2: Abaikan & Lanjut button is conditionally rendered or disabled based on storedReadiness.valid'
);
assert(
  academicSettingsCode.includes('Lengkapi dan simpan Data Pembelajaran sebelum melanjutkan'),
  'U1.2-I.3: Modal provides clear message when stored setting is invalid'
);

// -------------------------------------------------------------
// Case U1.2-J: Abaikan & Lanjut routes with stored setting when stored valid
// -------------------------------------------------------------
assert(
  academicSettingsCode.includes('onNextStep(setting)'),
  'U1.2-J.1: Abaikan & Lanjut calls onNextStep(setting) to route with stored canonical setting'
);

// -------------------------------------------------------------
// Case U1.2-K: build fingerprint is U1.2-20260922-1
// -------------------------------------------------------------
assert(
  APP_BUILD_ID === 'U1.2-20260922-1',
  `U1.2-K.1: APP_BUILD_ID is U1.2-20260922-1 (actual: ${APP_BUILD_ID})`
);

// -------------------------------------------------------------
// Case U1.2-L: Modul Ajar blank behavior unchanged from pre-U1.1
// -------------------------------------------------------------
const generatorCode = fs.readFileSync(
  path.join(process.cwd(), 'src/services/documentEngine/generators/modulAjarGenerator.ts'),
  'utf-8'
);
assert(
  !generatorCode.includes('candidate = (context.learningPlans || []).find'),
  'U1.2-L.1: Modul Ajar blank mode does not search candidate plans from context'
);
assert(
  !generatorCode.includes('plan = candidate'),
  'U1.2-L.2: Modul Ajar blank mode does not assign existing candidate plan'
);

// Functional check: blank mode produces empty plan even if existingPlans provided
async function testBlankModeGeneration() {
  const dummyExistingPlan: LearningPlan = {
    id: 'lp-dummy-1',
    academicSettingId: validMerdekaSetting.id,
    curriculumType: 'KURIKULUM_MERDEKA',
    title: 'EXISTING LEAK PLAN TITLE',
    tpIds: ['tp-1'],
    atpItemIds: ['atp-1'],
    learningSteps: {
      opening: [{ id: 'step-1', stepName: 'Opening 1', description: 'Existing Step' }],
      core: [],
      closing: [],
    },
    objectives: [],
    assessmentPlan: {
      initial: [],
      formative: [],
      summative: [],
    },
    status: 'DRAFT',
    sourceType: 'MANUAL',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const res = await generateModulAjar({
    school: { id: 'sch-1', name: 'SMP Negeri 1', address: 'Jl. Merdeka' } as any,
    profile: mockTeacher,
    academicSetting: validMerdekaSetting,
    documentMode: 'blank',
    learningPlans: [dummyExistingPlan],
  });

  const content = JSON.stringify(res.document);
  assert(
    !content.includes('EXISTING LEAK PLAN TITLE'),
    'U1.2-L.3: Blank mode does NOT leak existing learning plan title'
  );
  assert(
    !content.includes('Existing Step'),
    'U1.2-L.4: Blank mode does NOT leak existing learning plan steps'
  );
}

testBlankModeGeneration().then(() => {
  // Restore initial storage
  saveAppStorage(initialStorage);

  console.log('\n====================================================');
  console.log(`TEST RESULTS: ${passed} passed, ${failed} failed (Total: ${passed + failed})`);
  console.log('====================================================');

  if (failed > 0) {
    process.exit(1);
  } else {
    console.log('ALL RECOVERY U1.2 REGRESSION TESTS PASSED!');
  }
});
