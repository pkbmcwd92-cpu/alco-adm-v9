import { CurriculumType, AcademicSetting, WorkflowStepId, DocumentType } from '../types';
import { getCurriculumType } from './jpEngine';
import { GRADE_PHASE_MAP, getPhaseFromGrade } from '../data/curriculumDefaults';

export interface WorkflowStepItem {
  id: WorkflowStepId;
  number: string;
  title: string;
  shortLabel: string;
  description: string;
}

/**
 * Single source of truth helper to extract the active CurriculumType
 * from an AcademicSetting or arbitrary object containing curriculumType / curriculum.
 */
export function getCurriculumTypeFromSetting(
  setting?: AcademicSetting | { curriculum?: string; curriculumType?: CurriculumType } | null
): CurriculumType | undefined {
  if (!setting) return undefined;
  if (setting.curriculum && setting.curriculum.trim()) {
    const curr = setting.curriculum.toLowerCase();
    if (curr.includes('k13') || curr.includes('2013') || curr.includes('k-13')) {
      return 'K13';
    }
    if (curr.includes('merdeka')) {
      return 'KURIKULUM_MERDEKA';
    }
    return undefined;
  }
  if (setting.curriculumType === 'K13' || setting.curriculumType === 'KURIKULUM_MERDEKA') {
    return setting.curriculumType;
  }
  return undefined;
}

/**
 * Returns true if the curriculum is Kurikulum Merdeka
 */
export function isMerdeka(
  setting?: AcademicSetting | { curriculum?: string; curriculumType?: CurriculumType } | null
): boolean {
  return getCurriculumTypeFromSetting(setting) === 'KURIKULUM_MERDEKA';
}

/**
 * Returns true if the curriculum is Kurikulum 2013 (K13)
 */
export function isK13(
  setting?: AcademicSetting | { curriculum?: string; curriculumType?: CurriculumType } | null
): boolean {
  return getCurriculumTypeFromSetting(setting) === 'K13';
}

export interface AcademicSettingReadinessResult {
  valid: boolean;
  curriculumType?: CurriculumType;
  errors: string[];
}

/**
 * Validates whether an AcademicSetting has all mandatory fields completed and resolved.
 * Must be resolved to either 'K13' or 'KURIKULUM_MERDEKA'. Unknown/unsupported are invalid.
 * Canonical validation rules:
 * - curriculum resolved (K13 or KURIKULUM_MERDEKA)
 * - academicYear format YYYY/YYYY where secondYear === firstYear + 1
 * - semester strictly '1 (Ganjil)' or '2 (Genap)'
 * - level strictly supported canonical level: SD, SMP, SMA (SMK unsupported downstream)
 * - grade compatible with level via GRADE_PHASE_MAP
 * - phase for Kurikulum Merdeka derived and valid
 * - subject non-empty trimmed
 */
