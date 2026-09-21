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

console.log('=== TEST SUITE: Dashboard 01 - First Run & Empty User Data ===');

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

// Test 1: getInitialState returns clean empty state
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

// Test 2: getProfileWorkspace on 0 profiles returns safe empty context
console.log('\n[TEST 2] Verifying getProfileWorkspace returns safe empty structure without crashing...');
const emptyWs = getProfileWorkspace('', '');
assert.ok(emptyWs, 'must return an object');
assert.strictEqual(emptyWs.profile.id, '', 'profile id should be empty');
assert.strictEqual(emptyWs.profile.name, '', 'profile name should be empty');
assert.strictEqual(emptyWs.workspace.id, '', 'workspace id should be empty');
assert.strictEqual(emptyWs.academicSetting.subject, '', 'subject should be empty');
assert.strictEqual(emptyWs.context.profileId, '', 'context profileId should be empty');
console.log('✓ TEST 2 PASSED: Zero-profile context handled safely.');

// Test 3: Adding a new school and a new profile
console.log('\n[TEST 3] Creating new school and adding first user profile...');
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

// Applet loads workspace for active profile
const loadedWs = getProfileWorkspace(newProfile.id);
assert.strictEqual(loadedWs.profile.id, 'prof-test-1', 'Active profile id matches');
assert.ok(loadedWs.workspace.id, 'Workspace should be generated for new profile');
assert.strictEqual(loadedWs.workspace.schoolId, createdSchool.id, 'Workspace schoolId matches school');

const storedAfterAdd = loadAppStorage();
assert.strictEqual(storedAfterAdd.profiles.length, 1, 'Should have 1 profile');
assert.strictEqual(storedAfterAdd.activeProfileId, 'prof-test-1', 'Active profile should be prof-test-1');
assert.strictEqual(storedAfterAdd.workspaces.length, 1, 'Default workspace created for profile');
assert.strictEqual(storedAfterAdd.workspaces[0].profileId, 'prof-test-1', 'Workspace linked to profile');
console.log('✓ TEST 3 PASSED: Profile and workspace creation validated.');

// Test 4: Delete profile to 0 profiles
console.log('\n[TEST 4] Deleting profile and verifying cascading cleanup & 0-profile state...');
deleteProfile('prof-test-1');

const storedAfterDelete = loadAppStorage();
assert.strictEqual(storedAfterDelete.profiles.length, 0, 'Profiles should be 0');
assert.strictEqual(storedAfterDelete.workspaces.length, 0, 'Workspaces should be 0');
assert.strictEqual(storedAfterDelete.activeProfileId, '', 'Active profile ID should be empty');
assert.strictEqual(storedAfterDelete.activeWorkspaceId, '', 'Active workspace ID should be empty');
// Master schools should still exist (reusable)
assert.ok(storedAfterDelete.schools.length >= 1, 'Master schools should be preserved');
assert.ok(storedAfterDelete.schools.some((s) => s.id === createdSchool.id), 'Newly created school should still be present');
console.log('✓ TEST 4 PASSED: Zero-profile deletion and school preservation verified.');

console.log('\n=== ALL DASHBOARD 01 REGRESSION TESTS PASSED (4/4) ===\n');
