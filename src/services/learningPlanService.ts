import {
  LearningPlan,
  LearningPlanStatus,
  LearningPlanSource,
  AcademicSetting,
  TPData,
  ATPData,
  K13Analysis,
  TimeAllocation,
  AssessmentCriterion,
  CurriculumType,
  TPItem,
  ATPItem,
  LearningExperience,
  LearningExperiencePhase,
  DeepLearningPrinciple,
  DeepLearningContext,
} from '../types';

export const LEARNING_EXPERIENCE_PHASE_LABELS: Record<LearningExperiencePhase, string> = {
  UNDERSTAND: 'Memahami',
  APPLY: 'Mengaplikasi',
  REFLECT: 'Merefleksi',
};

export const DEEP_LEARNING_PRINCIPLE_LABELS: Record<DeepLearningPrinciple, string> = {
  MINDFUL: 'Berkesadaran',
  MEANINGFUL: 'Bermakna',
  JOYFUL: 'Menggembirakan',
};

export const GRADUATE_PROFILE_DIMENSIONS_LABEL = 'Dimensi Profil Lulusan';
export const LEARNING_EXPERIENCES_LABEL = 'Pengalaman Belajar';

export interface LearningPlanValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  resolvedTPs: Array<{ id: string; code?: string; statement: string; materialScope?: string }>;
  resolvedATPs: Array<{ id: string; stepNumber?: number; materialScope?: string; jp?: number }>;
  resolvedAllocatedJP?: number;
}

/**
 * Validates a canonical LearningPlan against workspace dependencies.
 * Follows strict principles:
 * - NO DATA > FAKE DATA
 * - ID > TEXT MATCH
 * - UNRESOLVED > GUESS
 * - VALIDATOR > AUTO SIAP
 * - AI OUTPUT = DRAFT
 * - TEACHER EDIT ALWAYS WINS
 */