export function validateAcademicSettingReadiness(
  setting?: AcademicSetting | null
): AcademicSettingReadinessResult {
  const errors: string[] = [];
  if (!setting) {
    return {
      valid: false,
      errors: ['Data Pembelajaran belum diisi.'],
    };
  }

  // 1. Curriculum
  const curriculumType = getCurriculumTypeFromSetting(setting);
  if (!curriculumType || (curriculumType !== 'K13' && curriculumType !== 'KURIKULUM_MERDEKA')) {
    errors.push('Pilih kurikulum terlebih dahulu.');
  }

  // 2. Academic Year: format YYYY/YYYY with consecutive years (secondYear === firstYear + 1)
  const rawAcademicYear = (setting.academicYear || '').trim();
  const yearMatch = rawAcademicYear.match(/^(\d{4})\/(\d{4})$/);
  if (!yearMatch) {
    errors.push('Tahun ajaran harus menggunakan format YYYY/YYYY yang berurutan.');
  } else {
    const firstYear = parseInt(yearMatch[1], 10);
    const secondYear = parseInt(yearMatch[2], 10);
    if (secondYear !== firstYear + 1) {
      errors.push('Tahun ajaran harus menggunakan format YYYY/YYYY yang berurutan.');
    }
  }

  // 3. Semester: exactly '1 (Ganjil)' or '2 (Genap)'
  const rawSemester = (setting.semester || '').trim();
  if (rawSemester !== '1 (Ganjil)' && rawSemester !== '2 (Genap)') {
    errors.push('Pilih semester yang valid (1 (Ganjil) atau 2 (Genap)).');
  }

  // 4. Level: canonical supported levels: SD, SMP, SMA (SMK is unsupported downstream)
  const rawLevel = (setting.level || '').trim();
  const canonicalLevels = ['SD', 'SMP', 'SMA'];
  let isLevelValid = false;
  if (!rawLevel) {
    errors.push('Pilih jenjang pendidikan terlebih dahulu.');
  } else if (rawLevel === 'SMK') {
    errors.push('Jenjang SMK saat ini belum didukung dalam resolusi kurikulum standar.');
  } else if (!canonicalLevels.includes(rawLevel)) {
    errors.push('Pilih jenjang pendidikan yang valid (SD, SMP, atau SMA).');
  } else {
    isLevelValid = true;
  }

  // 5. Grade against Level
  const rawGrade = (setting.grade || '').trim();
  if (!rawGrade) {
    errors.push('Pilih tingkat/kelas terlebih dahulu.');
  } else if (isLevelValid) {
    const levelGrades = GRADE_PHASE_MAP[rawLevel];
    const isGradeValidForLevel = levelGrades && levelGrades.some((g) => g.grade === rawGrade);
    if (!isGradeValidForLevel) {
      errors.push(`Tingkat/kelas '${rawGrade}' tidak valid untuk jenjang ${rawLevel}.`);
    }
  } else if (rawLevel === 'SMK') {
    const levelGrades = GRADE_PHASE_MAP['SMK'];
    const isGradeValidForLevel = levelGrades && levelGrades.some((g) => g.grade === rawGrade);
    if (!isGradeValidForLevel) {
      errors.push(`Tingkat/kelas '${rawGrade}' tidak valid untuk jenjang SMK.`);
    }
  } else {
    errors.push(`Tingkat/kelas '${rawGrade}' tidak valid karena jenjang belum valid.`);
  }

  // 6. Merdeka Phase validation
  if (curriculumType === 'KURIKULUM_MERDEKA' && isLevelValid && rawGrade) {
    const derivedPhase = getPhaseFromGrade(rawLevel, rawGrade);
    if (!derivedPhase || !derivedPhase.trim()) {
      errors.push('Fase pembelajaran tidak dapat ditentukan untuk jenjang dan kelas ini.');
    }
  }

  // 7. Subject: trimmed non-empty
  const rawSubject = (setting.subject || '').trim();
  if (!rawSubject) {
    errors.push('Mata pelajaran tidak boleh kosong.');
  }

  return {
    valid: errors.length === 0,
    curriculumType: errors.length === 0 ? curriculumType : undefined,
    errors,
  };
}

/**
 * 01 Profil
 * 02 Data Pembelajaran
 * 03 CP
 * 04 Analisis CP
 * 05 TP
 * 06 ATP
 * 07 Administrasi
 */
export const MERDEKA_WORKFLOW_STEPS: WorkflowStepItem[] = [
  {
    id: 'profile',
    number: '01',
    title: 'PROFIL',
    shortLabel: 'Profil',
    description: 'Guru & Satuan Pendidikan',
  },
  {
    id: 'academic',
    number: '02',
    title: 'DATA PEMBELAJARAN',
    shortLabel: 'Data',
    description: 'Kelas, Fase, Mapel & JP',
  },
  {
    id: 'cp',
    number: '03',
    title: 'CP',
    shortLabel: 'CP',
    description: 'Capaian Pembelajaran & Rujukan',
  },
  {
    id: 'cp-analysis',
    number: '04',
    title: 'ANALISIS CP',
    shortLabel: 'Analisis CP',
    description: 'Bedah Kompetensi & Lingkup Materi',
  },
  {
    id: 'tp',
    number: '05',
    title: 'TP',
    shortLabel: 'TP',
    description: 'Tujuan Pembelajaran & KKO',
  },
  {
    id: 'atp',
    number: '06',
    title: 'ATP',
    shortLabel: 'ATP',
    description: 'Alur Tujuan & Alokasi JP',
  },
  {
    id: 'admin',
    number: '07',
    title: 'ADMINISTRASI',
    shortLabel: 'Administrasi',
    description: 'Perencanaan, Asesmen & Dokumen',
  },
];

/**
 * KURIKULUM 2013 (K13) WORKFLOW
 * Struktur berbasis regulasi dan panduan PPA K13:
 * 01 Profil
 * 02 Data Pembelajaran
 * 03 SKL / KI / KD
 * 04 Analisis KD (Telaah KD & Materi Pokok)
 * 05 Tujuan Pembelajaran & Indikator (IPK)
 * 06 Administrasi (Perencanaan Waktu, Kriteria Ketercapaian/KKM, Asesmen & Nilai, Dokumen)
 */
