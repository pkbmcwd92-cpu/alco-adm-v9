import assert from 'node:assert';
import {
  getInitialState,
  loadAppStorage,
  getProfileWorkspace,
  saveProfile,
  deleteProfile,
  createSchool,
  createWorkspace,
  generateWorkspaceName,
} from '../src/services/storage';
import { TeacherProfile, SchoolData } from '../src/types';

console.log('=== TEST SUITE: Dashboard 01 — Zero Profile & Unresolved Workspace Creation Regression ===');

// Mock localStorage for Node environment
const memoryStore: Record<string, string> = {};
(global as any).localStorage = {
  getItem: (key: string) => memoryStore[key] || null,
  setItem: (key: string, val: string) => {
    memoryStore[key] = val;
  },
  removeItem: (key: string) => {
    delete memoryStore[key];
  },
  clear: () => {
    Object.keys(memoryStore).forEach((k) => delete memoryStore[k]);
  },
};

// Reset storage
localStorage.clear();

// TEST 1: Clean Initial State
console.log('\n[TEST 1] Verifying getInitialState returns clean empty collections...');
const initial = getInitialState();
assert.strictEqual(initial.profiles.length, 0, 'profiles must be empty array');
assert.strictEqual(initial.workspaces.length, 0, 'workspaces must be empty array');
assert.strictEqual(initial.academicSettings.length, 0, 'academicSettings must be empty array');
assert.strictEqual(initial.cps.length, 0, 'cps must be empty array');
assert.strictEqual(initial.tps.length, 0, 'tps must be empty array');
assert.strictEqual(initial.atps.length, 0, 'atps must be empty array');
assert.strictEqual(initial.documents.length, 0, 'documents must be empty array');
assert.strictEqual(initial.students.length, 0, 'students must be empty array');
assert.strictEqual(initial.activeProfileId, '', 'activeProfileId must be empty string');
assert.strictEqual(initial.activeWorkspaceId, '', 'activeWorkspaceId must be empty string');
console.log('✓ TEST 1 PASSED');

// TEST 2: Zero Profile State & Unresolved Academic Context
console.log('\n[TEST 2] Verifying getProfileWorkspace on 0 profiles returns status NO_PROFILE with NO synthetic context...');
const storageBefore = JSON.stringify(loadAppStorage());

const emptyWs = getProfileWorkspace('', '');
assert.ok(emptyWs, 'must return ProfileWorkspaceData object');
assert.strictEqual(emptyWs.status, 'NO_PROFILE', 'status must be NO_PROFILE');
assert.strictEqual(emptyWs.profile, undefined, 'profile must be undefined');
assert.strictEqual(emptyWs.workspace, undefined, 'workspace must be undefined');
assert.strictEqual(emptyWs.academicSetting, undefined, 'academicSetting must be undefined');
assert.strictEqual(emptyWs.context, undefined, 'context must be undefined');
assert.strictEqual(emptyWs.cp, undefined, 'cp must be undefined');
assert.strictEqual(emptyWs.tp, undefined, 'tp must be undefined');
assert.strictEqual(emptyWs.atp, undefined, 'atp must be undefined');
assert.strictEqual(emptyWs.students.length, 0, 'students must be empty');

const storageAfter = JSON.stringify(loadAppStorage());
assert.strictEqual(storageBefore, storageAfter, 'getProfileWorkspace() on 0 profiles MUST NOT mutate storage or generate synthetic data');
console.log('✓ TEST 2 PASSED');

// TEST 3: Invalid Explicit Profile ID Fail Behavior
console.log('\n[TEST 3] Verifying explicit invalid profileId fails explicitly...');
assert.throws(
  () => {
    createWorkspace({
      profileId: 'non-existent-profile-id',
      setting: {
        grade: '',
        subject: '',
      },
    });
  },
  (err: Error) => {
    return err.message.includes('non-existent-profile-id');
  },
  'Should throw explicit error for invalid profileId'
);
console.log('✓ TEST 3 PASSED');

// TEST 4: Create Workspace with Empty Academic Fields
console.log('\n[TEST 4] Creating profile and workspace with empty academic fields...');
const school: SchoolData = {
  id: 'sch-test-1',
  name: 'SD Negeri Test 1',
  npsn: '10002000',
  address: 'Jl. Test No. 1',
  village: 'Desa Test',
  district: 'Kec Test',
  regency: 'Kab Test',
  province: 'Prov Test',
  principalName: 'Kepala Test, M.Pd.',
  principalNip: '198001012005011001',
  verificationStatus: 'verified',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};
const createdSchool = createSchool(school);

