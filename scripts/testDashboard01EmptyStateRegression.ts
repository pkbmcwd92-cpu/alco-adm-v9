import assert from 'node:assert';
import {
  getInitialState,
  loadAppStorage,
  saveAppStorage,
  getProfileWorkspace,
  saveProfile,
  deleteProfile,
  createSchool,
} from '../src/services/storage';
import { TeacherProfile, SchoolData } from '../src/types';

console.log('=== TEST SUITE: Dashboard 01 — Zero Profile & Unresolved Academic Context Regression ===');

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
assert.strictEqual(initial.activeProfileId, '', 'activeProfileId must be empty string');
assert.strictEqual(initial.activeWorkspaceId, '', 'activeWorkspaceId must be empty string');
console.log('✓ TEST 1 PASSED: getInitialState() is completely empty and clean.');

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

const storageAfter = JSON.stringify(loadAppStorage());
assert.strictEqual(storageBefore, storageAfter, 'getProfileWorkspace() on 0 profiles MUST NOT mutate storage or generate synthetic data');
console.log('✓ TEST 2 PASSED: Zero-profile state returns NO_PROFILE without mutating storage or fabricating fake academic facts.');

// TEST 3: Bootstrap Workspace for Legitimate Profile
console.log('\n[TEST 3] Creating new profile and verifying workspace bootstrap without fabricated facts...');
const newSchool: SchoolData = {
  id: 'sch-test-1',
  name: 'SD Negeri Percobaan 1',
  npsn: '20101234',
  address: 'Jl. Merdeka No. 10',
  village: 'Gambir',
  district: 'Gambir',
  regency: 'Jakarta Pusat',
  province: 'DKI Jakarta',
  principalName: 'Dra. Hj. Siti Rahmawati, M.Pd.',
  principalNip: '197001011995032001',
  verificationStatus: 'verified',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};
const createdSchool = createSchool(newSchool);

const newProfile: TeacherProfile = {
  id: 'prof-test-1',
  name: 'Ahmad Fauzi, S.Pd.',
  nip: '198501012010011002',
  nuptk: '1234567890123456',
  status: 'PNS',
  defaultSubject: 'Pendidikan Pancasila',
  defaultLevel: 'SD',
  schoolId: createdSchool.id,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};
saveProfile(newProfile);

const loadedWs = getProfileWorkspace(newProfile.id);
assert.strictEqual(loadedWs.status, undefined, 'Resolved workspace status should not be NO_PROFILE');
assert.strictEqual(loadedWs.profile?.id, 'prof-test-1', 'Active profile id matches');
assert.ok(loadedWs.workspace?.id, 'Workspace should be generated for new profile');
assert.strictEqual(loadedWs.workspace?.schoolId, createdSchool.id, 'Workspace schoolId matches school');

// Check that new academic setting uses profile default subject if present, but DOES NOT fabricate grade/year/semester
assert.strictEqual(loadedWs.academicSetting?.subject, 'Pendidikan Pancasila', 'Subject uses profile defaultSubject');
assert.strictEqual(loadedWs.academicSetting?.grade, '', 'Grade should be empty string (unresolved)');
assert.strictEqual(loadedWs.academicSetting?.academicYear, '', 'Academic year should be empty string (unresolved)');
assert.strictEqual(loadedWs.academicSetting?.semester, '', 'Semester should be empty string (unresolved)');
assert.strictEqual(loadedWs.academicSetting?.totalHoursPerWeek, undefined, 'Hours per week should be undefined (unresolved)');

const storedAfterAdd = loadAppStorage();
assert.strictEqual(storedAfterAdd.profiles.length, 1, 'Should have 1 profile');
assert.strictEqual(storedAfterAdd.activeProfileId, 'prof-test-1', 'Active profile should be prof-test-1');
assert.strictEqual(storedAfterAdd.workspaces.length, 1, 'Default workspace created for profile');
assert.strictEqual(storedAfterAdd.workspaces[0].profileId, 'prof-test-1', 'Workspace linked to profile');
console.log('✓ TEST 3 PASSED: Legitimate profile workspace bootstrap validated without fabricated academic facts.');

// TEST 4: Delete Profile & Return to Clean Zero-Profile State
console.log('\n[TEST 4] Deleting profile and verifying return to NO_PROFILE state...');
deleteProfile('prof-test-1');

const storedAfterDelete = loadAppStorage();
assert.strictEqual(storedAfterDelete.profiles.length, 0, 'Profiles should be 0');
assert.strictEqual(storedAfterDelete.workspaces.length, 0, 'Workspaces should be 0');
assert.strictEqual(storedAfterDelete.academicSettings.length, 0, 'Academic settings should be 0');
assert.strictEqual(storedAfterDelete.activeProfileId, '', 'Active profile ID should be empty');
assert.strictEqual(storedAfterDelete.activeWorkspaceId, '', 'Active workspace ID should be empty');

const emptyWsAfterDelete = getProfileWorkspace('', '');
assert.strictEqual(emptyWsAfterDelete.status, 'NO_PROFILE', 'Status should return to NO_PROFILE after deleting last profile');
assert.strictEqual(emptyWsAfterDelete.profile, undefined, 'Profile should be undefined');
assert.strictEqual(emptyWsAfterDelete.workspace, undefined, 'Workspace should be undefined');
console.log('✓ TEST 4 PASSED: Returning to 0-profile state cleaned up all profile-bound workspaces and academic settings.');

console.log('\n=== ALL DASHBOARD 01 REGRESSION TESTS PASSED (4/4) ===\n');