export const K13_WORKFLOW_STEPS: WorkflowStepItem[] = [
  {
    id: 'profile',
    number: '01',
    title: 'PROFIL',
    shortLabel: 'Profil',
    description: 'Guru & Satuan Pendidikan',
  },
  {
    id: 'academic',
    number: '02',
    title: 'DATA PEMBELAJARAN',
    shortLabel: 'Data',
    description: 'Kelas, Mapel & Alokasi JP',
  },
  {
    id: 'k13-kd',
    number: '03',
    title: 'SKL / KI / KD',
    shortLabel: 'SKL / KI / KD',
    description: 'Kompetensi Dasar & Keselarasan',
  },
  {
    id: 'k13-indikator',
    number: '04',
    title: 'ANALISIS KD',
    shortLabel: 'Analisis KD',
    description: 'Telaah KD & Ruang Lingkup Materi',
  },
  {
    id: 'k13-tujuan',
    number: '05',
    title: 'TUJUAN & INDIKATOR',
    shortLabel: 'Tujuan & IPK',
    description: 'Tujuan Pembelajaran & Indikator Pencapaian',
  },
  {
    id: 'admin',
    number: '06',
    title: 'ADMINISTRASI',
    shortLabel: 'Administrasi',
    description: 'Perencanaan, Penilaian & Dokumen',
  },
];

/**
 * Get active workflow steps for the given curriculum type
 */
export function getWorkflowSteps(curriculumType: CurriculumType): WorkflowStepItem[] {
  return curriculumType === 'K13' ? K13_WORKFLOW_STEPS : MERDEKA_WORKFLOW_STEPS;
}

export const MERDEKA_EXPORT_DOC_TYPES: DocumentType[] = [
  'ANALISIS_CP_TP',
  'ATP',
  'KALENDER_AKADEMIK',
  'ALOKASI_WAKTU',
  'PROTA',
  'PROMES',
  'MODUL_AJAR',
  'KKTP',
  'ASESMEN',
  'DAFTAR_HADIR',
  'DAFTAR_NILAI',
  'JURNAL',
  'REMEDIAL_PENGAYAAN',
];

/**
 * Standard K13 Export Documents.
 * PENETAPAN_KKM is optional and not automatically included unless explicitly chosen or legacy KKM is active.
 */
export const K13_BASE_EXPORT_DOC_TYPES: DocumentType[] = [
  'ANALISIS_SKL_KI_KD',
  'KALENDER_AKADEMIK',
  'ALOKASI_WAKTU',
  'PROTA',
  'PROMES',
  'DAFTAR_HADIR',
  'DAFTAR_NILAI',
  'JURNAL',
  'REMEDIAL_PENGAYAAN',
];

/**
 * @deprecated Use K13_BASE_EXPORT_DOC_TYPES or getCurriculumDocumentTypes(curriculumType, { includeKkm })
 */
export const K13_EXPORT_DOC_TYPES: DocumentType[] = [
  ...K13_BASE_EXPORT_DOC_TYPES,
  'PENETAPAN_KKM',
];

export interface CurriculumDocOptions {
  includeKkm?: boolean;
  criteriaMode?: string;
  hasK13KKM?: boolean;
}

export function getCurriculumDocumentTypes(
  curriculumType: CurriculumType,
  options?: CurriculumDocOptions
): DocumentType[] {
  if (curriculumType === 'KURIKULUM_MERDEKA') {
    return MERDEKA_EXPORT_DOC_TYPES;
  }
  const docs = [...K13_BASE_EXPORT_DOC_TYPES];
  const shouldIncludeKkm =
    options?.includeKkm === true ||
    options?.criteriaMode === 'LEGACY_KKM' ||
    options?.criteriaMode === 'legacy_kkm';

  if (shouldIncludeKkm) {
    docs.push('PENETAPAN_KKM');
  }
  return docs;
}

/**
 * Checks if a WorkflowStepId is valid for the given curriculum type
 */
export function isStepAllowed(stepId: WorkflowStepId, curriculumType: CurriculumType): boolean {
  if (stepId === 'profile' || stepId === 'academic' || stepId === 'admin') return true;
  if (curriculumType === 'KURIKULUM_MERDEKA') {
    return ['cp', 'cp-analysis', 'tp', 'atp'].includes(stepId);
  } else {
    // k13-kkm is allowed only as legacy redirection
    return ['k13-kd', 'k13-indikator', 'k13-tujuan', 'k13-kkm'].includes(stepId);
  }
}

/**
 * Resolves a valid WorkflowStepId when switching between curricula or loading invalid step
 */
export function resolveStep(stepId: WorkflowStepId, curriculumType: CurriculumType): WorkflowStepId {
  if (isStepAllowed(stepId, curriculumType)) {
    // If user lands on legacy k13-kkm step in K13, resolve directly to admin
    if (curriculumType === 'K13' && stepId === 'k13-kkm') {
      return 'admin';
    }
    return stepId;
  }
  if (curriculumType === 'K13') {
    if (stepId === 'cp' || stepId === 'cp-analysis') return 'k13-kd';
    if (stepId === 'tp') return 'k13-indikator';
    if (stepId === 'atp') return 'k13-tujuan';
    return 'k13-kd';
  } else {
    if (stepId === 'k13-kd') return 'cp';
    if (stepId === 'k13-indikator') return 'cp-analysis';
    if (stepId === 'k13-tujuan' || stepId === 'k13-kkm') return 'tp';
    return 'cp';
  }
}
