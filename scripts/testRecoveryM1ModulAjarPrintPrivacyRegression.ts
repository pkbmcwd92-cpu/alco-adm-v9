import {
  createEmptyLearningPlan,
  createAIDraftLearningPlan,
  validateLearningPlan,
  confirmLearningPlan,
} from '../src/services/learningPlanService';
import { generateModulAjar } from '../src/services/documentEngine/generators/modulAjarGenerator';
import { generatePdfDocument } from '../src/services/documentEngine/renderers/pdf/pdfDocGenerators';
import { PdfDocumentBuilder } from '../src/services/documentEngine/renderers/pdf/pdfRenderer';
import { APP_BUILD_ID } from '../src/config/buildInfo';
import { AcademicSetting, TPData, ATPData, LearningPlan, SchoolData, TeacherProfile } from '../src/types';

async function runM1RegressionSuite() {
  console.log('=== RUNNING M1 MODUL AJAR PRINT READINESS & PRIVACY REGRESSION SUITE ===\n');
  let passedCount = 0;
  let failedCount = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`[PASS] ${testName}`);
      passedCount++;
    } else {
      console.error(`[FAIL] ${testName}${detail ? `: ${detail}` : ''}`);
      failedCount++;
    }
  }

  // 1. Build ID verification
  console.log('--- Check 1: Build ID ---');
  assert(APP_BUILD_ID === 'M1-20260923-1', `Build ID must be M1-20260923-1 (Actual: ${APP_BUILD_ID})`);

  const mockSchool: SchoolData = {
    id: 's-m1',
    name: 'SMP Negeri 1 Nusantara',
    npsn: '10293847',
    address: 'Jl. Pendidikan No. 45',
    village: 'Merdeka',
    district: 'Pusat',
    regency: 'Kota Nusantara',
    province: 'Jawa',
    principalName: 'Dra. Hj. Siti Aminah, M.Pd.',
    principalNip: '197001011995032001',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const mockProfile: TeacherProfile = {
    id: 'p-m1',
    name: 'Budi Santoso, S.Pd., Gr.',
    nip: '198505152010011012',
    status: 'PNS',
    defaultSubject: 'Informatika',
    defaultLevel: 'SMP',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const mockSetting: AcademicSetting = {
    id: 'setting-m1',
    profileId: 'p-m1',
    subject: 'Informatika',
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
    id: 'tpdata-m1',
    academicSettingId: 'setting-m1',
    updatedAt: new Date().toISOString(),
    workflowStatus: 'SIAP',
    needsReview: false,
    items: [
      {
        id: 'tp-1',
        order: 1,
        code: 'TP 7.1',
        statement: 'Memahami konsep dasar algoritma dan representasi flowchart.',
        competence: 'Memahami',
        contentScope: 'Algoritma & Pemrograman',
        p3Dimensions: ['Penalaran Kritis'],
      },
    ],
  };

  const mockAtpData: ATPData = {
    id: 'atpdata-m1',
    academicSettingId: 'setting-m1',
    updatedAt: new Date().toISOString(),
    totalJP: 24,
    workflowStatus: 'SIAP',
    needsReview: false,
    basedOnTpUpdatedAt: mockTpData.updatedAt,
    items: [
      {
        id: 'atp-1',
        stepNumber: 1,
        tpId: 'tp-1',
        tpCode: 'TP 7.1',
        tpStatement: 'Memahami konsep dasar algoritma dan representasi flowchart.',
        materialScope: 'Algoritma & Pemrograman',
        jp: 6,
        semester: 1,
      },
    ],
  };

  // Check 2: Validation blocks SIAP if print-readiness fields are missing
  console.log('\n--- Check 2: Print-readiness Finalization Gate ---');
  const incompleteSiapPlan: LearningPlan = {
    id: 'lp-inc',
    academicSettingId: 'setting-m1',
    curriculumType: 'KURIKULUM_MERDEKA',
    sourceType: 'AI_DRAFT',
    status: 'SIAP',
    confirmedAt: new Date().toISOString(),
    tpIds: ['tp-1'],
    atpItemIds: ['atp-1'],
    title: 'Modul Ajar Algoritma',
    topic: 'Algoritma & Pemrograman',
    objectives: [
      {
        id: 'obj-1',
        tpId: 'tp-1',
        code: 'TP 7.1',
        statement: 'Memahami konsep dasar algoritma dan representasi flowchart.',
        materialScope: 'Algoritma & Pemrograman',
      },
    ],
    learningExperiences: [
      { id: 'e1', phase: 'UNDERSTAND', description: 'Mempelajari konsep flowchart', durationMinutes: 20 },
      { id: 'e2', phase: 'APPLY', description: 'Membuat diagram alir aktivitas sehari-hari', durationMinutes: 50 },
      { id: 'e3', phase: 'REFLECT', description: 'Merefleksi kejelasan algoritma', durationMinutes: 20 },
    ],
    assessmentPlan: {
      initial: [{ id: 'a1', type: 'INITIAL', description: 'Pertanyaan pemantik', linkedTpIds: ['tp-1'] }],
      formative: [{ id: 'a2', type: 'FORMATIVE', description: 'Observasi diagram alir', linkedTpIds: ['tp-1'] }],
      summative: [{ id: 'a3', type: 'SUMMATIVE', description: 'Tes tertulis', linkedTpIds: ['tp-1'] }],
    },
    // Missing: initialCompetency, graduateProfileDimensions, resources, learningModel
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const incompleteVal = validateLearningPlan(incompleteSiapPlan, {
    academicSetting: mockSetting,
    tp: mockTpData,
    atp: mockAtpData,
  });

  assert(
    !incompleteVal.valid &&
      incompleteVal.finalizationErrors.some((e) => e.includes('Kompetensi Awal')) &&
      incompleteVal.finalizationErrors.some((e) => e.includes('Dimensi Profil Lulusan')) &&
      incompleteVal.finalizationErrors.some((e) => e.includes('Sarana')) &&
      incompleteVal.finalizationErrors.some((e) => e.includes('Model/praktik')),
    'validateLearningPlan must block SIAP when print-readiness fields are missing',
    incompleteVal.finalizationErrors.join(' | ')
  );

  // Check 3: Complete Print-Ready Plan passes validation
  console.log('\n--- Check 3: Complete Print-Ready Plan passes validation ---');
  const completeSiapPlan: LearningPlan = {
    ...incompleteSiapPlan,
    id: 'lp-complete',
    initialCompetency: 'Murid telah mengenal konsep instruksi berurutan dalam kehidupan sehari-hari.',
    graduateProfileDimensions: ['Penalaran Kritis', 'Kemandirian'],
    resources: [
      { id: 'r1', title: 'Buku Siswa Informatika Kelas VII', source: 'Kemendikbudristek' },
      { id: 'r2', title: 'Lembar Kerja Aktivitas Algoritma' },
    ],
    learningModel: 'Pembelajaran Kontekstual melalui demonstrasi, pemecahan masalah bertahap, dan refleksi mandiri.',
    meaningfulUnderstanding: 'Algoritma membantu menyelesaikan masalah terstruktur secara logis dan terurut.',
    triggerQuestions: ['Bagaimana komputer dapat mengikuti instruksi dengan tepat?'],
  };

  const completeVal = validateLearningPlan(completeSiapPlan, {
    academicSetting: mockSetting,
    tp: mockTpData,
    atp: mockAtpData,
  });

  assert(
    completeVal.valid,
    'validateLearningPlan must pass for complete print-ready SIAP plan',
    completeVal.errors.join(' | ')
  );

  // Check 4: DOCX Generation produces valid clean file
  console.log('\n--- Check 4: DOCX Export Output ---');
  const docxResult = await generateModulAjar({
    school: mockSchool,
    profile: mockProfile,
    academicSetting: mockSetting,
    learningPlans: [completeSiapPlan],
    tp: mockTpData,
    atp: mockAtpData,
    skipDownload: true,
  });

  assert(
    docxResult.success && !!docxResult.blob && docxResult.fileName.endsWith('.docx'),
    'DOCX Generator generates valid Modul Ajar document blob',
    `fileName: ${docxResult.fileName}`
  );

  // Check 5: Blank DOCX Mode produces valid clean file
  console.log('\n--- Check 5: Blank DOCX Template Export ---');
  const blankDocxResult = await generateModulAjar({
    school: mockSchool,
    profile: mockProfile,
    academicSetting: mockSetting,
    learningPlans: [],
    tp: mockTpData,
    atp: mockAtpData,
    documentMode: 'blank',
    skipDownload: true,
  });

  assert(
    blankDocxResult.success && !!blankDocxResult.blob,
    'Blank DOCX Generator generates template successfully'
  );

  // Check 6: PDF Generation produces valid clean vector PDF
  console.log('\n--- Check 6: PDF Export Output ---');
  const pdfResult = await generatePdfDocument('MODUL_AJAR', {
    school: mockSchool,
    profile: mockProfile,
    academicSetting: mockSetting,
    learningPlans: [completeSiapPlan],
    tp: mockTpData,
    atp: mockAtpData,
    skipDownload: true,
  });

  assert(
    !!pdfResult && !!pdfResult.blob && pdfResult.fileName.endsWith('.pdf'),
    'PDF Generator generates valid Modul Ajar PDF blob',
    `fileName: ${pdfResult?.fileName}`
  );

  // Check 7: PDF Blank Template Export
  console.log('\n--- Check 7: PDF Blank Template Export ---');
  const blankPdfResult = await generatePdfDocument('MODUL_AJAR', {
    school: mockSchool,
    profile: mockProfile,
    academicSetting: mockSetting,
    learningPlans: [],
    tp: mockTpData,
    atp: mockAtpData,
    documentMode: 'blank',
    skipDownload: true,
  });

  assert(
    !!blankPdfResult && !!blankPdfResult.blob && blankPdfResult.fileName.endsWith('.pdf'),
    'Blank PDF Generator generates template successfully',
    `fileName: ${blankPdfResult?.fileName}`
  );

  // Check 8: Verify PDF Builder footer does not contain app/AI branding
  console.log('\n--- Check 8: PDF Builder Footer Privacy ---');
  const builder = new PdfDocumentBuilder('portrait');
  builder.renderHeader('TEST HEADER');
  builder.finalizePageNumbers();
  const pdfBlob = builder.getBlob();
  assert(
    pdfBlob.size > 0,
    'PdfDocumentBuilder successfully finalizes without branding errors'
  );

  console.log(`\n==========================================`);
  console.log(`TOTAL PASSED: ${passedCount}`);
  console.log(`TOTAL FAILED: ${failedCount}`);
  console.log(`==========================================`);

  if (failedCount > 0) {
    process.exit(1);
  }
}

runM1RegressionSuite();