export function validateLearningPlan(
  plan: LearningPlan,
  context: {
    academicSetting?: AcademicSetting | null;
    tp?: TPData | null;
    atp?: ATPData | null;
    k13Analysis?: K13Analysis | null;
    timeAllocations?: TimeAllocation[] | null;
    assessmentCriteria?: AssessmentCriterion[] | null;
  }
): LearningPlanValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const resolvedTPs: Array<{ id: string; code?: string; statement: string; materialScope?: string }> = [];
  const resolvedATPs: Array<{ id: string; stepNumber?: number; materialScope?: string; jp?: number }> = [];

  if (!plan) {
    return {
      valid: false,
      errors: ['Data Perencanaan Pembelajaran (LearningPlan) tidak ditemukan / kosong.'],
      warnings: [],
      resolvedTPs: [],
      resolvedATPs: [],
    };
  }

  // 1. Validate Academic Setting linkage
  if (!plan.academicSettingId || plan.academicSettingId.trim() === '') {
    errors.push('ID Pengaturan Akademik (academicSettingId) tidak valid.');
  } else if (context.academicSetting && context.academicSetting.id !== plan.academicSettingId) {
    errors.push(`ID Pengaturan Akademik tidak sesuai (Plan: ${plan.academicSettingId}, Context: ${context.academicSetting.id}).`);
  }

  // 2. Validate Canonical TP Dependency (Strict ID lookup - NO text matching)
  if (!plan.tpIds || !Array.isArray(plan.tpIds) || plan.tpIds.length === 0) {
    errors.push('Perencanaan Pembelajaran wajib merujuk minimal 1 Tujuan Pembelajaran (tpIds kosong).');
  } else {
    const isK13 = plan.curriculumType === 'K13';
    const availableTpItems: TPItem[] = context.tp?.items || [];
    const availableK13Items = context.k13Analysis?.items || [];

    for (const tpId of plan.tpIds) {
      if (isK13) {
        // In K13, check k13Analysis items or tp items
        const foundK13 = availableK13Items.find((item) => item.id === tpId);
        const foundTp = availableTpItems.find((item) => item.id === tpId);
        if (foundK13) {
          resolvedTPs.push({
            id: foundK13.id,
            code: foundK13.kd ? foundK13.kd.slice(0, 10) : 'KD',
            statement: foundK13.tujuanPembelajaran || foundK13.indikator || foundK13.kd || '',
            materialScope: foundK13.materi,
          });
        } else if (foundTp) {
          resolvedTPs.push({
            id: foundTp.id,
            code: foundTp.code,
            statement: foundTp.statement || foundTp.description || '',
            materialScope: foundTp.contentScope,
          });
        } else {
          errors.push(`Rujukan TP/KD dengan ID '${tpId}' tidak ditemukan pada data kurikulum aktif (Orphan TP ID).`);
        }
      } else {
        // Merdeka: Strict lookup in context.tp.items by item.id
        const foundTp = availableTpItems.find((item) => item.id === tpId);
        if (foundTp) {
          resolvedTPs.push({
            id: foundTp.id,
            code: foundTp.code,
            statement: foundTp.statement || foundTp.description || '',
            materialScope: foundTp.contentScope,
          });
        } else {
          errors.push(`Tujuan Pembelajaran dengan ID '${tpId}' tidak ditemukan dalam basis data TP (Orphan TP ID).`);
        }
      }
    }
  }

  // 3. Validate Canonical ATP Dependency (Strict ID lookup)
  if (plan.atpItemIds && Array.isArray(plan.atpItemIds) && plan.atpItemIds.length > 0) {
    const availableAtpItems: ATPItem[] = context.atp?.items || [];
    for (const atpItemId of plan.atpItemIds) {
      const foundAtp = availableAtpItems.find((item) => item.id === atpItemId);
      if (foundAtp) {
        resolvedATPs.push({
          id: foundAtp.id,
          stepNumber: foundAtp.stepNumber,
          materialScope: foundAtp.materialScope,
          jp: typeof foundAtp.jp === 'number' ? foundAtp.jp : undefined,
        });
      } else {
        errors.push(`Langkah ATP dengan ID '${atpItemId}' tidak ditemukan dalam alur ATP aktif (Orphan ATP ID).`);
      }
    }
  }

  // 4. Validate Objectives list
  if (!plan.objectives || !Array.isArray(plan.objectives) || plan.objectives.length === 0) {
    errors.push('Daftar rumusan Tujuan Pembelajaran (objectives) tidak boleh kosong.');
  } else {
    for (let i = 0; i < plan.objectives.length; i++) {
      const obj = plan.objectives[i];
      if (!obj.statement || obj.statement.trim() === '') {
        errors.push(`Tujuan Pembelajaran butir ke-${i + 1} memiliki rumusan kalimat kosong.`);
      }
    }
  }

  // 5. Validate Learning Activity & Canonical Learning Experiences (2026 Compatible)
  const experiences = Array.isArray(plan.learningExperiences) ? plan.learningExperiences : [];
  const seenExpIds = new Set<string>();
  let validExpCount = 0;

  for (let i = 0; i < experiences.length; i++) {
    const exp = experiences[i];
    if (!exp) continue;

    let isExperienceValid = true;

    // Validate ID
    if (!exp.id || exp.id.trim() === '') {
      errors.push(`Pengalaman Belajar butir ke-${i + 1} memiliki ID kosong.`);
      isExperienceValid = false;
    } else if (seenExpIds.has(exp.id)) {
      errors.push(`Terdapat duplikasi ID '${exp.id}' pada Pengalaman Belajar (learningExperiences).`);
      isExperienceValid = false;
    } else {
      seenExpIds.add(exp.id);
    }

    // Validate phase
    const validPhases: LearningExperiencePhase[] = ['UNDERSTAND', 'APPLY', 'REFLECT'];
    if (!validPhases.includes(exp.phase)) {
      errors.push(
        `Pengalaman Belajar '${exp.id || i + 1}' memiliki fase tidak sah ('${exp.phase}'). Pilihan yang sah: UNDERSTAND (Memahami), APPLY (Mengaplikasi), REFLECT (Merefleksi).`
      );
      isExperienceValid = false;
    }

    // Validate description
    if (!exp.description || exp.description.trim() === '') {
      errors.push(`Pengalaman Belajar '${exp.id || i + 1}' memiliki deskripsi kosong.`);
      isExperienceValid = false;
    }

    // Validate durationMinutes if provided
    if (exp.durationMinutes !== undefined && exp.durationMinutes !== null) {
      if (
        typeof exp.durationMinutes !== 'number' ||
        !Number.isFinite(exp.durationMinutes) ||
        isNaN(exp.durationMinutes) ||
        exp.durationMinutes <= 0
      ) {
        errors.push(
          `Pengalaman Belajar '${exp.id || i + 1}' memiliki alokasi waktu (durationMinutes) tidak valid: ${String(exp.durationMinutes)}. Harus berupa bilangan positif terhingga (> 0).`
        );
        isExperienceValid = false;
      }
    }

    // Validate linked TP IDs (strictly canonical, no dangling references)
    if (exp.linkedTpIds && Array.isArray(exp.linkedTpIds)) {
      for (const linkedId of exp.linkedTpIds) {
        if (!plan.tpIds || !plan.tpIds.includes(linkedId)) {
          errors.push(
            `Pengalaman Belajar '${exp.id || i + 1}' merujuk TP ID '${linkedId}' yang tidak terdaftar dalam perencanaan ini (dangling TP reference).`
          );
          isExperienceValid = false;
        }
      }
    }

    if (isExperienceValid) {
      validExpCount++;
    }
  }

  // Legacy learning steps evaluation
  const openingSteps = plan.learningSteps?.opening || [];
  const coreSteps = plan.learningSteps?.core || [];
  const closingSteps = plan.learningSteps?.closing || [];

  const coreValidCount = coreSteps.filter((s) => s && s.description && s.description.trim().length > 0).length;
  const openingValidCount = openingSteps.filter((s) => s && s.description && s.description.trim().length > 0).length;
  const closingValidCount = closingSteps.filter((s) => s && s.description && s.description.trim().length > 0).length;
  const hasLegacySteps = (openingValidCount + coreValidCount + closingValidCount) > 0;

  // Learning activity check: valid if canonical learning experiences OR valid legacy steps exist
  if (validExpCount > 0) {
    // Canonical 2026 pathway satisfied! Core steps in legacy schema are NOT required.
    if (openingValidCount === 0 && hasLegacySteps) {
      warnings.push('Kegiatan Pendahuluan belum diisi deskripsi aktivitasnya.');
    }
    if (closingValidCount === 0 && hasLegacySteps) {
      warnings.push('Kegiatan Penutup belum diisi deskripsi aktivitasnya.');
    }
  } else if (hasLegacySteps) {
    // Legacy pathway validation
    if (coreValidCount === 0) {
      errors.push('Kegiatan Inti pembelajaran wajib memiliki minimal 1 langkah aktivitas yang terisi deskripsinya (atau sediakan Pengalaman Belajar canonical).');
    }
    if (openingValidCount === 0) {
      warnings.push('Kegiatan Pendahuluan belum diisi deskripsi aktivitasnya.');
    }
    if (closingValidCount === 0) {
      warnings.push('Kegiatan Penutup belum diisi deskripsi aktivitasnya.');
    }
  } else {
    // Neither canonical experiences nor legacy steps exist
    errors.push('Perencanaan Pembelajaran wajib memiliki aktivitas pembelajaran (Pengalaman Belajar canonical 2026 atau Langkah Pembelajaran legacy).');
  }

  // 6. Validate Deep Learning Context (Optional contextual model - NOT mandatory checklist)
  if (plan.deepLearningContext) {
    if (Array.isArray(plan.deepLearningContext.principles)) {
      const validPrinciples: DeepLearningPrinciple[] = ['MINDFUL', 'MEANINGFUL', 'JOYFUL'];
      for (const p of plan.deepLearningContext.principles) {
        if (!validPrinciples.includes(p)) {
          errors.push(`Prinsip Pembelajaran Mendalam '${p}' tidak valid. Pilihan yang sah: MINDFUL (Berkesadaran), MEANINGFUL (Bermakna), JOYFUL (Menggembirakan).`);
        }
      }
      const uniquePrinciples = new Set(plan.deepLearningContext.principles);
      if (uniquePrinciples.size !== plan.deepLearningContext.principles.length) {
        errors.push('Terdapat duplikasi nilai pada prinsip Pembelajaran Mendalam (principles).');
      }
    }
    if (Array.isArray(plan.deepLearningContext.graduateProfileDimensions)) {
      const uniqueDims = new Set(plan.deepLearningContext.graduateProfileDimensions);
      if (uniqueDims.size !== plan.deepLearningContext.graduateProfileDimensions.length) {
        warnings.push('Terdapat duplikasi nilai pada Dimensi Profil Lulusan pada deepLearningContext.');
      }
    }
  }

  // 7. Validate Graduate Profile Dimensions duplicates
  if (Array.isArray(plan.graduateProfileDimensions)) {
    const uniqueDims = new Set(plan.graduateProfileDimensions);
    if (uniqueDims.size !== plan.graduateProfileDimensions.length) {
      warnings.push('Terdapat duplikasi nilai pada Dimensi Profil Lulusan (graduateProfileDimensions).');
    }
  }

  // 8. Validate Assessment Plan (Rencana Asesmen)
  const initialAssessments = plan.assessmentPlan?.initial || [];
  const formativeAssessments = plan.assessmentPlan?.formative || [];
  const summativeAssessments = plan.assessmentPlan?.summative || [];

  const totalAssessmentItems = initialAssessments.length + formativeAssessments.length + summativeAssessments.length;
  if (totalAssessmentItems === 0) {
    errors.push('Rencana Asesmen minimal harus memuat salah satu bentuk penilaian (Awal, Formatif, atau Sumatif).');
  } else {
    const allAssessments = [...initialAssessments, ...formativeAssessments, ...summativeAssessments];
    for (const item of allAssessments) {
      if (item.linkedTpIds && Array.isArray(item.linkedTpIds)) {
        for (const linkedId of item.linkedTpIds) {
          if (!plan.tpIds.includes(linkedId)) {
            errors.push(`Rencana asesmen '${item.type}' merujuk TP ID '${linkedId}' yang tidak terdaftar dalam perencanaan ini.`);
          }
        }
      }
    }
  }

  // 9. Time / JP Allocation Resolution (Strictly from real data)
  let resolvedAllocatedJP: number | undefined = undefined;
  if (typeof plan.allocatedJP === 'number' && !isNaN(plan.allocatedJP) && plan.allocatedJP > 0) {
    resolvedAllocatedJP = plan.allocatedJP;
  } else if (resolvedATPs.length > 0) {
    const totalAtpJP = resolvedATPs.reduce((sum, item) => sum + (item.jp || 0), 0);
    if (totalAtpJP > 0) {
      resolvedAllocatedJP = totalAtpJP;
    }
  } else if (context.timeAllocations && context.timeAllocations.length > 0 && plan.timeAllocationIds && plan.timeAllocationIds.length > 0) {
    const matchedAllocs = context.timeAllocations.filter((ta) => plan.timeAllocationIds?.includes(ta.id));
    const totalAllocJP = matchedAllocs.reduce((sum, a) => sum + (a.allocatedJP || a.jp || 0), 0);
    if (totalAllocJP > 0) {
      resolvedAllocatedJP = totalAllocJP;
    }
  }

  // 10. Lifecycle & Status Validation
  if (plan.status === 'SIAP') {
    if (errors.length > 0) {
      errors.push('Status SIAP tidak valid karena masih terdapat kesalahan integritas data.');
    }
    if (!plan.confirmedAt) {
      errors.push('Status SIAP memerlukan konfirmasi dan penetapan eksplisit dari guru (confirmedAt belum tercatat).');
    }
    if (plan.sourceType === 'AI_DRAFT' && !plan.confirmedAt) {
      errors.push('Keluaran draf AI tidak boleh langsung berstatus SIAP tanpa peninjauan guru.');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    resolvedTPs,
    resolvedATPs,
    resolvedAllocatedJP,
  };
}