const profile: TeacherProfile = {
  id: 'prof-test-1',
  name: 'Budi Santoso, S.Pd.',
  nip: '198501012010011001',
  status: 'PNS',
  defaultSubject: 'Matematika',
  defaultLevel: 'SD',
  schoolId: createdSchool.id,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};
saveProfile(profile);

const emptyFieldWs = createWorkspace({
  profileId: profile.id,
  setting: {
    curriculum: '',
    academicYear: '',
    semester: '',
    grade: '',
    subject: '',
    totalHoursPerWeek: undefined,
  },
});

assert.ok(emptyFieldWs, 'Workspace created');
assert.strictEqual(emptyFieldWs.profileId, 'prof-test-1', 'Bound to profile.id');
assert.strictEqual(emptyFieldWs.schoolId, createdSchool.id, 'Bound to profile.schoolId');

const stateAfterEmptyWs = loadAppStorage();
const setting = stateAfterEmptyWs.academicSettings.find((s) => s.id === emptyFieldWs.academicSettingId);
assert.ok(setting, 'AcademicSetting exists');

assert.strictEqual(setting.academicYear, '', 'academicYear must be empty string');
assert.strictEqual(setting.semester, '', 'semester must be empty string');
assert.strictEqual(setting.grade, '', 'grade must be empty string');
assert.strictEqual(setting.phase, '', 'phase must be empty string when grade is empty');
assert.strictEqual(setting.totalHoursPerWeek, undefined, 'totalHoursPerWeek must be undefined');
assert.strictEqual(setting.curriculum, '', 'curriculum must be empty string');
assert.strictEqual(setting.curriculumType, undefined, 'curriculumType must be undefined');
assert.strictEqual(setting.subject, 'Matematika', 'Uses profile defaultSubject when setting subject is empty');
assert.strictEqual(setting.level, 'SD', 'Uses profile defaultLevel when setting level is empty');

// Verify student roster is strictly empty (0 students)
const studentsForWs = stateAfterEmptyWs.students.filter((s) => s.academicSettingId === setting.id);
assert.strictEqual(studentsForWs.length, 0, 'Workspace student roster must be 0');
console.log('✓ TEST 4 PASSED');

// TEST 5: Phase Derivation when Valid Level and Grade Provided
console.log('\n[TEST 5] Verifying phase derivation on valid level + grade...');
const validWs = createWorkspace({
  profileId: profile.id,
  setting: {
    level: 'SD',
    grade: 'Kelas 4',
    subject: 'IPAS',
    curriculum: 'Kurikulum Merdeka',
    academicYear: '2025/2026',
    semester: '1 (Ganjil)',
    totalHoursPerWeek: 5,
  },
});
const stateAfterValid = loadAppStorage();
const validSetting = stateAfterValid.academicSettings.find((s) => s.id === validWs.academicSettingId)!;
assert.strictEqual(validSetting.phase, 'Fase B', 'Fase B derived for SD Kelas 4');
assert.strictEqual(validSetting.curriculumType, 'KURIKULUM_MERDEKA', 'curriculumType set to KURIKULUM_MERDEKA');
assert.strictEqual(validSetting.academicYear, '2025/2026', 'academicYear correctly set');
assert.strictEqual(validSetting.totalHoursPerWeek, 5, 'totalHoursPerWeek correctly set');
console.log('✓ TEST 5 PASSED');

// TEST 6: generateWorkspaceName Presentational Placeholders
console.log('\n[TEST 6] Verifying generateWorkspaceName display placeholders...');
const unresolvedName = generateWorkspaceName({
  subject: '',
  grade: '',
  semester: '',
  academicYear: '',
});
assert.strictEqual(unresolvedName, 'Mata Pelajaran — Kelas - — Sem - — Tahun Ajaran -');
assert.ok(!unresolvedName.includes('2026/2027'), 'Should not contain 2026/2027 fallback');
console.log('✓ TEST 6 PASSED');

// TEST 7: Delete Profile and Return to Zero-Profile
console.log('\n[TEST 7] Deleting profile and verifying clean return to 0-profile state...');
deleteProfile(profile.id);
const finalState = loadAppStorage();
assert.strictEqual(finalState.profiles.length, 0, 'profiles count is 0');
assert.strictEqual(finalState.workspaces.length, 0, 'workspaces count is 0');
assert.strictEqual(finalState.academicSettings.length, 0, 'academicSettings count is 0');

const finalEmptyWs = getProfileWorkspace('', '');
assert.strictEqual(finalEmptyWs.status, 'NO_PROFILE', 'Returns NO_PROFILE status');
console.log('✓ TEST 7 PASSED');

console.log('\n=== ALL DASHBOARD 01 WORKSPACE REGRESSION TESTS PASSED ===\n');
