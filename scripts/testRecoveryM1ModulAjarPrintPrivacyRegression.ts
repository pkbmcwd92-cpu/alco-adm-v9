import {
  createEmptyLearningPlan,
  createAIDraftLearningPlan,
  validateLearningPlan,
  confirmLearningPlan,
} from '../src/services/learningPlanService';
import { generateModulAjar } from '../src/services/documentEngine/generators/modulAjarGenerator';
import { generatePdfDocument } from '../src/services/documentEngine/renderers/pdf/pdfDocGenerators';
import {
  PdfDocumentBuilder,
  PDF_FORMAL_NEUTRAL_THEME,
} from '../src/services/documentEngine/renderers/pdf/pdfRenderer';
import { PDF_THEME } from '../src/services/documentEngine/renderers/pdf/pdfTheme';
import {
  CANONICAL_GRADUATE_PROFILE_DIMENSIONS,
  isCanonicalGraduateProfileDimension,
  validateGraduateProfileDimensions,
} from '../src/constants/graduateProfileDimensions';
import { APP_BUILD_ID } from '../src/config/buildInfo';
import { AcademicSetting, TPData, ATPData, LearningPlan, SchoolData, TeacherProfile } from '../src/types';

async function runM11RegressionSuite() {
  console.log('=== RUNNING M1.1 MODUL AJAR PDF NEUTRAL STYLE, GRADUATE PROFILE VALIDATION & PRIVACY REGRESSION SUITE ===\n');
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
  assert(APP_BUILD_ID === 'M1.1-20260923-1', `Build ID must be M1.1-20260923-1 (Actual: ${APP_BUILD_ID})`);

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

  // Check 3: M1.1-B Canonical 8 Graduate Profile Dimensions Validation
  console.log('\n--- Check 3: M1.1-B Canonical Graduate Profile Dimensions Validation ---');
  assert(
    CANONICAL_GRADUATE_PROFILE_DIMENSIONS.length === 8,
    'Canonical graduate profile dimensions count must be exactly 8'
  );

  assert(
    isCanonicalGraduateProfileDimension('Penalaran Kritis') &&
      isCanonicalGraduateProfileDimension('Kemandirian') &&
      isCanonicalGraduateProfileDimension('Keimanan dan Ketakwaan terhadap Tuhan Yang Maha Esa') &&
      isCanonicalGraduateProfileDimension('Kewargaan') &&
      isCanonicalGraduateProfileDimension('Kreativitas') &&
      isCanonicalGraduateProfileDimension('Kolaborasi') &&
      isCanonicalGraduateProfileDimension('Kesehatan') &&
      isCanonicalGraduateProfileDimension('Komunikasi'),
    'All 8 canonical dimensions are recognized'
  );

  // Reject unknown values (fail-closed, no auto correction)
  const unknownValidation = validateGraduateProfileDimensions(['Berpikir Hebat']);
  assert(
    !unknownValidation.isValid &&
      unknownValidation.invalidDimensions.includes('Berpikir Hebat') &&
      unknownValidation.error?.includes('Berpikir Hebat'),
    'Unknown dimension ["Berpikir Hebat"] is rejected by canonical validator'
  );

  const mixedValidation = validateGraduateProfileDimensions(['Penalaran Kritis', 'Profil Pelajar Pancasila']);
  assert(
    !mixedValidation.isValid &&
      mixedValidation.invalidDimensions.includes('Profil Pelajar Pancasila'),
    'Mixed array containing non-canonical value is rejected'
  );

  const validDimensionsResult = validateGraduateProfileDimensions(['Penalaran Kritis', 'Kemandirian']);
  assert(
    validDimensionsResult.isValid &&
      validDimensionsResult.dimensions.length === 2 &&
      validDimensionsResult.invalidDimensions.length === 0,
    'Valid canonical dimensions array passes validation'
  );

  // LearningPlan validator draft error with invalid dimension
  const draftWithInvalidDim: LearningPlan = {
    ...incompleteSiapPlan,
    status: 'DRAFT',
    graduateProfileDimensions: ['Penalaran Kritis', 'Dimensi Palsu'],
  };
  const draftVal = validateLearningPlan(draftWithInvalidDim, { academicSetting: mockSetting });
  assert(
    draftVal.errors.some((e) => e.includes('Dimensi Profil Lulusan tidak valid: Dimensi Palsu')),
    'Draft with non-canonical dimension produces explicit validation error'
  );

  // Check 4: Complete Print-Ready Plan passes validation
  console.log('\n--- Check 4: Complete Print-Ready Plan passes validation ---');
  const completeSiapPlan: LearningPlan = {
    ...incompleteSiapPlan,
    id: 'lp-complete',
    initialCompetency: 'Murid diharapkan telah mengenal konsep instruksi berurutan dalam kehidupan sehari-hari.',
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

  // Check 5: M1.1-A PDF Modul Ajar Professional Neutral Style Isolation
  console.log('\n--- Check 5: M1.1-A Modul Ajar PDF Neutral Style & Theme Isolation ---');
  const neutralBuilder = new PdfDocumentBuilder('portrait', 'FORMAL_NEUTRAL');
  const neutralTheme = neutralBuilder.getTheme();

  assert(
    neutralBuilder.getStyleProfile() === 'FORMAL_NEUTRAL',
    'PdfDocumentBuilder supports FORMAL_NEUTRAL style profile'
  );
  assert(
    neutralTheme.fonts.base === 'times' && neutralTheme.fonts.bold === 'times',
    'FORMAL_NEUTRAL uses Times New Roman font family'
  );
  assert(
    neutralTheme.colors.primary[0] === 0 &&
      neutralTheme.colors.primary[1] === 0 &&
      neutralTheme.colors.primary[2] === 0,
    'FORMAL_NEUTRAL primary color is black [0, 0, 0]'
  );
  assert(
    neutralTheme.sizes.docTitle === 14 && neutralTheme.sizes.heading1 === 12 && neutralTheme.sizes.body === 11,
    'FORMAL_NEUTRAL typography sizes: docTitle 14pt, heading 12pt, body 11pt'
  );

  // Verify DEFAULT style profile & global PDF_THEME remains untouched for other documents
  const defaultBuilder = new PdfDocumentBuilder('portrait', 'DEFAULT');
  const defaultTheme = defaultBuilder.getTheme();
  assert(
    defaultBuilder.getStyleProfile() === 'DEFAULT',
    'Default builder uses DEFAULT style profile'
  );
  assert(
    defaultTheme.fonts.base === 'helvetica',
    'DEFAULT builder retains helvetica font'
  );
  assert(
    PDF_THEME.colors.primary[0] === 30 && PDF_THEME.colors.primary[1] === 58 && PDF_THEME.colors.primary[2] === 138,
    'Global PDF_THEME is unmodified and maintains Royal Navy theme for other documents'
  );

  // Check 6: PDF Generation produces valid clean vector PDF with FORMAL_NEUTRAL
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

  // Check 8: DOCX Generation produces valid clean file
  console.log('\n--- Check 8: DOCX Export Output ---');
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

  // Check 9: M1.1-C Export Privacy and Forbidden Token Absence
  console.log('\n--- Check 9: M1.1-C Export Privacy & Forbidden Token Absence ---');
  const forbiddenTokens = [
    'AI_DRAFT',
    'Status Dokumen',
    'Status Rencana',
    'Jumlah Murid',
    'Jumlah Siswa',
    'Administrasi Guru AI',
    'generatedBy',
    'sourceType',
  ];

  // Inspect snapshot data sent to PDF renderer for Modul Ajar
  const snapshotString = JSON.stringify(pdfResult?.snapshot || {});
  for (const token of forbiddenTokens) {
    // Check that sections rendered for print do not contain forbidden display strings
    assert(
      !snapshotString.includes(`"${token}"`) && !snapshotString.includes(`: "${token}"`),
      `PDF snapshot must not contain forbidden display token: '${token}'`
    );
  }

  console.log(`\n==========================================`);
  console.log(`TOTAL PASSED: ${passedCount}`);
  console.log(`TOTAL FAILED: ${failedCount}`);
  console.log(`==========================================`);

  if (failedCount > 0) {
    process.exit(1);
  }
}

runM11RegressionSuite();