/**
 * Creates an initial empty canonical LearningPlan in DRAFT status.
 * Never fabricates experiences, deep learning principles, or graduate profile dimensions.
 */
export function createEmptyLearningPlan(params: {
  academicSetting: AcademicSetting;
  curriculumType?: CurriculumType;
  tpIds?: string[];
  atpItemIds?: string[];
  context?: { tp?: TPData | null; atp?: ATPData | null };
}): LearningPlan {
  const { academicSetting, curriculumType = 'KURIKULUM_MERDEKA', tpIds = [], atpItemIds = [], context } = params;
  const now = new Date().toISOString();

  // Populate initial objective references from canonical TP data if available
  const objectives: LearningPlan['objectives'] = [];
  if (tpIds.length > 0 && context?.tp?.items) {
    for (const id of tpIds) {
      const found = context.tp.items.find((item) => item.id === id);
      if (found) {
        objectives.push({
          id: found.id,
          tpId: found.id,
          code: found.code,
          statement: found.statement || found.description || '',
          materialScope: found.contentScope,
        });
      }
    }
  }

  return {
    id: `lp-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    academicSettingId: academicSetting.id,
    curriculumType,
    sourceType: 'MANUAL',
    status: 'DRAFT',
    tpIds,
    atpItemIds,
    title: objectives.length > 0 ? `Modul Ajar: ${objectives[0].materialScope || objectives[0].code || 'Topik Pembelajaran'}` : '',
    topic: objectives.length > 0 ? (objectives[0].materialScope || '') : '',
    objectives,
    learningExperiences: [],
    learningSteps: {
      opening: [],
      core: [],
      closing: [],
    },
    assessmentPlan: {
      initial: [],
      formative: [],
      summative: [],
    },
    resources: [],
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Creates an AI Draft LearningPlan. Always sets sourceType: 'AI_DRAFT' and status: 'DRAFT'.
 * Preserves teacher/draft data without fabricating missing experiences/principles/dimensions.
 */
export function createAIDraftLearningPlan(params: {
  academicSetting: AcademicSetting;
  curriculumType?: CurriculumType;
  tpIds: string[];
  atpItemIds?: string[];
  aiDraft: Partial<LearningPlan>;
  context?: { tp?: TPData | null; atp?: ATPData | null };
}): LearningPlan {
  const { academicSetting, curriculumType = 'KURIKULUM_MERDEKA', tpIds, atpItemIds = [], aiDraft, context } = params;
  const now = new Date().toISOString();

  // Populate objectives strictly from canonical TPs
  const objectives: LearningPlan['objectives'] = [];
  if (tpIds.length > 0 && context?.tp?.items) {
    for (const id of tpIds) {
      const found = context.tp.items.find((item) => item.id === id);
      if (found) {
        objectives.push({
          id: found.id,
          tpId: found.id,
          code: found.code,
          statement: found.statement || found.description || '',
          materialScope: found.contentScope,
        });
      }
    }
  }

  return {
    id: `lp-ai-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    academicSettingId: academicSetting.id,
    curriculumType,
    sourceType: 'AI_DRAFT',
    status: 'DRAFT',
    tpIds,
    atpItemIds,
    title: aiDraft.title || (objectives.length > 0 ? `Draf Modul Ajar: ${objectives[0].materialScope || objectives[0].code || 'Topik'}` : 'Draf Modul Ajar'),
    topic: aiDraft.topic || (objectives.length > 0 ? objectives[0].materialScope : ''),
    objectives: objectives.length > 0 ? objectives : (aiDraft.objectives || []),
    learningExperiences: Array.isArray(aiDraft.learningExperiences) ? aiDraft.learningExperiences : [],
    deepLearningContext: aiDraft.deepLearningContext,
    graduateProfileDimensions: Array.isArray(aiDraft.graduateProfileDimensions) ? aiDraft.graduateProfileDimensions : undefined,
    learningSteps: {
      opening: aiDraft.learningSteps?.opening || [],
      core: aiDraft.learningSteps?.core || [],
      closing: aiDraft.learningSteps?.closing || [],
    },
    assessmentPlan: {
      initial: aiDraft.assessmentPlan?.initial || [],
      formative: aiDraft.assessmentPlan?.formative || [],
      summative: aiDraft.assessmentPlan?.summative || [],
    },
    resources: aiDraft.resources || [],
    differentiation: aiDraft.differentiation,
    meaningfulUnderstanding: aiDraft.meaningfulUnderstanding,
    triggerQuestions: aiDraft.triggerQuestions,
    reflection: aiDraft.reflection,
    enrichmentPlan: aiDraft.enrichmentPlan,
    remedialPlan: aiDraft.remedialPlan,
    initialCompetency: aiDraft.initialCompetency,
    targetStudents: aiDraft.targetStudents,
    learningModel: aiDraft.learningModel,
    p3Dimensions: aiDraft.p3Dimensions,
    allocatedJP: typeof aiDraft.allocatedJP === 'number' ? aiDraft.allocatedJP : undefined,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Confirms a LearningPlan as SIAP after rigorous validation.
 */
export function confirmLearningPlan(
  plan: LearningPlan,
  context: {
    academicSetting?: AcademicSetting | null;
    tp?: TPData | null;
    atp?: ATPData | null;
    k13Analysis?: K13Analysis | null;
    timeAllocations?: TimeAllocation[] | null;
    assessmentCriteria?: AssessmentCriterion[] | null;
  }
): { success: boolean; plan: LearningPlan; validation: LearningPlanValidationResult } {
  // First evaluate validation without the status check
  const candidatePlan: LearningPlan = {
    ...plan,
    status: 'SIAP',
    confirmedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const validation = validateLearningPlan(candidatePlan, context);

  if (!validation.valid) {
    return {
      success: false,
      plan: {
        ...plan,
        status: 'PERLU_DILENGKAPI',
        updatedAt: new Date().toISOString(),
      },
      validation,
    };
  }

  return {
    success: true,
    plan: candidatePlan,
    validation,
  };
}

/**
 * Determines whether a change to a LearningPlan is pedagogically substantive.
 * Substantive edits invalidate SIAP status and revert the plan to DRAFT.
 */
export function isSubstantiveLearningPlanChange(oldPlan: LearningPlan, newPlan: LearningPlan): boolean {
  if (JSON.stringify(oldPlan.tpIds || []) !== JSON.stringify(newPlan.tpIds || [])) return true;
  if (JSON.stringify(oldPlan.atpItemIds || []) !== JSON.stringify(newPlan.atpItemIds || [])) return true;
  if (JSON.stringify(oldPlan.kktpCriterionIds || []) !== JSON.stringify(newPlan.kktpCriterionIds || [])) return true;
  if ((oldPlan.title || '') !== (newPlan.title || '')) return true;
  if ((oldPlan.topic || '') !== (newPlan.topic || '')) return true;
  if (JSON.stringify(oldPlan.objectives || []) !== JSON.stringify(newPlan.objectives || [])) return true;
  if (JSON.stringify(oldPlan.learningExperiences || []) !== JSON.stringify(newPlan.learningExperiences || [])) return true;
  if (JSON.stringify(oldPlan.learningSteps || {}) !== JSON.stringify(newPlan.learningSteps || {})) return true;
  if (JSON.stringify(oldPlan.deepLearningContext || {}) !== JSON.stringify(newPlan.deepLearningContext || {})) return true;
  if (JSON.stringify(oldPlan.graduateProfileDimensions || []) !== JSON.stringify(newPlan.graduateProfileDimensions || [])) return true;
  if (JSON.stringify(oldPlan.assessmentPlan || {}) !== JSON.stringify(newPlan.assessmentPlan || {})) return true;
  if (JSON.stringify(oldPlan.resources || []) !== JSON.stringify(newPlan.resources || [])) return true;
  if (JSON.stringify(oldPlan.differentiation || {}) !== JSON.stringify(newPlan.differentiation || {})) return true;
  if ((oldPlan.meaningfulUnderstanding || '') !== (newPlan.meaningfulUnderstanding || '')) return true;
  if (JSON.stringify(oldPlan.triggerQuestions || []) !== JSON.stringify(newPlan.triggerQuestions || [])) return true;
  if (JSON.stringify(oldPlan.reflection || {}) !== JSON.stringify(newPlan.reflection || {})) return true;
  if ((oldPlan.enrichmentPlan || '') !== (newPlan.enrichmentPlan || '')) return true;
  if ((oldPlan.remedialPlan || '') !== (newPlan.remedialPlan || '')) return true;
  if (oldPlan.allocatedJP !== newPlan.allocatedJP) return true;
  return false;
}

/**
 * Automatically invalidates SIAP status if underlying dependencies (TP/ATP) were deleted or changed.
 */
export function invalidatePlanIfDependenciesChanged(
  plan: LearningPlan,
  context: {
    academicSetting?: AcademicSetting | null;
    tp?: TPData | null;
    atp?: ATPData | null;
    k13Analysis?: K13Analysis | null;
  }
): { plan: LearningPlan; isInvalidated: boolean; reason?: string } {
  if (plan.status !== 'SIAP') {
    return { plan, isInvalidated: false };
  }

  const validation = validateLearningPlan(plan, context);
  if (!validation.valid) {
    return {
      plan: {
        ...plan,
        status: 'PERLU_DILENGKAPI',
        updatedAt: new Date().toISOString(),
      },
      isInvalidated: true,
      reason: `Status diturunkan ke PERLU_DILENGKAPI karena dependency berubah:\n${validation.errors.join('\n')}`,
    };
  }

  return { plan, isInvalidated: false };
}

/**
 * Migrates legacy learning plans without fabricating non-existent pedagogical facts.
 */
export function migrateLegacyLearningPlan(
  legacy: any,
  academicSettingId: string,
  curriculumType: CurriculumType = 'KURIKULUM_MERDEKA'
): LearningPlan {
  const now = new Date().toISOString();
  const rawId = legacy?.id || `lp-migrated-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

  // Parse objectives safely
  const objectives: LearningPlan['objectives'] = [];
  if (Array.isArray(legacy?.objectives)) {
    for (let i = 0; i < legacy.objectives.length; i++) {
      const obj = legacy.objectives[i];
      if (typeof obj === 'string') {
        objectives.push({
          id: `obj-${i + 1}`,
          statement: obj,
        });
      } else if (obj && typeof obj === 'object') {
        objectives.push({
          id: obj.id || `obj-${i + 1}`,
          tpId: obj.tpId,
          code: obj.code,
          statement: obj.statement || obj.description || '',
          materialScope: obj.materialScope || obj.contentScope,
        });
      }
    }
  }

  // Parse steps safely
  const opening: LearningPlan['learningSteps']['opening'] = [];
  const core: LearningPlan['learningSteps']['core'] = [];
  const closing: LearningPlan['learningSteps']['closing'] = [];

  if (Array.isArray(legacy?.learningSteps)) {
    for (let i = 0; i < legacy.learningSteps.length; i++) {
      const s = legacy.learningSteps[i];
      const stepItem = {
        id: s.id || `step-${i + 1}`,
        stepName: s.stepName || 'Kegiatan Inti',
        description: s.description || '',
        durationMinutes: typeof s.durationMinutes === 'number' ? s.durationMinutes : undefined,
      };
      const nameLower = (s.stepName || '').toLowerCase();
      if (nameLower.includes('awal') || nameLower.includes('pendahuluan')) {
        opening.push(stepItem);
      } else if (nameLower.includes('tutup') || nameLower.includes('penutup') || nameLower.includes('akhir')) {
        closing.push(stepItem);
      } else {
        core.push(stepItem);
      }
    }
  } else if (legacy?.learningSteps && typeof legacy.learningSteps === 'object') {
    if (Array.isArray(legacy.learningSteps.opening)) opening.push(...legacy.learningSteps.opening);
    if (Array.isArray(legacy.learningSteps.core)) core.push(...legacy.learningSteps.core);
    if (Array.isArray(legacy.learningSteps.closing)) closing.push(...legacy.learningSteps.closing);
  }

  // Parse assessments safely
  const initialAssessments: LearningPlan['assessmentPlan']['initial'] = [];
  const formativeAssessments: LearningPlan['assessmentPlan']['formative'] = [];
  const summativeAssessments: LearningPlan['assessmentPlan']['summative'] = [];

  if (Array.isArray(legacy?.assessmentPlan)) {
    for (let i = 0; i < legacy.assessmentPlan.length; i++) {
      const a = legacy.assessmentPlan[i];
      const item = {
        id: a.id || `asm-${i + 1}`,
        type: ((a.type || 'FORMATIVE').toUpperCase() as 'INITIAL' | 'FORMATIVE' | 'SUMMATIVE'),
        technique: a.technique,
        instrument: a.instrument,
        linkedTpIds: Array.isArray(a.linkedTpIds) ? a.linkedTpIds : [],
        description: a.description || a.instrument || a.technique,
      };
      if (item.type === 'INITIAL') initialAssessments.push(item);
      else if (item.type === 'SUMMATIVE') summativeAssessments.push(item);
      else formativeAssessments.push(item);
    }
  } else if (legacy?.assessmentPlan && typeof legacy.assessmentPlan === 'object') {
    if (Array.isArray(legacy.assessmentPlan.initial)) initialAssessments.push(...legacy.assessmentPlan.initial);
    if (Array.isArray(legacy.assessmentPlan.formative)) formativeAssessments.push(...legacy.assessmentPlan.formative);
    if (Array.isArray(legacy.assessmentPlan.summative)) summativeAssessments.push(...legacy.assessmentPlan.summative);
  }

  return {
    id: rawId,
    academicSettingId: legacy?.academicSettingId || academicSettingId,
    curriculumType: legacy?.curriculumType || curriculumType,
    sourceType: 'MIGRATED',
    status: 'DRAFT', // Migrated plans always require teacher review
    tpIds: Array.isArray(legacy?.tpIds) ? legacy.tpIds : [],
    atpItemIds: Array.isArray(legacy?.atpItemIds) ? legacy.atpItemIds : [],
    kktpCriterionIds: Array.isArray(legacy?.kktpCriterionIds) ? legacy.kktpCriterionIds : [],
    timeAllocationIds: Array.isArray(legacy?.timeAllocationIds) ? legacy.timeAllocationIds : [],
    title: legacy?.title || '',
    topic: legacy?.topic || '',
    objectives,
    learningSteps: {
      opening,
      core,
      closing,
    },
    learningExperiences: Array.isArray(legacy?.learningExperiences)
      ? legacy.learningExperiences.map((exp: any, idx: number) => ({
          id: exp.id || `exp-${idx + 1}`,
          phase: exp.phase,
          description: exp.description || '',
          linkedTpIds: Array.isArray(exp.linkedTpIds) ? exp.linkedTpIds : undefined,
          durationMinutes:
            typeof exp.durationMinutes === 'number' &&
            Number.isFinite(exp.durationMinutes) &&
            !isNaN(exp.durationMinutes) &&
            exp.durationMinutes > 0
              ? exp.durationMinutes
              : undefined,
        }))
      : undefined,
    deepLearningContext: legacy?.deepLearningContext,
    graduateProfileDimensions: Array.isArray(legacy?.graduateProfileDimensions) ? legacy.graduateProfileDimensions : undefined,
    assessmentPlan: {
      initial: initialAssessments,
      formative: formativeAssessments,
      summative: summativeAssessments,
    },
    resources: Array.isArray(legacy?.resources) ? legacy.resources.map((r: any, idx: number) => (typeof r === 'string' ? { id: `res-${idx + 1}`, title: r } : r)) : [],
    differentiation: legacy?.differentiation,
    meaningfulUnderstanding: legacy?.meaningfulUnderstanding,
    triggerQuestions: Array.isArray(legacy?.triggerQuestions) ? legacy.triggerQuestions : [],
    reflection: legacy?.reflection,
    enrichmentPlan: legacy?.enrichmentPlan,
    remedialPlan: legacy?.remedialPlan,
    initialCompetency: legacy?.initialCompetency,
    targetStudents: legacy?.targetStudents,
    learningModel: legacy?.learningModel,
    p3Dimensions: Array.isArray(legacy?.p3Dimensions) ? legacy.p3Dimensions : [],
    allocatedJP: typeof legacy?.allocatedJP === 'number' ? legacy.allocatedJP : undefined,
    createdAt: legacy?.createdAt || now,
    updatedAt: now,
  };
}
