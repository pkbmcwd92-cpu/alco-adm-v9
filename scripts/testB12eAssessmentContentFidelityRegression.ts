import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import {
  AssessmentGenerationContract,
  AssessmentGenerationPlan,
  AssessmentPackage,
  GeneratedTaskUnit,
  PerformanceAssessmentInstrument,
  AssignmentAssessmentInstrument,
  ProjectAssessmentInstrument,
  ProductAssessmentInstrument,
  PortfolioAssessmentInstrument,
} from '../src/types';
import { AssessmentDocumentSnapshot } from '../src/types/assessmentExport';
import {
  parseAndValidateRawAIResponse,
  mapGeneratedUnitsToAssessmentPackage,
} from '../src/services/assessmentPackageGeneratorService';
import { validateAssessmentPackage } from '../src/services/assessmentPackageService';
import { buildNormalizedAssessmentDocumentModel } from '../src/services/documentEngine/assessmentExportService';

function runTests() {
  let passed = 0;
  let failed = 0;

  function test(name: string, fn: () => void) {
    try {
      fn();
      passed++;
      console.log(`  [PASS] ${name}`);
    } catch (err: any) {
      failed++;
      console.error(`  [FAIL] ${name}: ${err.stack || err.message}`);
    }
  }

  console.log('=== B.1.2e ASSESSMENT CONTENT FIDELITY REGRESSION SUITE ===\n');

  const basePlan: AssessmentGenerationPlan = {
    planId: 'plan-b12e',
    allocationUnits: [],
    coverageUnits: [
      { id: 'cov-perf-1', evidenceType: 'PROCESS' } as any,
      { id: 'cov-perf-2', evidenceType: 'PROCESS' } as any,
      { id: 'cov-perf-3', evidenceType: 'PROCESS' } as any,
      { id: 'cov-assign-1', evidenceType: 'PRODUCT' } as any,
      { id: 'cov-proj-1', evidenceType: 'PRODUCT' } as any,
      { id: 'cov-prod-1', evidenceType: 'PRODUCT' } as any,
      { id: 'cov-rub-1', evidenceType: 'PRODUCT' } as any,
      { id: 'cov-prod-empty', evidenceType: 'PRODUCT' } as any,
    ],
    generationSpec: {
      assessmentPlanId: 'plan-b12e',
      academicSettingId: 'setting-1',
      kisiKisiRows: [],
      rubricDrafts: [],
      scoringGuideDrafts: [],
    } as any,
    totalBudget: 1,
    budgetPerUnit: { TASK: 1 },
  };

  const defaultSubjectProfile: any = {
    subjectKey: 'pjok',
    subjectLabel: 'Pendidikan Jasmani',
  };

  // ----------------------------------------------------
  // TEST 1 — PERFORMANCE PRESERVES INSTRUCTIONS
  // ----------------------------------------------------
  test('TEST 1: Performance preserves instructions when provided', () => {
    const contract: AssessmentGenerationContract = {
      assessmentPlanId: 'plan-b12e',
      subjectProfile: defaultSubjectProfile,
      units: [
        {
          coverageUnitId: 'cov-perf-1',
          allocationUnit: 'TASK',
          instrumentType: 'PERFORMANCE',
          objectiveRefId: 'tp-1',
          requiredCount: 1,
        } as any,
      ],
    };

    const rawAI = JSON.stringify({
      units: [
        {
          coverageUnitId: 'cov-perf-1',
          taskTitle: 'Praktik Senam Lantai',
          taskPrompt: 'Lakukan rangkaian gerak.',
          instructions: 'Lakukan secara aman dan berurutan.',
        },
      ],
    });

    const parsed = parseAndValidateRawAIResponse(rawAI, contract);
    assert.strictEqual(parsed.validatedUnits.length, 1);
    const taskUnit = parsed.validatedUnits[0] as GeneratedTaskUnit;
    assert.strictEqual(taskUnit.instructions, 'Lakukan secara aman dan berurutan.');

    const pkg = mapGeneratedUnitsToAssessmentPackage(parsed.validatedUnits, contract, basePlan);
    const inst = pkg.instruments[0] as PerformanceAssessmentInstrument;
    assert.strictEqual(inst.task, 'Lakukan rangkaian gerak.');
    assert.strictEqual(inst.instructions, 'Lakukan secara aman dan berurutan.');
  });

  // ----------------------------------------------------
  // TEST 2 — PERFORMANCE DOES NOT INVENT INSTRUCTIONS
  // ----------------------------------------------------
  test('TEST 2: Performance does not invent instructions when missing from AI', () => {
    const contract: AssessmentGenerationContract = {
      assessmentPlanId: 'plan-b12e',
      subjectProfile: defaultSubjectProfile,
      units: [
        {
          coverageUnitId: 'cov-perf-2',
          allocationUnit: 'TASK',
          instrumentType: 'PERFORMANCE',
          objectiveRefId: 'tp-1',
          requiredCount: 1,
        } as any,
      ],
    };

    const rawAI = JSON.stringify({
      units: [
        {
          coverageUnitId: 'cov-perf-2',
          taskTitle: 'Praktik Senam Lantai',
          taskPrompt: 'Lakukan rangkaian gerak.',
        },
      ],
    });

    const parsed = parseAndValidateRawAIResponse(rawAI, contract);
    assert.strictEqual(parsed.validatedUnits.length, 1);
    const taskUnit = parsed.validatedUnits[0] as GeneratedTaskUnit;
    assert.strictEqual(taskUnit.instructions, undefined);

    const pkg = mapGeneratedUnitsToAssessmentPackage(parsed.validatedUnits, contract, basePlan);
    const inst = pkg.instruments[0] as PerformanceAssessmentInstrument;
    assert.strictEqual(inst.task, 'Lakukan rangkaian gerak.');
    assert.strictEqual(inst.instructions, undefined, 'Performance instructions must be undefined, not duplicated from taskPrompt');
  });

  // ----------------------------------------------------
  // TEST 3 — PERFORMANCE ASPECT WEIGHT
  // ----------------------------------------------------
  test('TEST 3: Performance aspect weights are preserved in package and normalized model', () => {
    const contract: AssessmentGenerationContract = {
      assessmentPlanId: 'plan-b12e',
      subjectProfile: defaultSubjectProfile,
      units: [
        {
          coverageUnitId: 'cov-perf-3',
          allocationUnit: 'TASK',
          instrumentType: 'PERFORMANCE',
          objectiveRefId: 'tp-1',
          requiredCount: 1,
        } as any,
      ],
    };

    const rawAI = JSON.stringify({
      units: [
        {
          coverageUnitId: 'cov-perf-3',
          taskTitle: 'Praktik Gerak Berirama',
          taskPrompt: 'Praktikkan variasi gerak.',
          aspects: [
            { label: 'Kelenturan', description: 'Ketepatan gerak tubuh', weight: 40 },
            { label: 'Ketepatan Irama', description: 'Kesesuaian dengan ketukan', weight: 60 },
          ],
        },
      ],
    });

    const parsed = parseAndValidateRawAIResponse(rawAI, contract);
    const pkg = mapGeneratedUnitsToAssessmentPackage(parsed.validatedUnits, contract, basePlan);
    const inst = pkg.instruments[0] as PerformanceAssessmentInstrument;
    assert(inst.aspects && inst.aspects.length === 2);
    assert.strictEqual(inst.aspects[0].weight, 40);
    assert.strictEqual(inst.aspects[1].weight, 60);

    const snapshot: AssessmentDocumentSnapshot = {
      assessmentPackageId: pkg.id,
      assessmentPlanId: 'plan-b12e',
      school: {} as any,
      teacher: {} as any,
      academicSetting: {} as any,
      assessmentPlan: { id: 'plan-b12e', title: 'Plan B12e' } as any,
      blueprintItems: [],
      instruments: pkg.instruments,
      answerKeys: [],
      scoringGuides: [],
      rubrics: [],
      resolvedObjectives: {},
      documentMode: 'data',
      generatedAt: new Date().toISOString(),
    } as any;

    const model = buildNormalizedAssessmentDocumentModel(snapshot);
    const normInst = model.instruments.list[0];
    assert(normInst.performanceAspects && normInst.performanceAspects.length === 2);
    assert.strictEqual(normInst.performanceAspects[0].weight, 40);
    assert.strictEqual(normInst.performanceAspects[1].weight, 60);
  });

  // ----------------------------------------------------
  // TEST 4 — ASSIGNMENT EXPECTED OUTPUT
  // ----------------------------------------------------
  test('TEST 4: Assignment maps expectedDeliverable to expectedOutput and preserves explicit instructions', () => {
    const contract: AssessmentGenerationContract = {
      assessmentPlanId: 'plan-b12e',
      subjectProfile: defaultSubjectProfile,
      units: [
        {
          coverageUnitId: 'cov-assign-1',
          allocationUnit: 'TASK',
          instrumentType: 'ASSIGNMENT',
          objectiveRefId: 'tp-1',
          requiredCount: 1,
        } as any,
      ],
    };

    // Subtest 4a: Derived instructions from taskPrompt, expectedDeliverable to expectedOutput
    const rawAI1 = JSON.stringify({
      units: [
        {
          coverageUnitId: 'cov-assign-1',
          taskTitle: 'Tugas Rangkuman',
          taskPrompt: 'Buat rangkuman materi ekosistem.',
          expectedDeliverable: 'Rangkuman satu halaman.',
        },
      ],
    });

    const parsed1 = parseAndValidateRawAIResponse(rawAI1, contract);
    const pkg1 = mapGeneratedUnitsToAssessmentPackage(parsed1.validatedUnits, contract, basePlan);
    const inst1 = pkg1.instruments[0] as AssignmentAssessmentInstrument;
    assert.strictEqual(inst1.instructions, 'Buat rangkuman materi ekosistem.');
    assert.strictEqual(inst1.expectedOutput, 'Rangkuman satu halaman.');

    // Subtest 4b: Explicit instructions take precedence over taskPrompt
    const rawAI2 = JSON.stringify({
      units: [
        {
          coverageUnitId: 'cov-assign-1',
          taskTitle: 'Tugas Rangkuman',
          taskPrompt: 'Buat rangkuman materi ekosistem.',
          instructions: 'Tulis tangan pada buku catatan bertinta biru.',
          expectedDeliverable: 'Rangkuman satu halaman.',
        },
      ],
    });

    const parsed2 = parseAndValidateRawAIResponse(rawAI2, contract);
    const pkg2 = mapGeneratedUnitsToAssessmentPackage(parsed2.validatedUnits, contract, basePlan);
    const inst2 = pkg2.instruments[0] as AssignmentAssessmentInstrument;
    assert.strictEqual(inst2.instructions, 'Tulis tangan pada buku catatan bertinta biru.');
    assert.strictEqual(inst2.expectedOutput, 'Rangkuman satu halaman.');
  });

  // ----------------------------------------------------
  // TEST 5 — PROJECT EXPECTED DELIVERABLE
  // ----------------------------------------------------
  test('TEST 5: Project maps taskPrompt to projectBrief and preserves expectedDeliverable', () => {
    const contract: AssessmentGenerationContract = {
      assessmentPlanId: 'plan-b12e',
      subjectProfile: defaultSubjectProfile,
      units: [
        {
          coverageUnitId: 'cov-proj-1',
          allocationUnit: 'TASK',
          instrumentType: 'PROJECT',
          objectiveRefId: 'tp-1',
          requiredCount: 1,
        } as any,
      ],
    };

    const rawAI = JSON.stringify({
      units: [
        {
          coverageUnitId: 'cov-proj-1',
          taskTitle: 'Proyek Poster Digital',
          taskPrompt: 'Rancang infografis energi terbarukan.',
          expectedDeliverable: 'Infografis digital format PDF.',
        },
      ],
    });

    const parsed = parseAndValidateRawAIResponse(rawAI, contract);
    const pkg = mapGeneratedUnitsToAssessmentPackage(parsed.validatedUnits, contract, basePlan);
    const inst = pkg.instruments[0] as ProjectAssessmentInstrument;
    assert.strictEqual(inst.projectBrief, 'Rancang infografis energi terbarukan.');
    assert.strictEqual(inst.expectedDeliverable, 'Infografis digital format PDF.');

    const snapshot: AssessmentDocumentSnapshot = {
      assessmentPackageId: pkg.id,
      assessmentPlanId: 'plan-b12e',
      school: {} as any,
      teacher: {} as any,
      academicSetting: {} as any,
      assessmentPlan: { id: 'plan-b12e', title: 'Plan B12e' } as any,
      blueprintItems: [],
      instruments: pkg.instruments,
      answerKeys: [],
      scoringGuides: [],
      rubrics: [],
      resolvedObjectives: {},
      documentMode: 'data',
      generatedAt: new Date().toISOString(),
    } as any;

    const model = buildNormalizedAssessmentDocumentModel(snapshot);
    const normInst = model.instruments.list[0];
    assert.strictEqual(normInst.projectBrief, 'Rancang infografis energi terbarukan.');
    assert.strictEqual(normInst.expectedDeliverable, 'Infografis digital format PDF.');
  });

  // ----------------------------------------------------
  // TEST 6 — PRODUCT EXPECTED PRODUCT
  // ----------------------------------------------------
  test('TEST 6: Product maps taskPrompt to productBrief and expectedDeliverable to expectedProduct', () => {
    const contract: AssessmentGenerationContract = {
      assessmentPlanId: 'plan-b12e',
      subjectProfile: defaultSubjectProfile,
      units: [
        {
          coverageUnitId: 'cov-prod-1',
          allocationUnit: 'TASK',
          instrumentType: 'PRODUCT',
          objectiveRefId: 'tp-1',
          requiredCount: 1,
        } as any,
      ],
    };

    const rawAI = JSON.stringify({
      units: [
        {
          coverageUnitId: 'cov-prod-1',
          taskTitle: 'Produk Rekayasa Sederhana',
          taskPrompt: 'Buat maket jembatan sederhana.',
          expectedDeliverable: 'Maket jembatan stik es krim.',
        },
      ],
    });

    const parsed = parseAndValidateRawAIResponse(rawAI, contract);
    const pkg = mapGeneratedUnitsToAssessmentPackage(parsed.validatedUnits, contract, basePlan);
    const inst = pkg.instruments[0] as ProductAssessmentInstrument;
    assert.strictEqual(inst.productBrief, 'Buat maket jembatan sederhana.');
    assert.strictEqual(inst.expectedProduct, 'Maket jembatan stik es krim.');

    const snapshot: AssessmentDocumentSnapshot = {
      assessmentPackageId: pkg.id,
      assessmentPlanId: 'plan-b12e',
      school: {} as any,
      teacher: {} as any,
      academicSetting: {} as any,
      assessmentPlan: { id: 'plan-b12e', title: 'Plan B12e' } as any,
      blueprintItems: [],
      instruments: pkg.instruments,
      answerKeys: [],
      scoringGuides: [],
      rubrics: [],
      resolvedObjectives: {},
      documentMode: 'data',
      generatedAt: new Date().toISOString(),
    } as any;

    const model = buildNormalizedAssessmentDocumentModel(snapshot);
    const normInst = model.instruments.list[0];
    assert.strictEqual(normInst.productBrief, 'Buat maket jembatan sederhana.');
    assert.strictEqual(normInst.expectedProduct, 'Maket jembatan stik es krim.');
  });

  // ----------------------------------------------------
  // TEST 7 — RUBRIC CRITERIA WEIGHT PRESERVED
  // ----------------------------------------------------
  test('TEST 7: Rubric criteria weights are preserved in package and normalized model', () => {
    const contract: AssessmentGenerationContract = {
      assessmentPlanId: 'plan-b12e',
      subjectProfile: defaultSubjectProfile,
      units: [
        {
          coverageUnitId: 'cov-rub-1',
          allocationUnit: 'TASK',
          instrumentType: 'PROJECT',
          objectiveRefId: 'tp-1',
          requiredCount: 1,
        } as any,
      ],
    };

    const rawAI = JSON.stringify({
      units: [
        {
          coverageUnitId: 'cov-rub-1',
          taskTitle: 'Proyek Presentasi',
          taskPrompt: 'Presentasikan hasil riset.',
          rubricDraft: {
            title: 'Rubrik Presentasi',
            criteria: [
              { label: 'Kesesuaian', indicator: 'Materi relevan', weight: 50 },
              { label: 'Kerapian', indicator: 'Slide terstruktur', weight: 50 },
            ],
            scale: [
              { label: 'Baik', score: 3, descriptor: 'Lengkap' },
              { label: 'Cukup', score: 2, descriptor: 'Sebagian' },
            ],
          },
        },
      ],
    });

    const parsed = parseAndValidateRawAIResponse(rawAI, contract);
    const pkg = mapGeneratedUnitsToAssessmentPackage(parsed.validatedUnits, contract, basePlan);
    assert(pkg.rubrics && pkg.rubrics.length === 1);
    assert.strictEqual(pkg.rubrics[0].criteria[0].weight, 50);
    assert.strictEqual(pkg.rubrics[0].criteria[1].weight, 50);

    const snapshot: AssessmentDocumentSnapshot = {
      assessmentPackageId: pkg.id,
      assessmentPlanId: 'plan-b12e',
      school: {} as any,
      teacher: {} as any,
      academicSetting: {} as any,
      assessmentPlan: { id: 'plan-b12e', title: 'Plan B12e' } as any,
      blueprintItems: [],
      instruments: pkg.instruments,
      answerKeys: [],
      scoringGuides: [],
      rubrics: pkg.rubrics,
      resolvedObjectives: {},
      documentMode: 'data',
      generatedAt: new Date().toISOString(),
    } as any;

    const model = buildNormalizedAssessmentDocumentModel(snapshot);
    assert.strictEqual(model.rubrics.list[0].criteria[0].weight, 50);
    assert.strictEqual(model.rubrics.list[0].criteria[1].weight, 50);
  });

  // ----------------------------------------------------
  // TEST 8 — PORTFOLIO WITHOUT INSTRUCTIONS PASSES VALIDATION
  // ----------------------------------------------------
  test('TEST 8: Portfolio instrument without instructions passes package validation', () => {
    const portfolioPkg: AssessmentPackage = {
      id: 'pkg-port-valid',
      assessmentPlanId: 'plan-port-1',
      academicSettingId: 'setting-1',
      title: 'Perangkat Portofolio',
      blueprintItems: [],
      instruments: [
        {
          id: 'inst-port-1',
          type: 'PORTFOLIO',
          title: 'Instrumen Portofolio',
          instructions: undefined,
          evidenceRequirements: ['Laporan praktikum'],
        } as PortfolioAssessmentInstrument,
      ],
      answerKeys: [],
      scoringGuides: [],
      rubrics: [],
      workflowStatus: 'DRAFT',
      needsReview: false,
      revision: 1,
      provenance: {
        generatedBy: 'TEACHER',
        generatedAt: new Date().toISOString(),
      },
    };

    const result = validateAssessmentPackage(portfolioPkg, {
      assessmentPlan: { id: 'plan-port-1', title: 'Rencana Portofolio' } as any,
    });

    const hasPortfolioInstructionError = result.errors.some((e) =>
      e.includes('Asesmen Portofolio wajib memiliki instruksi.')
    );
    assert.strictEqual(
      hasPortfolioInstructionError,
      false,
      'validateAssessmentPackage must not require instructions for PORTFOLIO'
    );
  });

  // ----------------------------------------------------
  // TEST 9 — DOCX & PDF STRING / MODEL ASSERTIONS
  // ----------------------------------------------------
  test('TEST 9: DOCX & PDF renderers include performance weight, rubric weight, and expectedProduct', () => {
    const exportServicePath = path.resolve('src/services/documentEngine/assessmentExportService.ts');
    const source = fs.readFileSync(exportServicePath, 'utf8');

    // Performance weight rendered if present in DOCX
    assert(
      source.includes('asp.weight !== undefined') &&
      source.includes('— Bobot: ${asp.weight}'),
      'DOCX and PDF must render performance aspect weight when defined'
    );

    // Rubric weight rendered if present in DOCX and PDF
    assert(
      source.includes('c.weight !== undefined ? `${c.label} — Bobot: ${c.weight}` : c.label'),
      'DOCX and PDF must render rubric criterion weight when defined'
    );

    // expectedProduct rendered if present in DOCX and PDF
    assert(
      source.includes('Produk / Hasil yang Diharapkan:'),
      'DOCX and PDF must render expectedProduct when defined'
    );
  });

  // ----------------------------------------------------
  // TEST 10 — PRODUCT EXPORT SOURCE GUARD
  // ----------------------------------------------------
  test('TEST 10: Export service contains rendering branches for inst.expectedProduct in DOCX and PDF', () => {
    const exportServicePath = path.resolve('src/services/documentEngine/assessmentExportService.ts');
    const source = fs.readFileSync(exportServicePath, 'utf8');

    const matches = source.match(/inst\.expectedProduct/g) || [];
    assert(
      matches.length >= 2,
      `Expected at least 2 references to inst.expectedProduct in export service, found ${matches.length}`
    );
  });

  // ----------------------------------------------------
  // TEST 11 — NO FAKE VALUES
  // ----------------------------------------------------
  test('TEST 11: No fallback to taskPrompt when expectedDeliverable is absent', () => {
    const generatorServicePath = path.resolve('src/services/assessmentPackageGeneratorService.ts');
    const source = fs.readFileSync(generatorServicePath, 'utf8');

    // Source guard: must not assign expected deliverable fields from taskPrompt
    assert(
      !source.includes('expectedDeliverable || taskPrompt'),
      'Generator service must not fall back to taskPrompt for expected deliverables'
    );
    assert(
      !source.includes('expectedOutput = taskUnit.taskPrompt'),
      'expectedOutput must not be populated with taskPrompt'
    );
    assert(
      !source.includes('expectedProduct = taskUnit.taskPrompt'),
      'expectedProduct must not be populated with taskPrompt'
    );

    // Behavioral test: when expectedDeliverable is undefined, instruments must keep them undefined
    const contract: AssessmentGenerationContract = {
      assessmentPlanId: 'plan-b12e',
      subjectProfile: defaultSubjectProfile,
      units: [
        {
          coverageUnitId: 'cov-prod-empty',
          allocationUnit: 'TASK',
          instrumentType: 'PRODUCT',
          objectiveRefId: 'tp-1',
          requiredCount: 1,
        } as any,
      ],
    };

    const rawAI = JSON.stringify({
      units: [
        {
          coverageUnitId: 'cov-prod-empty',
          taskTitle: 'Produk Tanpa Output Spesifik',
          taskPrompt: 'Buat prototipe fungsional.',
        },
      ],
    });

    const parsed = parseAndValidateRawAIResponse(rawAI, contract);
    const pkg = mapGeneratedUnitsToAssessmentPackage(parsed.validatedUnits, contract, basePlan);
    const inst = pkg.instruments[0] as ProductAssessmentInstrument;
    assert.strictEqual(inst.expectedProduct, undefined, 'expectedProduct must remain undefined when AI did not generate expectedDeliverable');
  });

  console.log(`\nRegression results: ${passed} passed, ${failed} failed.`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
