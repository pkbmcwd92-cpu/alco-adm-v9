import {
  AssessmentPackage,
  AssessmentPlan,
  AssessmentBlueprintItem,
  AssessmentInstrument,
  AssessmentAnswerKey,
  AssessmentScoringGuide,
  AssessmentRubric,
  AcademicSetting,
  TPData,
  K13Analysis,
  AssessmentCriterion,
  WrittenAssessmentInstrument,
  WrittenAssessmentOption,
  WrittenAssessmentItem,
  MatchingAssessmentEntry,
  MatchingAssessmentPair,
  CategoryResponseStatement,
  CategoryResponseCategory,
  CognitiveDemand,
  AssessmentEvidenceType,
  AssessmentStimulusType,
  AssessmentDifficultyTarget,
  ShortAnswerResponseMode,
  OralAssessmentInstrument,
  PerformanceAssessmentInstrument,
  ObservationAssessmentInstrument,
  AssignmentAssessmentInstrument,
  ProjectAssessmentInstrument,
  ProductAssessmentInstrument,
  PortfolioAssessmentInstrument,
  SelfPeerAssessmentInstrument,
} from '../types';
import { isK13, isMerdeka } from './curriculumRouter';

export interface AssessmentPackageValidationContext {
  academicSetting?: AcademicSetting;
  assessmentPlan?: AssessmentPlan;
  tp?: TPData;
  k13Analysis?: K13Analysis;
  assessmentCriteria?: AssessmentCriterion[];
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function createEmptyAssessmentPackage(
  plan: AssessmentPlan,
  academicSettingId: string,
  workspaceId?: string
): AssessmentPackage {
  const now = new Date().toISOString();
  return {
    id: `pkg-${plan.id}`,
    assessmentPlanId: plan.id,
    academicSettingId,
    workspaceId: workspaceId || plan.workspaceId,
    title: plan.displayLabel || plan.title || 'Perangkat Asesmen',
    blueprintItems: [],
    instruments: [],
    answerKeys: [],
    scoringGuides: [],
    rubrics: [],
    workflowStatus: 'DRAFT',
    needsReview: false,
    revision: 1,
    provenance: {
      generatedBy: 'USER',
      generatedAt: now,
    },
    createdAt: now,
    updatedAt: now,
  };
}

function getExplicitCurriculumType(setting?: AcademicSetting | null): 'KURIKULUM_MERDEKA' | 'K13' | 'UNRESOLVED' {
  if (!setting) return 'UNRESOLVED';
  if (setting.curriculumType === 'K13') return 'K13';
  if (setting.curriculumType === 'KURIKULUM_MERDEKA') return 'KURIKULUM_MERDEKA';
  if (!setting.curriculum || setting.curriculum.trim() === '') return 'UNRESOLVED';
  const cur = setting.curriculum.toLowerCase();
  if (cur.includes('2013') || cur.includes('k13')) return 'K13';
  if (cur.includes('merdeka')) return 'KURIKULUM_MERDEKA';
  return 'UNRESOLVED';
}

export function validateAssessmentPackage(
  pkg: AssessmentPackage,
  context: AssessmentPackageValidationContext
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Title Check
  if (!pkg.title || pkg.title.trim() === '') {
    errors.push('Judul Perangkat Asesmen wajib diisi.');
  }

  // 2. Parent AssessmentPlan Verification
  if (!pkg.assessmentPlanId) {
    errors.push('Perangkat Asesmen tidak terhubung dengan Rencana Asesmen (assessmentPlanId kosong).');
  } else if (!context.assessmentPlan || context.assessmentPlan.id !== pkg.assessmentPlanId) {
    errors.push('Parent AssessmentPlan tidak ditemukan atau referensi ID tidak valid.');
  } else {
    const parentPlan = context.assessmentPlan;
    if (parentPlan.workflowStatus !== 'SIAP') {
      errors.push(`Rencana Asesmen induk "${parentPlan.title}" belum berstatus SIAP.`);
    }
    if (parentPlan.needsReview) {
      errors.push(`Rencana Asesmen induk "${parentPlan.title}" masih memerlukan peninjauan ulang.`);
    }

    // Instrument Type Coherence with Parent Plan
    const planInstrumentTypes = new Set((parentPlan.instruments || []).map((i) => i.type));
    pkg.instruments.forEach((inst) => {
      if (!planInstrumentTypes.has(inst.type)) {
        errors.push(
          `Tipe instrumen "${inst.type}" pada Perangkat Asesmen tidak terdaftar pada Rencana Asesmen induk.`
        );
      }
    });

    // Verify all selected instruments in plan have a corresponding package instrument
    planInstrumentTypes.forEach((reqType) => {
      const existsInPkg = pkg.instruments.some((i) => i.type === reqType);
      if (!existsInPkg) {
        errors.push(`Instrumen tipe "${reqType}" yang direncanakan pada Rencana Asesmen belum dibuat.`);
      }
    });
  }

  // 3. Objective Source Verification for Blueprint (Kisi-Kisi) - Mandatory & Fail-Closed
  if (!pkg.blueprintItems || pkg.blueprintItems.length === 0) {
    errors.push('Kisi-kisi asesmen (blueprint) wajib diisi. Perangkat Asesmen tanpa kisi-kisi tidak dapat berstatus SIAP.');
  } else {
    const curType = getExplicitCurriculumType(context.academicSetting);

    if (curType === 'UNRESOLVED') {
      errors.push('Kurikulum tidak dapat ditentukan atau tidak didukung (curriculum unresolved).');
    } else if (curType === 'KURIKULUM_MERDEKA') {
      if (!context.tp || !context.tp.items) {
        errors.push('Sumber data TP (TPData) tidak tersedia atau tidak dapat diverifikasi.');
      } else if (context.tp.workflowStatus !== 'SIAP' || context.tp.needsReview) {
        errors.push('Sumber data TP belum SIAP atau masih memerlukan peninjauan ulang.');
      } else {
        const validObjectiveIds = new Set(context.tp.items.map((t) => t.id));
        pkg.blueprintItems.forEach((bp, idx) => {
          if (!bp.objectiveRefId) {
            errors.push(`Butir kisi-kisi #${idx + 1} tidak memiliki referensi Tujuan Pembelajaran (TP).`);
          } else if (!validObjectiveIds.has(bp.objectiveRefId)) {
            errors.push(
              `Butir kisi-kisi #${idx + 1} merujuk pada TP ID [${bp.objectiveRefId}] yang tidak valid atau tidak ditemukan.`
            );
          }
        });
      }
    } else if (curType === 'K13') {
      if (!context.k13Analysis || !context.k13Analysis.items) {
        errors.push('Sumber data KD/K13Analysis tidak tersedia atau tidak dapat diverifikasi.');
      } else {
        const validObjectiveIds = new Set(context.k13Analysis.items.map((k) => k.id));
        pkg.blueprintItems.forEach((bp, idx) => {
          if (!bp.objectiveRefId) {
            errors.push(`Butir kisi-kisi #${idx + 1} tidak memiliki referensi Kompetensi Dasar (KD).`);
          } else if (!validObjectiveIds.has(bp.objectiveRefId)) {
            errors.push(
              `Butir kisi-kisi #${idx + 1} merujuk pada KD ID [${bp.objectiveRefId}] yang tidak valid atau tidak ditemukan.`
            );
          }
        });
      }
    }

    // Blueprint -> Instrument Item Linkage Mapping
    const itemToInstrumentType = new Map<string, string>();
    const packageInstrumentTypes = new Set<string>();

    pkg.instruments.forEach((inst) => {
      packageInstrumentTypes.add(inst.type);
      switch (inst.type) {
        case 'WRITTEN_TEST':
          (inst as WrittenAssessmentInstrument).items?.forEach((it) => {
            itemToInstrumentType.set(it.id, 'WRITTEN_TEST');
          });
          break;
        case 'ORAL_TEST':
          (inst as OralAssessmentInstrument).items?.forEach((it) => {
            itemToInstrumentType.set(it.id, 'ORAL_TEST');
          });
          break;
        case 'PERFORMANCE':
          (inst as PerformanceAssessmentInstrument).aspects?.forEach((asp) => {
            itemToInstrumentType.set(asp.id, 'PERFORMANCE');
          });
          break;
        case 'OBSERVATION':
          (inst as ObservationAssessmentInstrument).aspects?.forEach((asp) => {
            itemToInstrumentType.set(asp.id, 'OBSERVATION');
          });
          break;
        case 'SELF_ASSESSMENT':
        case 'PEER_ASSESSMENT':
          (inst as SelfPeerAssessmentInstrument).items?.forEach((it) => {
            itemToInstrumentType.set(it.id, inst.type);
          });
          break;
        default:
          itemToInstrumentType.set(inst.id, inst.type);
          break;
      }
    });

    pkg.blueprintItems.forEach((bp, idx) => {
      // Instrument type check
      if (!bp.instrumentType) {
        errors.push(`Butir kisi-kisi #${idx + 1} belum menentukan bentuk instrumen (instrumentType kosong).`);
      } else if (!packageInstrumentTypes.has(bp.instrumentType)) {
        errors.push(
          `Bentuk instrumen "${bp.instrumentType}" pada kisi-kisi #${idx + 1} tidak ditemukan pada instrumen Perangkat Asesmen.`
        );
      }

      // instrumentItemIds check
      if (bp.instrumentItemIds && bp.instrumentItemIds.length > 0) {
        bp.instrumentItemIds.forEach((itemId) => {
          const foundType = itemToInstrumentType.get(itemId);
          if (!foundType) {
            errors.push(
              `Butir kisi-kisi #${idx + 1} merujuk pada instrumentItemId [${itemId}] yang tidak ditemukan (dangling reference).`
            );
          } else if (bp.instrumentType && foundType !== bp.instrumentType) {
            errors.push(
              `Butir kisi-kisi #${idx + 1} (${bp.instrumentType}) merujuk pada instrumentItemId [${itemId}] yang bertipe "${foundType}" (cross-instrument-type reference).`
            );
          }
        });
      }

      // Criterion ID check
      if (bp.criterionId) {
        if (!context.assessmentCriteria) {
          errors.push(
            `Butir kisi-kisi #${idx + 1} menggunakan criterionId [${bp.criterionId}], tetapi sumber kriteria KKTP tidak tersedia.`
          );
        } else {
          const criterion = context.assessmentCriteria.find((c) => c.id === bp.criterionId);
          if (!criterion) {
            errors.push(`Butir kisi-kisi #${idx + 1} merujuk pada kriteria KKTP [${bp.criterionId}] yang tidak ditemukan.`);
          } else if (criterion.workflowStatus !== 'SIAP' || criterion.needsReview) {
            errors.push(`Butir kisi-kisi #${idx + 1} merujuk pada kriteria KKTP [${bp.criterionId}] yang belum SIAP atau perlu ditinjau ulang.`);
          }
        }
      }

      // Audit 9C.1 Optional Blueprint Metadata Range & Deterministic Checks
      if (bp.recommendedItemCount !== undefined) {
        if (
          typeof bp.recommendedItemCount !== 'number' ||
          !Number.isFinite(bp.recommendedItemCount) ||
          !Number.isInteger(bp.recommendedItemCount) ||
          bp.recommendedItemCount < 0
        ) {
          errors.push(
            `Butir kisi-kisi #${idx + 1} memiliki recommendedItemCount tidak valid [${bp.recommendedItemCount}] (harus bilangan bulat/integer >= 0).`
          );
        }
      }
      if (bp.estimatedMinutes !== undefined) {
        if (
          typeof bp.estimatedMinutes !== 'number' ||
          !Number.isFinite(bp.estimatedMinutes) ||
          bp.estimatedMinutes < 0
        ) {
          errors.push(
            `Butir kisi-kisi #${idx + 1} memiliki estimatedMinutes tidak valid [${bp.estimatedMinutes}] (harus angka finite >= 0).`
          );
        }
      }

      if (!bp.assessmentIndicator || bp.assessmentIndicator.trim() === '') {
        warnings.push(`Indikator asesmen pada butir kisi-kisi #${idx + 1} belum diisi.`);
      }
    });
  }

  // 4. Instrument-Specific Validation
  const validRubricIds = new Set((pkg.rubrics || []).map((r) => r.id));
  const validScoringGuideIds = new Set((pkg.scoringGuides || []).map((sg) => sg.id));

  pkg.instruments.forEach((inst) => {
    // Rubric and Scoring Guide reference integrity on all instruments
    const instWithRefs = inst as { id: string; type: string; rubricId?: string; scoringGuideId?: string };
    if (instWithRefs.rubricId) {
      if (!validRubricIds.has(instWithRefs.rubricId)) {
        errors.push(
          `Instrumen "${inst.type}" (ID: ${inst.id}) merujuk pada rubricId [${instWithRefs.rubricId}] yang tidak ditemukan (dangling rubric reference).`
        );
      }
    }
    if (instWithRefs.scoringGuideId) {
      if (!validScoringGuideIds.has(instWithRefs.scoringGuideId)) {
        errors.push(
          `Instrumen "${inst.type}" (ID: ${inst.id}) merujuk pada scoringGuideId [${instWithRefs.scoringGuideId}] yang tidak ditemukan (dangling scoring guide reference).`
        );
      }
    }

    switch (inst.type) {
      case 'WRITTEN_TEST': {
        const written = inst as WrittenAssessmentInstrument;
        if (!written.items || written.items.length === 0) {
          errors.push('Tes Tertulis wajib memiliki minimal 1 butir soal.');
        } else {
          written.items.forEach((item, itemIdx) => {
            if (!item.itemType || (item.itemType as string) === '') {
              errors.push(`Soal tertulis #${itemIdx + 1} belum menentukan jenis soal (itemType unresolved).`);
            }
            if (!item.prompt || item.prompt.trim() === '') {
              errors.push(`Soal tertulis #${itemIdx + 1} belum memiliki teks pertanyaan (prompt).`);
            }
            if (item.itemType === 'MULTIPLE_CHOICE' || item.itemType === 'MULTIPLE_SELECT') {
              if (!item.options || item.options.length < 2) {
                errors.push(`Soal pilihan ganda #${itemIdx + 1} wajib memiliki minimal 2 opsi jawaban.`);
              } else {
                const seenOptIds = new Map<string, number>();
                item.options.forEach((opt, optIdx) => {
                  if (opt.id) {
                    if (seenOptIds.has(opt.id)) {
                      errors.push(
                        `Soal pilihan ganda #${itemIdx + 1} memiliki ID opsi duplikat [${opt.id}] pada opsi #${optIdx + 1} (sama dengan opsi #${seenOptIds.get(opt.id)}).`
                      );
                    }
                    seenOptIds.set(opt.id, optIdx + 1);
                  }
                });

                const hasCorrect = item.options.some((opt) => opt.isCorrect);
                const hasAnswerKey = pkg.answerKeys.some(
                  (ak) => ak.instrumentItemId === item.id && (ak.value || (ak.optionIds && ak.optionIds.length > 0))
                );
                if (!hasCorrect && !hasAnswerKey) {
                  errors.push(`Soal pilihan ganda #${itemIdx + 1} belum menentukan kunci/opsi jawaban yang benar.`);
                }
              }
            } else if (item.itemType === 'MATCHING') {
              const premises = item.matchingPremises || [];
              const responses = item.matchingResponses || [];

              if (premises.length === 0) {
                errors.push(`Soal menjodohkan (Matching) #${itemIdx + 1} wajib memiliki minimal 1 premis / pernyataan asal.`);
              } else {
                const seenPremiseIds = new Map<string, number>();
                premises.forEach((p, pIdx) => {
                  if (!p.id || !p.text || p.text.trim() === '') {
                    errors.push(`Premis #${pIdx + 1} pada soal menjodohkan #${itemIdx + 1} belum memiliki teks premis.`);
                  }
                  if (p.id) {
                    if (seenPremiseIds.has(p.id)) {
                      errors.push(
                        `Soal menjodohkan #${itemIdx + 1} memiliki ID premis duplikat [${p.id}] pada premis #${pIdx + 1} (sama dengan premis #${seenPremiseIds.get(p.id)}).`
                      );
                    }
                    seenPremiseIds.set(p.id, pIdx + 1);
                  }
                });
              }

              if (responses.length === 0) {
                errors.push(`Soal menjodohkan (Matching) #${itemIdx + 1} wajib memiliki minimal 1 respon / opsi pasangan.`);
              } else {
                const seenResponseIds = new Map<string, number>();
                responses.forEach((r, rIdx) => {
                  if (!r.id || !r.text || r.text.trim() === '') {
                    errors.push(`Respon #${rIdx + 1} pada soal menjodohkan #${itemIdx + 1} belum memiliki teks respon.`);
                  }
                  if (r.id) {
                    if (seenResponseIds.has(r.id)) {
                      errors.push(
                        `Soal menjodohkan #${itemIdx + 1} memiliki ID respon duplikat [${r.id}] pada respon #${rIdx + 1} (sama dengan respon #${seenResponseIds.get(r.id)}).`
                      );
                    }
                    seenResponseIds.set(r.id, rIdx + 1);
                  }
                });
              }

              // Canonical Answer Key check: Must exist in AssessmentAnswerKey
              const akPairKey = pkg.answerKeys.find(
                (ak) => ak.instrumentItemId === item.id && ak.answerType === 'MATCHING'
              );

              if (!akPairKey || !akPairKey.matchingPairs || akPairKey.matchingPairs.length === 0) {
                errors.push(
                  `Soal menjodohkan (Matching) #${itemIdx + 1} wajib memiliki pasangan kunci jawaban (matchingPairs) pada AssessmentAnswerKey.`
                );
              } else {
                const premiseIdSet = new Set(premises.map((p) => p.id));
                const responseIdSet = new Set(responses.map((r) => r.id));
                const seenPairedPremises = new Map<string, number>();

                akPairKey.matchingPairs.forEach((pair, pairIdx) => {
                  if (!pair.premiseId || !premiseIdSet.has(pair.premiseId)) {
                    errors.push(
                      `Pasangan #${pairIdx + 1} pada soal menjodohkan #${itemIdx + 1} merujuk pada premiseId [${pair.premiseId}] yang tidak ditemukan (dangling premise reference).`
                    );
                  } else {
                    if (seenPairedPremises.has(pair.premiseId)) {
                      errors.push(
                        `Kunci jawaban soal menjodohkan #${itemIdx + 1} memiliki duplikat pemasangan untuk premis ID [${pair.premiseId}] pada pasangan #${pairIdx + 1} (sama dengan pasangan #${seenPairedPremises.get(pair.premiseId)}).`
                      );
                    }
                    seenPairedPremises.set(pair.premiseId, pairIdx + 1);
                  }

                  if (!pair.responseId || !responseIdSet.has(pair.responseId)) {
                    errors.push(
                      `Pasangan #${pairIdx + 1} pada soal menjodohkan #${itemIdx + 1} merujuk pada responseId [${pair.responseId}] yang tidak ditemukan (dangling response reference).`
                    );
                  }
                });

                // Legacy backward compatibility check: validate legacy matchingPairs if present
                if (item.matchingPairs && item.matchingPairs.length > 0) {
                  item.matchingPairs.forEach((pair, pairIdx) => {
                    if (pair.premiseId && !premiseIdSet.has(pair.premiseId)) {
                      errors.push(
                        `Pasangan #${pairIdx + 1} pada soal menjodohkan #${itemIdx + 1} merujuk pada premiseId [${pair.premiseId}] yang tidak ditemukan (dangling premise reference).`
                      );
                    }
                    if (pair.responseId && !responseIdSet.has(pair.responseId)) {
                      errors.push(
                        `Pasangan #${pairIdx + 1} pada soal menjodohkan #${itemIdx + 1} merujuk pada responseId [${pair.responseId}] yang tidak ditemukan (dangling response reference).`
                      );
                    }
                  });

                  // Fail-closed against conflicting dual answer sources (legacy item.matchingPairs vs AssessmentAnswerKey)
                  const akMap = new Map(akPairKey.matchingPairs.map((p) => [p.premiseId, p.responseId]));
                  const isConflicting =
                    item.matchingPairs.length !== akPairKey.matchingPairs.length ||
                    item.matchingPairs.some((ip) => akMap.get(ip.premiseId) !== ip.responseId);
                  if (isConflicting) {
                    errors.push(
                      `Soal menjodohkan #${itemIdx + 1} terdeteksi memiliki dual answer source yang saling bertentangan antara butir soal (legacy matchingPairs) dan AssessmentAnswerKey.`
                    );
                  }
                }
              }
            } else if (item.itemType === 'CATEGORY_RESPONSE') {
              const categories = item.categoryResponseCategories || [];
              const statements = item.categoryResponseStatements || [];

              if (categories.length < 2) {
                errors.push(
                  `Soal kategori (Category Response) #${itemIdx + 1} wajib memiliki minimal 2 pilihan kategori (misal: Benar/Salah, Sesuai/Tidak Sesuai).`
                );
              } else {
                const seenCatIds = new Map<string, number>();
                categories.forEach((cat, catIdx) => {
                  if (!cat.id || !cat.label || cat.label.trim() === '') {
                    errors.push(`Kategori #${catIdx + 1} pada soal kategori #${itemIdx + 1} belum memiliki label.`);
                  }
                  if (cat.id) {
                    if (seenCatIds.has(cat.id)) {
                      errors.push(
                        `Soal kategori #${itemIdx + 1} memiliki ID kategori duplikat [${cat.id}] pada kategori #${catIdx + 1} (sama dengan kategori #${seenCatIds.get(cat.id)}).`
                      );
                    }
                    seenCatIds.set(cat.id, catIdx + 1);
                  }
                });
              }

              const catIdSet = new Set(categories.map((c) => c.id));

              if (statements.length === 0) {
                errors.push(
                  `Soal kategori (Category Response) #${itemIdx + 1} wajib memiliki minimal 1 butir pernyataan (statement).`
                );
              } else {
                const seenStmtIds = new Map<string, number>();
                statements.forEach((stmt, stmtIdx) => {
                  if (!stmt.id || !stmt.text || stmt.text.trim() === '') {
                    errors.push(`Pernyataan #${stmtIdx + 1} pada soal kategori #${itemIdx + 1} belum memiliki teks pernyataan.`);
                  }
                  if (stmt.id) {
                    if (seenStmtIds.has(stmt.id)) {
                      errors.push(
                        `Soal kategori #${itemIdx + 1} memiliki ID pernyataan duplikat [${stmt.id}] pada pernyataan #${stmtIdx + 1} (sama dengan pernyataan #${seenStmtIds.get(stmt.id)}).`
                      );
                    }
                    seenStmtIds.set(stmt.id, stmtIdx + 1);
                  }
                  // Legacy backward compatibility check: validate correctCategoryId if present
                  if (stmt.correctCategoryId !== undefined) {
                    if (stmt.correctCategoryId.trim() === '') {
                      errors.push(`Pernyataan #${stmtIdx + 1} pada soal kategori #${itemIdx + 1} belum menentukan kategori jawaban.`);
                    } else if (catIdSet.size > 0 && !catIdSet.has(stmt.correctCategoryId)) {
                      errors.push(
                        `Pernyataan #${stmtIdx + 1} pada soal kategori #${itemIdx + 1} merujuk pada categoryId [${stmt.correctCategoryId}] yang tidak ditemukan (dangling category reference).`
                      );
                    }
                  }
                });
              }

              // Canonical Answer Key check: Must exist in AssessmentAnswerKey
              const akCatKey = pkg.answerKeys.find(
                (ak) => ak.instrumentItemId === item.id && ak.answerType === 'CATEGORY_RESPONSE'
              );

              if (!akCatKey || !akCatKey.categoryAnswers || akCatKey.categoryAnswers.length === 0) {
                errors.push(
                  `Soal kategori (Category Response) #${itemIdx + 1} wajib memiliki kunci jawaban (categoryAnswers) pada AssessmentAnswerKey.`
                );
              } else {
                const akCatMap = new Map<string, string>();
                const seenStmtAnswers = new Map<string, number>();

                akCatKey.categoryAnswers.forEach((ca, caIdx) => {
                  if (ca.statementId) {
                    if (seenStmtAnswers.has(ca.statementId)) {
                      errors.push(
                        `Kunci jawaban soal kategori #${itemIdx + 1} memiliki duplikat penugasan kategori untuk pernyataan ID [${ca.statementId}] pada entri #${caIdx + 1} (sama dengan entri #${seenStmtAnswers.get(ca.statementId)}).`
                      );
                    }
                    seenStmtAnswers.set(ca.statementId, caIdx + 1);
                  }
                  akCatMap.set(ca.statementId, ca.categoryId);
                });

                statements.forEach((stmt, stmtIdx) => {
                  const assignedCatId = akCatMap.get(stmt.id);
                  if (!assignedCatId) {
                    errors.push(
                      `Pernyataan #${stmtIdx + 1} pada soal kategori #${itemIdx + 1} belum memiliki kunci jawaban pada AssessmentAnswerKey.`
                    );
                  } else if (!catIdSet.has(assignedCatId)) {
                    errors.push(
                      `Pernyataan #${stmtIdx + 1} pada soal kategori #${itemIdx + 1} merujuk pada categoryId [${assignedCatId}] yang tidak ditemukan (dangling category reference).`
                    );
                  }

                  // Fail-closed against conflicting dual answer sources (legacy stmt.correctCategoryId vs AssessmentAnswerKey)
                  if (stmt.correctCategoryId && assignedCatId && stmt.correctCategoryId !== assignedCatId) {
                    errors.push(
                      `Pernyataan #${stmtIdx + 1} pada soal kategori #${itemIdx + 1} terdeteksi memiliki dual answer source yang saling bertentangan antara butir soal (legacy correctCategoryId: ${stmt.correctCategoryId}) dan AssessmentAnswerKey (${assignedCatId}).`
                    );
                  }
                });
              }
            } else if (item.itemType === 'SHORT_ANSWER') {
              if (item.responseMode && item.responseMode !== 'SHORT_RESPONSE' && item.responseMode !== 'COMPLETION') {
                errors.push(`Soal isian singkat #${itemIdx + 1} memiliki responseMode tidak valid [${item.responseMode}].`);
              }
            }
          });
        }
        break;
      }
      case 'ORAL_TEST': {
        const oral = inst as OralAssessmentInstrument;
        if (!oral.items || oral.items.length === 0) {
          errors.push('Tes Lisan wajib memiliki minimal 1 pertanyaan lisan.');
        } else {
          oral.items.forEach((item, itemIdx) => {
            if (!item.prompt || item.prompt.trim() === '') {
              errors.push(`Pertanyaan tes lisan #${itemIdx + 1} belum memiliki teks pertanyaan.`);
            }
          });
        }
        break;
      }
      case 'PERFORMANCE': {
        const perf = inst as PerformanceAssessmentInstrument;
        if (!perf.task || perf.task.trim() === '') {
          errors.push('Asesmen Performa/Praktik wajib memiliki instruksi/tugas yang jelas.');
        }
        const hasRubric = perf.rubricId && pkg.rubrics.some((r) => r.id === perf.rubricId);
        const hasScoringGuide = perf.scoringGuideId && pkg.scoringGuides.some((sg) => sg.id === perf.scoringGuideId);
        const hasAspects = perf.aspects && perf.aspects.length > 0;
        if (!hasRubric && !hasScoringGuide && !hasAspects) {
          errors.push('Asesmen Performa/Praktik wajib dilengkapi rubrik, pedoman penskoran, atau aspek penilaian.');
        }
        break;
      }
      case 'OBSERVATION': {
        const obs = inst as ObservationAssessmentInstrument;
        if (!obs.aspects || obs.aspects.length === 0) {
          errors.push('Lembar Observasi wajib memiliki minimal 1 aspek pengamatan yang ditentukan guru.');
        } else {
          obs.aspects.forEach((asp, aspIdx) => {
            if (!asp.label || asp.label.trim() === '') {
              errors.push(`Aspek observasi #${aspIdx + 1} belum memiliki label aspek.`);
            }
          });
        }
        break;
      }
      case 'ASSIGNMENT': {
        const assign = inst as AssignmentAssessmentInstrument;
        if (!assign.instructions || assign.instructions.trim() === '') {
          errors.push('Penugasan wajib memiliki instruksi tugas.');
        }
        break;
      }
      case 'PROJECT': {
        const proj = inst as ProjectAssessmentInstrument;
        if (!proj.projectBrief || proj.projectBrief.trim() === '') {
          errors.push('Asesmen Proyek wajib memiliki brief/deskripsi proyek.');
        }
        break;
      }
      case 'PRODUCT': {
        const prod = inst as ProductAssessmentInstrument;
        if (!prod.productBrief || prod.productBrief.trim() === '') {
          errors.push('Asesmen Produk wajib memiliki brief/deskripsi produk.');
        }
        break;
      }
      case 'PORTFOLIO': {
        const port = inst as PortfolioAssessmentInstrument;
        if (!port.evidenceRequirements || port.evidenceRequirements.length === 0) {
          errors.push('Asesmen Portofolio wajib mencantumkan persyaratan bukti (evidence requirements).');
        }
        break;
      }
      case 'SELF_ASSESSMENT':
      case 'PEER_ASSESSMENT': {
        const selfPeer = inst as SelfPeerAssessmentInstrument;
        if (!selfPeer.items || selfPeer.items.length === 0) {
          errors.push(`Asesmen Diri/Sebaya (${inst.type}) wajib memiliki minimal 1 pernyataan penilaian.`);
        } else {
          selfPeer.items.forEach((item, itemIdx) => {
            if (!item.statement || item.statement.trim() === '') {
              errors.push(`Pernyataan asesmen #${itemIdx + 1} belum diisi.`);
            }
          });
        }
        break;
      }
    }
  });

  // 5. Answer Keys Referential Integrity (Fail Closed)
  const instrumentMap = new Map<string, AssessmentInstrument>();
  const allItemLookup = new Map<
    string,
    {
      instrumentId: string;
      instrumentType: string;
      options?: WrittenAssessmentOption[];
      matchingPremises?: MatchingAssessmentEntry[];
      matchingResponses?: MatchingAssessmentEntry[];
      categoryResponseStatements?: CategoryResponseStatement[];
      categoryResponseCategories?: CategoryResponseCategory[];
    }
  >();

  pkg.instruments.forEach((inst) => {
    instrumentMap.set(inst.id, inst);
    switch (inst.type) {
      case 'WRITTEN_TEST':
        (inst as WrittenAssessmentInstrument).items?.forEach((it) => {
          allItemLookup.set(it.id, {
            instrumentId: inst.id,
            instrumentType: 'WRITTEN_TEST',
            options: it.options,
            matchingPremises: it.matchingPremises,
            matchingResponses: it.matchingResponses,
            categoryResponseStatements: it.categoryResponseStatements,
            categoryResponseCategories: it.categoryResponseCategories,
          });
        });
        break;
      case 'ORAL_TEST':
        (inst as OralAssessmentInstrument).items?.forEach((it) => {
          allItemLookup.set(it.id, { instrumentId: inst.id, instrumentType: 'ORAL_TEST' });
        });
        break;
      case 'PERFORMANCE':
        (inst as PerformanceAssessmentInstrument).aspects?.forEach((asp) => {
          allItemLookup.set(asp.id, { instrumentId: inst.id, instrumentType: 'PERFORMANCE' });
        });
        break;
      case 'OBSERVATION':
        (inst as ObservationAssessmentInstrument).aspects?.forEach((asp) => {
          allItemLookup.set(asp.id, { instrumentId: inst.id, instrumentType: 'OBSERVATION' });
        });
        break;
      case 'SELF_ASSESSMENT':
      case 'PEER_ASSESSMENT':
        (inst as SelfPeerAssessmentInstrument).items?.forEach((it) => {
          allItemLookup.set(it.id, { instrumentId: inst.id, instrumentType: inst.type });
        });
        break;
      default:
        break;
    }
  });

  pkg.answerKeys.forEach((ak, akIdx) => {
    // 1. instrumentId must resolve to canonical instrument
    if (!ak.instrumentId || !instrumentMap.has(ak.instrumentId)) {
      errors.push(
        `Kunci jawaban #${akIdx + 1} merujuk pada instrumentId [${ak.instrumentId}] yang tidak ditemukan (dangling reference).`
      );
      return;
    }

    // 2. instrumentItemId must resolve to canonical item
    if (!ak.instrumentItemId) {
      errors.push(`Kunci jawaban #${akIdx + 1} tidak memiliki referensi butir instrumen (instrumentItemId kosong).`);
      return;
    }

    const itemMeta = allItemLookup.get(ak.instrumentItemId);
    if (!itemMeta) {
      errors.push(
        `Kunci jawaban #${akIdx + 1} merujuk pada instrumentItemId [${ak.instrumentItemId}] yang tidak ditemukan (dangling reference).`
      );
      return;
    }

    // 3. Item must actually belong to instrumentId
    if (itemMeta.instrumentId !== ak.instrumentId) {
      errors.push(
        `Kunci jawaban #${akIdx + 1} merujuk pada butir [${ak.instrumentItemId}] milik instrumen lain [${itemMeta.instrumentId}] (cross-instrument reference).`
      );
      return;
    }

    // 4. For OPTION / MULTIPLE_OPTION, optionIds check
    if (ak.answerType === 'OPTION' || ak.answerType === 'MULTIPLE_OPTION') {
      if (!itemMeta.options || itemMeta.options.length === 0) {
        errors.push(
          `Kunci jawaban #${akIdx + 1} bertipe pilihan opsi, tetapi butir instrumen tidak memiliki daftar opsi pilihan.`
        );
      } else if (!ak.optionIds || ak.optionIds.length === 0) {
        errors.push(`Kunci jawaban #${akIdx + 1} bertipe pilihan opsi tetapi tidak mencantumkan optionIds.`);
      } else {
        const validOptIds = new Set(itemMeta.options.map((o) => o.id));
        ak.optionIds.forEach((optId) => {
          if (!validOptIds.has(optId)) {
            errors.push(
              `Kunci jawaban #${akIdx + 1} merujuk pada opsi ID [${optId}] yang tidak ada pada pilihan butir soal.`
            );
          }
        });
      }
    } else if (ak.answerType === 'MATCHING') {
      if (!itemMeta.matchingPremises || itemMeta.matchingPremises.length === 0) {
        errors.push(`Kunci jawaban #${akIdx + 1} bertipe MATCHING, tetapi butir instrumen tidak memiliki daftar premis.`);
      } else if (!itemMeta.matchingResponses || itemMeta.matchingResponses.length === 0) {
        errors.push(`Kunci jawaban #${akIdx + 1} bertipe MATCHING, tetapi butir instrumen tidak memiliki daftar respon.`);
      } else if (!ak.matchingPairs || ak.matchingPairs.length === 0) {
        errors.push(`Kunci jawaban #${akIdx + 1} bertipe MATCHING tetapi tidak memiliki pasangan (matchingPairs kosong).`);
      } else {
        const premiseIdSet = new Set(itemMeta.matchingPremises.map((p) => p.id));
        const responseIdSet = new Set(itemMeta.matchingResponses.map((r) => r.id));
        const seenPairedPremiseIds = new Map<string, number>();
        ak.matchingPairs.forEach((pair, pairIdx) => {
          if (!pair.premiseId || !premiseIdSet.has(pair.premiseId)) {
            errors.push(
              `Kunci jawaban #${akIdx + 1} pasangan #${pairIdx + 1} merujuk pada premiseId [${pair.premiseId}] yang tidak ditemukan (dangling reference).`
            );
          } else {
            if (seenPairedPremiseIds.has(pair.premiseId)) {
              errors.push(
                `Kunci jawaban #${akIdx + 1} pasangan #${pairIdx + 1} memiliki duplikat pemasangan untuk premiseId [${pair.premiseId}] (sama dengan pasangan #${seenPairedPremiseIds.get(pair.premiseId)}).`
              );
            }
            seenPairedPremiseIds.set(pair.premiseId, pairIdx + 1);
          }
          if (!pair.responseId || !responseIdSet.has(pair.responseId)) {
            errors.push(
              `Kunci jawaban #${akIdx + 1} pasangan #${pairIdx + 1} merujuk pada responseId [${pair.responseId}] yang tidak ditemukan (dangling reference).`
            );
          }
        });
      }
    } else if (ak.answerType === 'CATEGORY_RESPONSE') {
      if (!itemMeta.categoryResponseCategories || itemMeta.categoryResponseCategories.length === 0) {
        errors.push(`Kunci jawaban #${akIdx + 1} bertipe CATEGORY_RESPONSE, tetapi butir instrumen tidak memiliki daftar kategori.`);
      } else if (!itemMeta.categoryResponseStatements || itemMeta.categoryResponseStatements.length === 0) {
        errors.push(`Kunci jawaban #${akIdx + 1} bertipe CATEGORY_RESPONSE, tetapi butir instrumen tidak memiliki daftar pernyataan.`);
      } else if (!ak.categoryAnswers || ak.categoryAnswers.length === 0) {
        errors.push(`Kunci jawaban #${akIdx + 1} bertipe CATEGORY_RESPONSE tetapi tidak memiliki jawaban kategori (categoryAnswers kosong).`);
      } else {
        const stmtIdSet = new Set(itemMeta.categoryResponseStatements.map((s) => s.id));
        const catIdSet = new Set(itemMeta.categoryResponseCategories.map((c) => c.id));
        const seenAnsweredStmtIds = new Map<string, number>();
        ak.categoryAnswers.forEach((ca, caIdx) => {
          if (!ca.statementId || !stmtIdSet.has(ca.statementId)) {
            errors.push(
              `Kunci jawaban #${akIdx + 1} item #${caIdx + 1} merujuk pada statementId [${ca.statementId}] yang tidak ditemukan (dangling reference).`
            );
          } else {
            if (seenAnsweredStmtIds.has(ca.statementId)) {
              errors.push(
                `Kunci jawaban #${akIdx + 1} item #${caIdx + 1} memiliki duplikat penugasan kategori untuk statementId [${ca.statementId}] (sama dengan entri #${seenAnsweredStmtIds.get(ca.statementId)}).`
              );
            }
            seenAnsweredStmtIds.set(ca.statementId, caIdx + 1);
          }
          if (!ca.categoryId || !catIdSet.has(ca.categoryId)) {
            errors.push(
              `Kunci jawaban #${akIdx + 1} item #${caIdx + 1} merujuk pada categoryId [${ca.categoryId}] yang tidak ditemukan (dangling reference).`
            );
          }
        });
      }
    }
  });

  // 6. Rubrics Structure Integrity (No default levels/descriptors fabricated if empty!)
  pkg.rubrics.forEach((rub, rubIdx) => {
    if (!rub.title || rub.title.trim() === '') {
      errors.push(`Rubrik #${rubIdx + 1} belum memiliki judul.`);
    }
    if (!rub.criteria || rub.criteria.length === 0) {
      errors.push(`Rubrik "${rub.title || '#' + (rubIdx + 1)}" wajib memiliki minimal 1 kriteria.`);
    } else {
      rub.criteria.forEach((crit, cIdx) => {
        if (!crit.label || crit.label.trim() === '') {
          errors.push(`Kriteria #${cIdx + 1} pada rubrik "${rub.title || '#' + (rubIdx + 1)}" belum memiliki label.`);
        }
      });
    }
    if (!rub.scale || rub.scale.length === 0) {
      errors.push(`Rubrik "${rub.title || '#' + (rubIdx + 1)}" wajib memiliki minimal 1 tingkat skala penilaian.`);
    } else {
      rub.scale.forEach((sc, sIdx) => {
        if (!sc.label || sc.label.trim() === '') {
          errors.push(`Tingkat skala #${sIdx + 1} pada rubrik "${rub.title || '#' + (rubIdx + 1)}" belum memiliki label.`);
        }
      });
    }

    if (rub.instrumentId && !instrumentMap.has(rub.instrumentId)) {
      errors.push(`Rubrik "${rub.title}" merujuk pada instrumentId [${rub.instrumentId}] yang tidak ditemukan.`);
    }
    if (rub.instrumentItemId && !allItemLookup.has(rub.instrumentItemId)) {
      errors.push(`Rubrik "${rub.title}" merujuk pada instrumentItemId [${rub.instrumentItemId}] yang tidak ditemukan.`);
    }
  });

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

export function canConfirmAssessmentPackage(
  pkg: AssessmentPackage,
  context: AssessmentPackageValidationContext
): { eligible: boolean; errors: string[]; warnings: string[] } {
  const validation = validateAssessmentPackage(pkg, context);
  return {
    eligible: validation.valid,
    errors: validation.errors,
    warnings: validation.warnings,
  };
}

export function confirmAssessmentPackage(
  pkg: AssessmentPackage,
  context: AssessmentPackageValidationContext
): { success: boolean; package: AssessmentPackage; errors: string[] } {
  const validation = validateAssessmentPackage(pkg, context);
  if (!validation.valid) {
    return {
      success: false,
      package: {
        ...pkg,
        workflowStatus: 'PERLU_DILENGKAPI',
        needsReview: true,
        reviewReason: validation.errors.join('; '),
      },
      errors: validation.errors,
    };
  }

  const updatedPkg: AssessmentPackage = {
    ...pkg,
    workflowStatus: 'SIAP',
    needsReview: false,
    reviewReason: undefined,
    updatedAt: new Date().toISOString(),
  };

  return {
    success: true,
    package: updatedPkg,
    errors: [],
  };
}

export function invalidateAssessmentPackageDependencies(
  pkg: AssessmentPackage,
  context: AssessmentPackageValidationContext
): { isInvalidated: boolean; package: AssessmentPackage; reasons: string[] } {
  const reasons: string[] = [];

  // 1. Check parent AssessmentPlan
  if (!context.assessmentPlan || context.assessmentPlan.id !== pkg.assessmentPlanId) {
    reasons.push('Parent AssessmentPlan tidak ditemukan atau telah dihapus.');
  } else if (context.assessmentPlan.workflowStatus !== 'SIAP') {
    reasons.push(`Parent AssessmentPlan "${context.assessmentPlan.title}" tidak lagi berstatus SIAP.`);
  } else if (context.assessmentPlan.needsReview) {
    reasons.push(`Parent AssessmentPlan "${context.assessmentPlan.title}" masih membutuhkan review.`);
  } else {
    // Check instrument types in plan match package
    const planInstTypes = new Set((context.assessmentPlan.instruments || []).map((i) => i.type));
    pkg.instruments.forEach((inst) => {
      if (!planInstTypes.has(inst.type)) {
        reasons.push(`Tipe instrumen "${inst.type}" telah dihapus dari Rencana Asesmen induk.`);
      }
    });
  }

  // 2. Check Objective references in Blueprint - Fail Closed
  if (!pkg.blueprintItems || pkg.blueprintItems.length === 0) {
    reasons.push('Kisi-kisi (blueprint) kosong.');
  } else {
    const curType = getExplicitCurriculumType(context.academicSetting);

    if (curType === 'UNRESOLVED') {
      reasons.push('Kurikulum tidak dapat ditentukan (curriculum unresolved).');
    } else if (curType === 'KURIKULUM_MERDEKA') {
      if (!context.tp || !context.tp.items) {
        reasons.push('Sumber data TP (TPData) tidak tersedia atau telah dihapus.');
      } else if (context.tp.workflowStatus !== 'SIAP' || context.tp.needsReview) {
        reasons.push('Sumber data TP canonical belum SIAP atau masih membutuhkan review.');
      } else {
        const validTpIds = new Set(context.tp.items.map((t) => t.id));
        const invalidBp = pkg.blueprintItems.filter((bp) => !validTpIds.has(bp.objectiveRefId));
        if (invalidBp.length > 0) {
          reasons.push(`Terdapat ${invalidBp.length} referensi TP pada kisi-kisi yang tidak valid atau telah dihapus di hulu.`);
        }
      }
    } else if (curType === 'K13') {
      if (!context.k13Analysis || !context.k13Analysis.items) {
        reasons.push('Sumber data KD (K13Analysis) tidak tersedia atau telah dihapus.');
      } else {
        const validKdIds = new Set(context.k13Analysis.items.map((k) => k.id));
        const invalidBp = pkg.blueprintItems.filter((bp) => !validKdIds.has(bp.objectiveRefId));
        if (invalidBp.length > 0) {
          reasons.push(`Terdapat ${invalidBp.length} referensi KD pada kisi-kisi yang tidak valid atau telah dihapus di hulu.`);
        }
      }
    }

    // 3. Check Criteria references
    pkg.blueprintItems.forEach((bp) => {
      if (bp.criterionId) {
        if (!context.assessmentCriteria) {
          reasons.push('Sumber data kriteria KKTP tidak tersedia atau telah dihapus.');
        } else {
          const criterion = context.assessmentCriteria.find((c) => c.id === bp.criterionId);
          if (!criterion) {
            reasons.push(`Kriteria KKTP [${bp.criterionId}] tidak lagi ditemukan pada sumber kriteria.`);
          } else if (criterion.workflowStatus !== 'SIAP' || criterion.needsReview) {
            reasons.push(`Kriteria KKTP [${bp.criterionId}] belum SIAP atau masih membutuhkan review.`);
          }
        }
      }
    });

    // 4. Check Blueprint -> Instrument Item Linkages
    const itemToInstrumentType = new Map<string, string>();
    const packageInstrumentTypes = new Set<string>();

    pkg.instruments.forEach((inst) => {
      packageInstrumentTypes.add(inst.type);
      switch (inst.type) {
        case 'WRITTEN_TEST':
          (inst as WrittenAssessmentInstrument).items?.forEach((it) => {
            itemToInstrumentType.set(it.id, 'WRITTEN_TEST');
          });
          break;
        case 'ORAL_TEST':
          (inst as OralAssessmentInstrument).items?.forEach((it) => {
            itemToInstrumentType.set(it.id, 'ORAL_TEST');
          });
          break;
        case 'PERFORMANCE':
          (inst as PerformanceAssessmentInstrument).aspects?.forEach((asp) => {
            itemToInstrumentType.set(asp.id, 'PERFORMANCE');
          });
          break;
        case 'OBSERVATION':
          (inst as ObservationAssessmentInstrument).aspects?.forEach((asp) => {
            itemToInstrumentType.set(asp.id, 'OBSERVATION');
          });
          break;
        case 'SELF_ASSESSMENT':
        case 'PEER_ASSESSMENT':
          (inst as SelfPeerAssessmentInstrument).items?.forEach((it) => {
            itemToInstrumentType.set(it.id, inst.type);
          });
          break;
        default:
          itemToInstrumentType.set(inst.id, inst.type);
          break;
      }
    });

    pkg.blueprintItems.forEach((bp) => {
      if (!bp.instrumentType || !packageInstrumentTypes.has(bp.instrumentType)) {
        reasons.push(`Bentuk instrumen "${bp.instrumentType}" tidak valid pada instrumen Perangkat Asesmen.`);
      }
      if (bp.instrumentItemIds && bp.instrumentItemIds.length > 0) {
        bp.instrumentItemIds.forEach((itemId) => {
          const foundType = itemToInstrumentType.get(itemId);
          if (!foundType) {
            reasons.push(`Referensi instrumentItemId [${itemId}] pada kisi-kisi tidak ditemukan.`);
          } else if (bp.instrumentType && foundType !== bp.instrumentType) {
            reasons.push(`Referensi instrumentItemId [${itemId}] tidak sesuai dengan instrumen ${bp.instrumentType}.`);
          }
        });
      }
    });
  }

  // 5. Check Rubric and Scoring Guide References on Instruments
  const validRubricIds = new Set(pkg.rubrics.map((r) => r.id));
  const validScoringGuideIds = new Set(pkg.scoringGuides.map((sg) => sg.id));

  pkg.instruments.forEach((inst) => {
    const instWithRefs = inst as { id: string; type: string; rubricId?: string; scoringGuideId?: string };
    if (instWithRefs.rubricId && !validRubricIds.has(instWithRefs.rubricId)) {
      reasons.push(
        `Instrumen "${inst.type}" (ID: ${inst.id}) merujuk pada rubricId [${instWithRefs.rubricId}] yang telah dihapus.`
      );
    }
    if (instWithRefs.scoringGuideId && !validScoringGuideIds.has(instWithRefs.scoringGuideId)) {
      reasons.push(
        `Instrumen "${inst.type}" (ID: ${inst.id}) merujuk pada scoringGuideId [${instWithRefs.scoringGuideId}] yang telah dihapus.`
      );
    }
  });

  // 6. Check Answer Keys References Integrity
  const instrumentMap = new Map(pkg.instruments.map((i) => [i.id, i]));
  const allItemLookup = new Map<
    string,
    {
      instrumentId: string;
      options?: WrittenAssessmentOption[];
      matchingPremises?: MatchingAssessmentEntry[];
      matchingResponses?: MatchingAssessmentEntry[];
      categoryResponseStatements?: CategoryResponseStatement[];
      categoryResponseCategories?: CategoryResponseCategory[];
    }
  >();

  pkg.instruments.forEach((inst) => {
    switch (inst.type) {
      case 'WRITTEN_TEST':
        (inst as WrittenAssessmentInstrument).items?.forEach((it) => {
          allItemLookup.set(it.id, {
            instrumentId: inst.id,
            options: it.options,
            matchingPremises: it.matchingPremises,
            matchingResponses: it.matchingResponses,
            categoryResponseStatements: it.categoryResponseStatements,
            categoryResponseCategories: it.categoryResponseCategories,
          });

          // Check item-level pairs/categories integrity
          if (it.itemType === 'MATCHING' && it.matchingPairs) {
            const validPremises = new Set((it.matchingPremises || []).map((p) => p.id));
            const validResponses = new Set((it.matchingResponses || []).map((r) => r.id));
            it.matchingPairs.forEach((pair) => {
              if (!validPremises.has(pair.premiseId) || !validResponses.has(pair.responseId)) {
                reasons.push(`Soal menjodohkan [${it.id}] memiliki pasangan kunci yang merujuk pada premis/respon yang telah dihapus.`);
              }
            });
          }
          if (it.itemType === 'CATEGORY_RESPONSE' && it.categoryResponseStatements) {
            const validCats = new Set((it.categoryResponseCategories || []).map((c) => c.id));
            it.categoryResponseStatements.forEach((stmt) => {
              if (stmt.correctCategoryId && !validCats.has(stmt.correctCategoryId)) {
                reasons.push(`Pernyataan [${stmt.id}] pada soal kategori [${it.id}] merujuk pada kategori yang telah dihapus.`);
              }
            });
          }
        });
        break;
      case 'ORAL_TEST':
        (inst as OralAssessmentInstrument).items?.forEach((it) => {
          allItemLookup.set(it.id, { instrumentId: inst.id });
        });
        break;
      case 'PERFORMANCE':
        (inst as PerformanceAssessmentInstrument).aspects?.forEach((asp) => {
          allItemLookup.set(asp.id, { instrumentId: inst.id });
        });
        break;
      case 'OBSERVATION':
        (inst as ObservationAssessmentInstrument).aspects?.forEach((asp) => {
          allItemLookup.set(asp.id, { instrumentId: inst.id });
        });
        break;
      case 'SELF_ASSESSMENT':
      case 'PEER_ASSESSMENT':
        (inst as SelfPeerAssessmentInstrument).items?.forEach((it) => {
          allItemLookup.set(it.id, { instrumentId: inst.id });
        });
        break;
      default:
        break;
    }
  });

  pkg.answerKeys.forEach((ak) => {
    if (!instrumentMap.has(ak.instrumentId)) {
      reasons.push(`Kunci jawaban merujuk pada instrumentId [${ak.instrumentId}] yang telah dihapus.`);
    } else if (!allItemLookup.has(ak.instrumentItemId)) {
      reasons.push(`Kunci jawaban merujuk pada butir [${ak.instrumentItemId}] yang telah dihapus.`);
    } else {
      const meta = allItemLookup.get(ak.instrumentItemId)!;
      if (meta.instrumentId !== ak.instrumentId) {
        reasons.push(`Kunci jawaban merujuk pada butir milik instrumen lain (cross-instrument reference).`);
      }
      if ((ak.answerType === 'OPTION' || ak.answerType === 'MULTIPLE_OPTION') && ak.optionIds) {
        const validOptIds = new Set((meta.options || []).map((o) => o.id));
        ak.optionIds.forEach((optId) => {
          if (!validOptIds.has(optId)) {
            reasons.push(`Kunci jawaban merujuk pada opsi ID [${optId}] yang telah dihapus.`);
          }
        });
      }
      if (ak.answerType === 'MATCHING' && ak.matchingPairs) {
        const validPremises = new Set((meta.matchingPremises || []).map((p) => p.id));
        const validResponses = new Set((meta.matchingResponses || []).map((r) => r.id));
        ak.matchingPairs.forEach((pair) => {
          if (!validPremises.has(pair.premiseId)) {
            reasons.push(`Kunci jawaban menjodohkan merujuk pada premis [${pair.premiseId}] yang telah dihapus.`);
          }
          if (!validResponses.has(pair.responseId)) {
            reasons.push(`Kunci jawaban menjodohkan merujuk pada respon [${pair.responseId}] yang telah dihapus.`);
          }
        });
      }
      if (ak.answerType === 'CATEGORY_RESPONSE' && ak.categoryAnswers) {
        const validStmts = new Set((meta.categoryResponseStatements || []).map((s) => s.id));
        const validCats = new Set((meta.categoryResponseCategories || []).map((c) => c.id));
        ak.categoryAnswers.forEach((ca) => {
          if (!validStmts.has(ca.statementId)) {
            reasons.push(`Kunci jawaban kategori merujuk pada pernyataan [${ca.statementId}] yang telah dihapus.`);
          }
          if (!validCats.has(ca.categoryId)) {
            reasons.push(`Kunci jawaban kategori merujuk pada kategori [${ca.categoryId}] yang telah dihapus.`);
          }
        });
      }
    }
  });

  if (reasons.length > 0) {
    const invalidatedPkg: AssessmentPackage = {
      ...pkg,
      workflowStatus: 'PERLU_DILENGKAPI',
      needsReview: true,
      reviewReason: reasons.join('; '),
      updatedAt: new Date().toISOString(),
    };
    return {
      isInvalidated: true,
      package: invalidatedPkg,
      reasons,
    };
  }

  return {
    isInvalidated: false,
    package: pkg,
    reasons,
  };
}
