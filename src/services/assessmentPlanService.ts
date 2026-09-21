import {
  AssessmentPlan,
  AssessmentPurpose,
  AssessmentTiming,
  AssessmentScopeType,
  AssessmentInstrumentRef,
  AssessmentCriterion,
  TPData,
  K13Analysis,
  LearningPlan,
  Assessment,
  AcademicSetting,
} from '../types';
import { isK13, isMerdeka } from './curriculumRouter';

export interface AssessmentPlanValidationContext {
  academicSetting?: AcademicSetting;
  tp?: TPData;
  k13Analysis?: K13Analysis;
  assessmentCriteria?: AssessmentCriterion[];
  learningPlans?: LearningPlan[];
}

export interface AssessmentPlanValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Service Layer untuk Canonical Assessment Plan (Audit 9A).
 * Mengelola lifecycle, validasi, dan penanganan dependensi perangkat asesmen.
 */

export function createEmptyAssessmentPlan(params: {
  academicSettingId: string;
  workspaceId?: string;
  title?: string;
  purpose?: AssessmentPurpose;
  timing?: AssessmentTiming;
  scopeType?: AssessmentScopeType;
  tpIds?: string[];
  criterionIds?: string[];
  instruments?: AssessmentInstrumentRef[];
  displayLabel?: string;
  customTimingLabel?: string;
  customScopeLabel?: string;
}): AssessmentPlan {
  const now = new Date().toISOString();
  return {
    id: `asp-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    academicSettingId: params.academicSettingId,
    workspaceId: params.workspaceId,
    title: params.title || '',
    purpose: params.purpose || 'FORMATIVE',
    timing: params.timing || 'POST',
    scopeType: params.scopeType || 'TP',
    tpIds: params.tpIds || [],
    criterionIds: params.criterionIds || [],
    instruments: params.instruments || [],
    displayLabel: params.displayLabel,
    customTimingLabel: params.customTimingLabel,
    customScopeLabel: params.customScopeLabel,
    workflowStatus: 'DRAFT',
    needsReview: false,
    revision: 1,
    provenance: {
      generatedBy: 'USER',
      engine: 'MANUAL',
    },
    createdAt: now,
    updatedAt: now,
  };
}

export function createAIDraftAssessmentPlan(params: {
  academicSettingId: string;
  workspaceId?: string;
  title: string;
  purpose: AssessmentPurpose;
  timing: AssessmentTiming;
  scopeType: AssessmentScopeType;
  tpIds?: string[];
  criterionIds?: string[];
  instruments?: AssessmentInstrumentRef[];
  displayLabel?: string;
}): AssessmentPlan {
  const base = createEmptyAssessmentPlan({
    ...params,
  });
  return {
    ...base,
    workflowStatus: 'DRAFT',
    needsReview: true,
    reviewReason: 'Draf asesmen dihasilkan oleh AI. Harap diperiksa dan disesuaikan oleh guru sebelum dikonfirmasi SIAP.',
    provenance: {
      generatedBy: 'AI',
      engine: 'GEMINI_STUDIO',
    },
  };
}

export function validateAssessmentPlan(
  plan: AssessmentPlan,
  context: AssessmentPlanValidationContext
): AssessmentPlanValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Identity & Setting
  if (!plan.academicSettingId) {
    errors.push('Rencana Asesmen belum terhubung ke Setting Akademik.');
  }

  if (!plan.title || !plan.title.trim()) {
    errors.push('Judul Perangkat Asesmen wajib diisi.');
  }

  // 2. Scope constraints
  if (plan.scopeType === 'TP') {
    if (plan.tpIds.length === 0) {
      errors.push('Asesmen dengan cakupan "TP" wajib memilih tepat 1 Tujuan Pembelajaran.');
    } else if (plan.tpIds.length > 1) {
      errors.push('Asesmen lingkup TP tunggal tidak boleh mereferensikan lebih dari 1 TP. Gunakan jenis cakupan "MULTI_TP".');
    }
  } else if (plan.scopeType === 'MULTI_TP') {
    if (plan.tpIds.length < 2) {
      errors.push('Asesmen dengan cakupan "MULTI_TP" harus memilih minimal 2 Tujuan Pembelajaran.');
    }
  }

  // Canonical Objective Source Verification
  const hasSetting = !!context.academicSetting;
  const currStr = context.academicSetting?.curriculum || '';
  const currType = context.academicSetting?.curriculumType;
  const isCurrUnresolved = !hasSetting || (!currStr && !currType);

  if (isCurrUnresolved) {
    if (plan.scopeType === 'TP' || plan.scopeType === 'MULTI_TP' || plan.tpIds.length > 0) {
      errors.push('Konteks kurikulum tidak teridentifikasi sehingga referensi asesmen tidak dapat diverifikasi.');
    }
  } else if (isMerdeka(context.academicSetting)) {
    if (plan.scopeType === 'TP' || plan.scopeType === 'MULTI_TP' || plan.tpIds.length > 0) {
      if (!context.tp?.items || context.tp.items.length === 0) {
        errors.push('Sumber TP canonical Kurikulum Merdeka tidak tersedia sehingga referensi asesmen tidak dapat diverifikasi.');
      } else {
        const validTpIds = new Set(context.tp.items.map((t) => t.id));
        const invalidTpIds = plan.tpIds.filter((id) => !validTpIds.has(id));
        if (invalidTpIds.length > 0) {
          errors.push(`Terdapat ${invalidTpIds.length} referensi Tujuan Pembelajaran (TP) yang tidak valid atau telah dihapus dari alur hulu.`);
        }
      }
    }
  } else if (isK13(context.academicSetting)) {
    if (plan.scopeType === 'TP' || plan.scopeType === 'MULTI_TP' || plan.tpIds.length > 0) {
      if (!context.k13Analysis?.items || context.k13Analysis.items.length === 0) {
        errors.push('Sumber KD canonical Kurikulum 2013 tidak tersedia sehingga referensi asesmen tidak dapat diverifikasi.');
      } else {
        const validKdIds = new Set(context.k13Analysis.items.map((k) => k.id));
        const invalidKdIds = plan.tpIds.filter((id) => !validKdIds.has(id));
        if (invalidKdIds.length > 0) {
          errors.push(`Terdapat ${invalidKdIds.length} referensi Kompetensi Dasar (KD) yang tidak valid atau telah dihapus dari alur hulu.`);
        }
      }
    }
  }

  // 3. Custom Labels Check
  if (plan.timing === 'CUSTOM' && (!plan.customTimingLabel || !plan.customTimingLabel.trim())) {
    errors.push('Waktu Pelaksanaan kustom (CUSTOM) wajib melengkapi teks label waktu.');
  }

  if (plan.scopeType === 'CUSTOM' && (!plan.customScopeLabel || !plan.customScopeLabel.trim())) {
    errors.push('Cakupan Asesmen kustom (CUSTOM) wajib melengkapi teks label cakupan.');
  }

  // 4. Instrument Requirements
  if (!plan.instruments || plan.instruments.length === 0) {
    errors.push('Minimal 1 Bentuk / Instrumen Asesmen harus dipilih untuk menyelesaikan perencanaan.');
  }

  // 5. KKTP Criteria References Check
  if (plan.criterionIds && plan.criterionIds.length > 0 && context.assessmentCriteria) {
    const validCriteriaIds = new Set(context.assessmentCriteria.map((c) => c.id));
    const invalidCriteria = plan.criterionIds.filter((cid) => !validCriteriaIds.has(cid));
    if (invalidCriteria.length > 0) {
      errors.push(`Terdapat ${invalidCriteria.length} referensi Kriteria Capaian (KKTP) yang tidak ditemukan pada alur hulu.`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

export function confirmAssessmentPlan(
  plan: AssessmentPlan,
  context: AssessmentPlanValidationContext
): { success: boolean; plan: AssessmentPlan; errors: string[] } {
  const validation = validateAssessmentPlan(plan, context);
  if (!validation.valid) {
    return {
      success: false,
      plan,
      errors: validation.errors,
    };
  }

  const now = new Date().toISOString();
  return {
    success: true,
    plan: {
      ...plan,
      workflowStatus: 'SIAP',
      needsReview: false,
      reviewReason: undefined,
      revision: (plan.revision || 1) + 1,
      provenance: {
        ...(plan.provenance || { generatedBy: 'USER' }),
        generatedBy: 'USER',
        engine: 'TEACHER_CONFIRMED',
      },
      confirmedAt: now,
      updatedAt: now,
    },
    errors: [],
  };
}

export function invalidateAssessmentPlanDependencies(
  plan: AssessmentPlan,
  context: AssessmentPlanValidationContext
): { isInvalidated: boolean; plan: AssessmentPlan } {
  if (plan.workflowStatus !== 'SIAP') {
    return { isInvalidated: false, plan };
  }

  const validation = validateAssessmentPlan(plan, context);
  if (!validation.valid) {
    return {
      isInvalidated: true,
      plan: {
        ...plan,
        workflowStatus: 'PERLU_DILENGKAPI',
        needsReview: true,
        reviewReason: `Dependensi hulu mengalami perubahan atau penghapusan: ${validation.errors.join('; ')}`,
        updatedAt: new Date().toISOString(),
      },
    };
  }

  return { isInvalidated: false, plan };
}

export function migrateLegacyAssessment(
  legacy: Assessment,
  context: AssessmentPlanValidationContext,
  existingPlans: AssessmentPlan[] = []
): AssessmentPlan {
  const migrationId = `asp-migrated-${legacy.id}`;

  // Check if already migrated
  const found = existingPlans.find((p) => p.id === migrationId || p.id === legacy.id);
  if (found) {
    return found;
  }

  const now = new Date().toISOString();
  const purpose: AssessmentPurpose = legacy.type === 'formatif' ? 'FORMATIVE' : 'SUMMATIVE';
  const timing: AssessmentTiming =
    legacy.type === 'formatif'
      ? 'DURING'
      : legacy.type === 'sumatif_akhir_semester'
      ? 'END_SEMESTER'
      : 'POST';
  const scopeType: AssessmentScopeType = legacy.type === 'sumatif_akhir_semester' ? 'SEMESTER' : 'TP';

  const tpIds = legacy.tpId ? [legacy.tpId] : [];

  const rawPlan: AssessmentPlan = {
    id: migrationId,
    academicSettingId: legacy.academicSettingId,
    title: legacy.title || 'Asesmen Migrasi',
    purpose,
    timing,
    scopeType,
    tpIds,
    criterionIds: [],
    instruments: [], // BLOCKER 1: NO FAKE INSTRUMENT!
    displayLabel: legacy.title,
    workflowStatus: 'PERLU_DILENGKAPI',
    needsReview: true,
    reviewReason: 'Hasil migrasi dari perangkat asesmen legacy. Harap tentukan instrumen dan konfirmasi.',
    revision: 1,
    provenance: {
      generatedBy: 'SYSTEM',
      engine: 'LEGACY_MIGRATION',
    },
    createdAt: legacy.createdAt || now,
    updatedAt: now,
  };

  const validation = validateAssessmentPlan(rawPlan, context);
  if (validation.valid) {
    return {
      ...rawPlan,
      workflowStatus: 'SIAP',
      needsReview: false,
      reviewReason: undefined,
      confirmedAt: now,
    };
  } else {
    return {
      ...rawPlan,
      workflowStatus: 'PERLU_DILENGKAPI',
      needsReview: true,
      reviewReason: validation.errors.join('; ') || 'Data migrasi legacy belum lengkap.',
    };
  }
}
