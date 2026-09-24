import {
  Document,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  AlignmentType,
  WidthType,
  BorderStyle,
  ShadingType,
} from 'docx';
import {
  AssessmentPackage,
  AssessmentBlueprintItem,
  AssessmentInstrument,
  AssessmentAnswerKey,
  AssessmentScoringGuide,
  AssessmentRubric,
  SchoolData,
  TeacherProfile,
  AcademicSetting,
  AssessmentExportEligibilityResult,
  AssessmentDocumentSnapshot,
  NormalizedAssessmentDocument,
  NormalizedAssessmentKisiKisiRow,
  NormalizedAssessmentInstrument,
  NormalizedAssessmentAnswerKey,
  NormalizedAssessmentScoringGuide,
  NormalizedAssessmentRubric,
  AssessmentExportOptions,
  TPItem,
  K13Analysis,
  AssessmentCriterion,
  AssessmentPlan,
} from '../../types';
import { DocumentGenerationContext } from './types';
import {
  createDocumentHeader,
  createTableHeaderCell,
  createTableDataCell,
  INDONESIAN_MONTHS,
} from './docxStyles';
import {
  PdfDocumentBuilder,
  PdfDocumentSection,
  PdfTableColumn,
} from './renderers/pdf/pdfRenderer';
import { validateAssessmentPackage } from '../assessmentPackageService';
import {
  isValidDocumentDate,
  resolveDocumentDate as resolveCanonicalDocumentDate,
} from '../documentDateService';

function resolveAssessmentDocumentDate(
  context: DocumentGenerationContext,
  options?: AssessmentExportOptions
): string | undefined {
  // Historical snapshot is authoritative.
  if (context.snapshot) {
    return resolveCanonicalDocumentDate(
      context.snapshot.documentDate
    );
  }

  if (options?.documentDate !== undefined) {
    return resolveCanonicalDocumentDate(
      options.documentDate
    );
  }

  if (context.documentDate !== undefined) {
    return resolveCanonicalDocumentDate(
      context.documentDate
    );
  }

  return resolveCanonicalDocumentDate(
    context.workspace?.documentDate
  );
}

/**
 * Format document date to formal Indonesian string.
 * Uses exact specified date or fallback. Never uses new Date() if dateInput is specified.
 */
export function formatDocumentDate(
  dateInput: string | Date | undefined,
  location?: string
): { rawDate: string; formattedDate: string } {
  if (!dateInput) {
    return {
      rawDate: '',
      formattedDate: '',
    };
  }

  const loc = location ? `${location}, ` : '';

  if (typeof dateInput === 'string') {
    if (INDONESIAN_MONTHS.some((m) => dateInput.includes(m))) {
      return {
        rawDate: dateInput,
        formattedDate: dateInput,
      };
    }

    const match = dateInput.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      const year = parseInt(match[1], 10);
      const monthIdx = parseInt(match[2], 10) - 1;
      const day = parseInt(match[3], 10);
      const month = INDONESIAN_MONTHS[monthIdx] || match[2];
      return {
        rawDate: `${match[1]}-${match[2]}-${match[3]}`,
        formattedDate: `${loc}${day} ${month} ${year}`,
      };
    }
  }

  const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (isNaN(d.getTime())) {
    return {
      rawDate: String(dateInput),
      formattedDate: String(dateInput),
    };
  }

  const day = d.getDate();
  const month = INDONESIAN_MONTHS[d.getMonth()];
  const year = d.getFullYear();
  return {
    rawDate: d.toISOString().split('T')[0],
    formattedDate: `${loc}${day} ${month} ${year}`,
  };
}

/**
 * Strict validator for canonical assessment package revision.
 * Must be an integer >= 1 (e.g. 1, 2, 10). Rejects undefined, null, 0, negative, fractional (1.5), and NaN.
 */
export function isValidAssessmentPackageRevision(
  revision: unknown
): revision is number {
  return typeof revision === 'number' && Number.isInteger(revision) && revision >= 1;
}

/**
 * Check eligibility of assessment package for final document export.
 * Invariants:
 * - Only SIAP packages are eligible
 * - DRAFT is blocked
 * - needsReview = true is blocked
 * - If exact activeAssessmentPackageId is provided, resolve exact ID
 * - If no explicit ID: 0 SIAP = blocked, 1 SIAP = valid, >1 SIAP = ambiguous/blocked (NO FIRST MATCH)
 * - Blueprint items must not have dangling references
 */
export function checkAssessmentExportEligibility(
  context: Partial<DocumentGenerationContext>
): AssessmentExportEligibilityResult {
  const blockers: string[] = [];
  const warnings: string[] = [];

  const packages = context.assessmentPackages || [];

  let resolvedPkg: AssessmentPackage | undefined;

  if (context.activeAssessmentPackageId) {
    resolvedPkg = packages.find((p) => p.id === context.activeAssessmentPackageId);
    if (!resolvedPkg) {
      blockers.push(
        `Perangkat Asesmen dengan ID "${context.activeAssessmentPackageId}" tidak ditemukan dalam daftar paket.`
      );
      return {
        eligible: false,
        blockers,
        warnings,
        resolvedPackageId: context.activeAssessmentPackageId,
      };
    }
  } else {
    // No explicit ID: resolve by SIAP status
    const siapPackages = packages.filter((p) => p.workflowStatus === 'SIAP');
    if (siapPackages.length === 0) {
      const hasDrafts = packages.some(
        (p) => p.workflowStatus === 'DRAFT' || p.workflowStatus === 'PERLU_DILENGKAPI'
      );
      if (hasDrafts) {
        blockers.push(
          'Dokumen Asesmen tidak dapat diekspor: Terdapat perangkat asesmen namun masih berstatus DRAFT atau belum dikonfirmasi SIAP.'
        );
      } else {
        blockers.push(
          'Dokumen Asesmen tidak dapat diekspor: Belum ada Perangkat Asesmen yang tersedia.'
        );
      }
      return { eligible: false, blockers, warnings };
    }

    if (siapPackages.length > 1) {
      blockers.push(
        `Dokumen Asesmen tidak dapat diekspor: Terdapat ${siapPackages.length} Perangkat Asesmen berstatus SIAP tanpa ID spesifik. Tentukan ID perangkat secara eksplisit.`
      );
      return { eligible: false, blockers, warnings };
    }

    resolvedPkg = siapPackages[0];
  }

  // Verify status is strictly SIAP
  if (resolvedPkg.workflowStatus !== 'SIAP') {
    blockers.push(
      `Perangkat Asesmen "${resolvedPkg.title}" berstatus ${resolvedPkg.workflowStatus}. Hanya Perangkat Asesmen berstatus SIAP yang dapat diekspor menjadi dokumen resmi.`
    );
  }

  // Verify needsReview flag
  if (resolvedPkg.needsReview) {
    blockers.push(
      `Perangkat Asesmen "${resolvedPkg.title}" masih memerlukan review atau revisi guru (needsReview = true).`
    );
  }

  // Verify revision number is valid integer >= 1
  if (!isValidAssessmentPackageRevision(resolvedPkg.revision)) {
    blockers.push(
      `Perangkat Asesmen "${resolvedPkg.title}" memiliki nomor revisi tidak valid (${resolvedPkg.revision}). Revisi paket wajib berupa bilangan bulat >= 1.`
    );
  }

  // Verify core structural validity using package validator
  const validationContext = {
    academicSetting: context.academicSetting,
    assessmentPlan: (context.assessmentPlans || []).find(
      (p) => p.id === resolvedPkg?.assessmentPlanId
    ),
    tp: context.tp,
    k13Analysis: context.k13Analysis,
    assessmentCriteria: context.assessmentCriteria || [],
  };

  const valResult = validateAssessmentPackage(resolvedPkg, validationContext);
  if (!valResult.valid) {
    blockers.push(...valResult.errors);
  }
  warnings.push(...valResult.warnings);

  // Check for dangling references in blueprint items
  const knownTpIds = new Set<string>();
  (context.tp?.items || []).forEach((t) => knownTpIds.add(t.id));
  if (context.k13Analysis?.items) {
    context.k13Analysis.items.forEach((kd) => knownTpIds.add(kd.id));
  }

  for (const bp of resolvedPkg.blueprintItems || []) {
    if (bp.objectiveRefId && !knownTpIds.has(bp.objectiveRefId)) {
      blockers.push(
        `Kisi-kisi asesmen butir "${bp.id}" merujuk ke tujuan pembelajaran / KD ID "${bp.objectiveRefId}" yang tidak terdaftar.`
      );
    }
  }

  return {
    eligible: blockers.length === 0,
    package: resolvedPkg,
    blockers,
    warnings,
    resolvedPackageId: resolvedPkg?.id,
    revision: resolvedPkg?.revision,
  };
}

/**
 * Internal shared helper to create a canonical AssessmentDocumentSnapshot from an AssessmentPackage.
 * Responsible for document date, metadata resolution, objectives, and deep-copying package content.
 * Does NOT enforce SIAP eligibility or review status.
 */
function createCanonicalAssessmentSnapshotFromPackage(
  context: DocumentGenerationContext,
  pkg: AssessmentPackage,
  options?: AssessmentExportOptions
): AssessmentDocumentSnapshot {
  const school = context.school || ({} as SchoolData);
  const profile = context.profile || ({} as TeacherProfile);
  const academicSetting = context.academicSetting || ({} as AcademicSetting);

  const location =
    school.district?.replace(/^Kec\.\s*/i, '') || school.regency || school.village || '';

  const rawDate = resolveAssessmentDocumentDate(context, options);

  if (!isValidDocumentDate(rawDate)) {
    throw new Error(
      'Gagal membuat snapshot asesmen: Tanggal Dokumen (documentDate) belum ditetapkan. Atur Tanggal Dokumen pada Pengaturan Administrasi sebelum mengekspor atau melihat pratinjau dokumen.'
    );
  }
  const dateResult = formatDocumentDate(rawDate, location);

  // Freeze TP lookup
  const resolvedObjectives: Record<string, { code: string; statement: string }> = {};
  (context.tp?.items || []).forEach((t) => {
    resolvedObjectives[t.id] = {
      code: t.code || '',
      statement: t.statement || '',
    };
  });
  if (context.k13Analysis?.items) {
    context.k13Analysis.items.forEach((kd) => {
      resolvedObjectives[kd.id] = {
        code: kd.kd || '',
        statement: kd.tujuanPembelajaran || kd.indikator || '',
      };
    });
  }

  // Freeze associated plan
  const plan = (context.assessmentPlans || []).find((p) => p.id === pkg.assessmentPlanId);

  if (!isValidAssessmentPackageRevision(pkg.revision)) {
    throw new Error(
      `Gagal membuat snapshot asesmen: Revisi Perangkat Asesmen tidak valid (${pkg.revision}). Revisi paket wajib berupa bilangan bulat >= 1.`
    );
  }

  const snapshot: AssessmentDocumentSnapshot = {
    snapshotId: `snap-asmt-${pkg.id}-r${pkg.revision}-${Date.now()}`,
    mode: 'CANONICAL_PACKAGE',
    documentType: 'ASESMEN',
    documentDate: dateResult.rawDate,
    formattedDocumentDate: dateResult.formattedDate,
    assessmentPlanId: pkg.assessmentPlanId,
    assessmentPlanTitle: plan?.title,
    assessmentPackageId: pkg.id,
    assessmentPackageRevision: pkg.revision,
    packageTitle: pkg.title,
    packageReviewReason: pkg.reviewReason,
    schoolName: school.name || '',
    npsn: school.npsn,
    schoolNpsn: school.npsn,
    schoolAddress: school.address,
    schoolVillage: school.village,
    schoolDistrict: school.district,
    schoolRegency: school.regency,
    schoolProvince: school.province,
    principalName: school.principalName || '',
    principalNip: school.principalNip,
    principalSource: school.principalSource,
    teacherName: profile.name || '',
    teacherNip: profile.nip,
    teacherStatus: profile.status,
    academicYear: academicSetting.academicYear || '',
    semester: academicSetting.semester || '',
    grade: academicSetting.grade || '',
    subject: academicSetting.subject || '',
    phase: academicSetting.phase,
    curriculum: academicSetting.curriculum || '',
    curriculumType: academicSetting.curriculumType,
    documentMode: options?.documentMode || context.documentMode || 'data',
    studentCount: context.students?.length,
    studentNames: context.students?.map((s) => s.name),
    generatedAt: new Date().toISOString(),
    blueprintItems: JSON.parse(JSON.stringify(pkg.blueprintItems || [])),
    instruments: JSON.parse(JSON.stringify(pkg.instruments || [])),
    answerKeys: JSON.parse(JSON.stringify(pkg.answerKeys || [])),
    scoringGuides: JSON.parse(JSON.stringify(pkg.scoringGuides || [])),
    rubrics: JSON.parse(JSON.stringify(pkg.rubrics || [])),
    resolvedObjectives: JSON.parse(JSON.stringify(resolvedObjectives)),
  };

  return snapshot;
}

/**
 * Creates an immutable AssessmentDocumentSnapshot.
 * This snapshot is completely self-contained. Renderers MUST consume this snapshot
 * rather than live application state.
 */
export function createAssessmentDocumentSnapshot(
  context: DocumentGenerationContext,
  options?: AssessmentExportOptions
): AssessmentDocumentSnapshot {
  const isBlankMode = (options?.documentMode || context.documentMode) === 'blank';

  const school = context.school || ({} as SchoolData);
  const profile = context.profile || ({} as TeacherProfile);
  const academicSetting = context.academicSetting || ({} as AcademicSetting);

  const location =
    school.district?.replace(/^Kec\.\s*/i, '') || school.regency || school.village || '';

  if (isBlankMode) {
    const rawDate = resolveAssessmentDocumentDate(context, options);
    const dateResult = rawDate ? formatDocumentDate(rawDate, location) : { rawDate: '', formattedDate: '' };

    const snapshot: AssessmentDocumentSnapshot = {
      snapshotId: `snap-asmt-blank-${Date.now()}`,
      mode: 'BLANK_TEMPLATE',
      documentType: 'ASESMEN',
      documentDate: dateResult.rawDate || undefined,
      formattedDocumentDate: dateResult.formattedDate || '',
      schoolName: school.name || '',
      npsn: school.npsn,
      schoolNpsn: school.npsn,
      schoolAddress: school.address,
      schoolVillage: school.village,
      schoolDistrict: school.district,
      schoolRegency: school.regency,
      schoolProvince: school.province,
      principalName: school.principalName || '',
      principalNip: school.principalNip,
      principalSource: school.principalSource,
      teacherName: profile.name || '',
      teacherNip: profile.nip,
      teacherStatus: profile.status,
      academicYear: academicSetting.academicYear || '',
      semester: academicSetting.semester || '',
      grade: academicSetting.grade || '',
      subject: academicSetting.subject || '',
      phase: academicSetting.phase,
      curriculum: academicSetting.curriculum || '',
      curriculumType: academicSetting.curriculumType,
      documentMode: 'blank',
      studentCount: context.students?.length,
      studentNames: context.students?.map((s) => s.name),
      generatedAt: new Date().toISOString(),
      blueprintItems: [],
      instruments: [],
      answerKeys: [],
      scoringGuides: [],
      rubrics: [],
      resolvedObjectives: {},
    };

    return snapshot;
  }

  const eligibility = checkAssessmentExportEligibility(context);
  if (!eligibility.eligible || !eligibility.package) {
    throw new Error(
      `Gagal membuat snapshot asesmen: ${eligibility.blockers.join('; ')}`
    );
  }

  return createCanonicalAssessmentSnapshotFromPackage(
    context,
    eligibility.package,
    options
  );
}

/**
 * Creates an immutable AssessmentDocumentSnapshot for preview purposes.
 * Does NOT require SIAP status or checkAssessmentExportEligibility, allowing DRAFT / PERLU_DILENGKAPI packages to be previewed.
 * Exact activeAssessmentPackageId is STRICTLY mandatory (Fail-Closed).
 */
export function createAssessmentPreviewSnapshot(
  context: DocumentGenerationContext,
  options?: AssessmentExportOptions
): AssessmentDocumentSnapshot {
  if (!context.activeAssessmentPackageId) {
    throw new Error('Pratinjau asesmen memerlukan ID paket aktif yang spesifik.');
  }

  const pkg = (context.assessmentPackages || []).find(
    (p) => p.id === context.activeAssessmentPackageId
  );

  if (!pkg) {
    throw new Error(
      `Pratinjau asesmen gagal: Perangkat Asesmen dengan ID "${context.activeAssessmentPackageId}" tidak ditemukan.`
    );
  }

  return createCanonicalAssessmentSnapshotFromPackage(
    context,
    pkg,
    options
  );
}

/**
 * Creates a NormalizedAssessmentDocument model for preview purposes.
 * Consumes the preview snapshot and runs it through the standard normalization engine.
 */
export function createAssessmentPreviewModel(
  context: DocumentGenerationContext,
  options?: AssessmentExportOptions
): NormalizedAssessmentDocument {
  const snapshot = createAssessmentPreviewSnapshot(
    context,
    options
  );

  return buildNormalizedAssessmentDocumentModel(
    snapshot
  );
}

/**
 * Builds a normalized, semantic document model from an AssessmentDocumentSnapshot.
 * Both DOCX and PDF renderers consume this exact normalized model, ensuring complete parity.
 */
export function buildNormalizedAssessmentDocumentModel(
  snapshot: AssessmentDocumentSnapshot
): NormalizedAssessmentDocument {
  const isBlank = snapshot.documentMode === 'blank' || snapshot.mode === 'BLANK_TEMPLATE';

  // 1. Metadata
  const metadata = {
    title: 'PERANGKAT ASESMEN PEMBELAJARAN',
    subTitle: snapshot.packageTitle || (isBlank ? 'Format Instrumen dan Rubrik Asesmen' : 'Paket Instrumen dan Rubrik Asesmen'),
    schoolName: snapshot.schoolName,
    npsn: snapshot.npsn,
    schoolAddress: snapshot.schoolAddress,
    curriculum: snapshot.curriculum || '',
    subject: snapshot.subject,
    grade: snapshot.grade,
    phase: snapshot.phase,
    academicYear: snapshot.academicYear,
    semester: snapshot.semester,
    teacherName: snapshot.teacherName,
    teacherNip: snapshot.teacherNip,
    packageId: snapshot.assessmentPackageId,
    packageRevision: snapshot.assessmentPackageRevision,
    documentDate: snapshot.documentDate,
    formattedDocumentDate: snapshot.formattedDocumentDate,
    isBlankMode: isBlank,
    mode: snapshot.mode,
  };

  // 2. Kisi-Kisi / Blueprint
  const kisiKisiRows: NormalizedAssessmentKisiKisiRow[] = isBlank
    ? [
        {
          no: 1,
          tpCodeAndStatement: '',
          indicator: '',
          material: '',
          instrumentType: '',
        },
      ]
    : snapshot.blueprintItems.map((bp, idx) => {
        const obj = snapshot.resolvedObjectives[bp.objectiveRefId];
        let tpText = bp.objectiveRefId || '-';
        if (obj) {
          if (obj.code && obj.statement) {
            tpText = `[${obj.code}] ${obj.statement}`;
          } else if (obj.statement) {
            tpText = obj.statement;
          } else if (obj.code) {
            tpText = `[${obj.code}]`;
          }
        }

        return {
          no: bp.order || idx + 1,
          tpCodeAndStatement: tpText,
          indicator: bp.assessmentIndicator || '-',
          material: bp.materialOrContext || '-',
          instrumentType: bp.instrumentType || '-',
        };
      });

  // 3. Instruments
  const instruments: NormalizedAssessmentInstrument[] = isBlank
    ? []
    : snapshot.instruments.map((inst) => {
        const base: NormalizedAssessmentInstrument = {
          id: inst.id,
          type: inst.type,
          typeLabel: getInstrumentTypeLabel(inst.type),
          title: inst.title,
          instructions: (inst as any).instructions,
        };

        switch (inst.type) {
          case 'WRITTEN_TEST': {
            base.writtenItems = (inst.items || []).map((item, idx) => ({
              no: item.order || idx + 1,
              prompt: item.prompt,
              stimulus: item.stimulus,
              itemType: item.itemType,
              options: item.options?.map((opt) => ({
                label: opt.label,
                text: opt.text,
              })),
            }));
            break;
          }
          case 'ORAL_TEST': {
            base.oralItems = (inst.items || []).map((item, idx) => ({
              no: item.order || idx + 1,
              prompt: item.prompt,
              expectedResponse: item.expectedResponse,
            }));
            break;
          }
          case 'PERFORMANCE': {
            base.task = inst.task;
            base.performanceAspects = inst.aspects?.map((a) => ({
              label: a.label,
              description: a.description,
              weight: a.weight,
            }));
            break;
          }
          case 'ASSIGNMENT': {
            base.instructions = inst.instructions;
            base.expectedOutput = inst.expectedOutput;
            break;
          }
          case 'PROJECT': {
            base.projectBrief = inst.projectBrief;
            base.expectedDeliverable = inst.expectedDeliverable;
            break;
          }
          case 'PRODUCT': {
            base.productBrief = inst.productBrief;
            base.expectedProduct = inst.expectedProduct;
            break;
          }
          case 'PORTFOLIO': {
            base.evidenceRequirements = inst.evidenceRequirements || [];
            break;
          }
          case 'OBSERVATION': {
            base.observationAspects = inst.aspects?.map((a) => ({
              label: a.label,
              indicator: a.indicator,
            }));
            base.recordingScheme = inst.recordingScheme;
            break;
          }
          case 'SELF_ASSESSMENT':
          case 'PEER_ASSESSMENT': {
            base.selfPeerItems = (inst.items || []).map((item, idx) => ({
              no: idx + 1,
              statement: item.statement,
              category: item.category,
            }));
            break;
          }
        }

        return base;
      });

  // 4. Answer Keys
  const answerKeys: NormalizedAssessmentAnswerKey[] = isBlank
    ? []
    : snapshot.answerKeys.map((ak, idx) => {
        let valueStr = ak.value || '';
        if (ak.answerType === 'OPTION' && ak.optionIds && ak.optionIds.length > 0) {
          valueStr = ak.optionIds.join(', ');
        } else if (ak.answerType === 'MULTIPLE_OPTION' && ak.optionIds) {
          valueStr = ak.optionIds.join(', ');
        } else if (ak.answerType === 'MATCHING' && ak.matchingPairs) {
          valueStr = ak.matchingPairs
            .map((p) => `${p.premiseId} ➔ ${p.responseId}`)
            .join('; ');
        } else if (ak.answerType === 'CATEGORY_RESPONSE' && ak.categoryAnswers) {
          valueStr = ak.categoryAnswers
            .map((ca) => `Pernyataan [${ca.statementId}]: Kategori [${ca.categoryId}]`)
            .join('; ');
        }

        return {
          itemNumber: idx + 1,
          instrumentType: 'WRITTEN_TEST',
          answerType: ak.answerType,
          value: valueStr,
          notes: ak.notes,
        };
      });

  // 5. Scoring Guides
  const scoringGuides: NormalizedAssessmentScoringGuide[] = isBlank
    ? []
    : snapshot.scoringGuides.map((sg) => ({
        title: sg.title,
        guideType: sg.guideType,
        maxScore: sg.maxScore,
        instructions: sg.instructions,
        notes: sg.notes,
      }));

  // 6. Rubrics
  const rubrics: NormalizedAssessmentRubric[] = isBlank
    ? []
    : snapshot.rubrics.map((r) => {
        const sortedScale = [...(r.scale || [])].sort(
          (a, b) => (a.order ?? 0) - (b.order ?? 0)
        );

        const scaleHeaders = sortedScale.map((s) => ({
          label: s.label,
          score: s.score,
        }));

        const criteriaRows = (r.criteria || []).map((c) => {
          const descriptors = sortedScale.map((s) => {
            return s.descriptor || '-';
          });

          return {
            label: c.label + (c.indicator ? ` (${c.indicator})` : ''),
            descriptors,
            weight: c.weight,
          };
        });

        return {
          title: r.title,
          scale: scaleHeaders,
          criteria: criteriaRows,
        };
      });

  // 7. Signoff
  const signoff = {
    locationAndDate: snapshot.formattedDocumentDate,
    principalTitle: 'Kepala Sekolah',
    principalName: snapshot.principalName,
    principalNip: snapshot.principalNip,
    teacherTitle: 'Guru Mata Pelajaran',
    teacherName: snapshot.teacherName,
    teacherNip: snapshot.teacherNip,
    isBlankMode: isBlank,
  };

  return {
    metadata,
    kisiKisi: {
      title: 'I. KISI-KISI ASESMEN (BLUEPRINT)',
      rows: kisiKisiRows,
    },
    instruments: {
      title: 'II. INSTRUMEN ASESMEN',
      list: instruments,
    },
    answerKeys: {
      title: 'III. KUNCI JAWABAN',
      list: answerKeys,
    },
    scoringGuides: {
      title: 'IV. PEDOMAN PENSKORAN',
      list: scoringGuides,
    },
    rubrics: {
      title: 'V. RUBRIK PENILAIAN',
      list: rubrics,
    },
    signoff,
  };
}

function getInstrumentTypeLabel(type: string): string {
  switch (type) {
    case 'WRITTEN_TEST':
      return 'Tes Tertulis';
    case 'ORAL_TEST':
      return 'Tes Lisan';
    case 'PERFORMANCE':
      return 'Penilaian Kinerja / Praktik';
    case 'OBSERVATION':
      return 'Lembar Pengamatan / Observasi';
    case 'ASSIGNMENT':
      return 'Penugasan';
    case 'PROJECT':
      return 'Penilaian Proyek';
    case 'PRODUCT':
      return 'Penilaian Produk';
    case 'PORTFOLIO':
      return 'Portofolio';
    case 'SELF_ASSESSMENT':
      return 'Penilaian Diri';
    case 'PEER_ASSESSMENT':
      return 'Penilaian Antar-Teman';
    default:
      return type;
  }
}

function createNormalizedAssessmentIdentityTable(
  metadata: NormalizedAssessmentDocument['metadata'],
  extraRows: [string, string][] = []
): Table {
  const isK13Curriculum =
    metadata.curriculum &&
    (metadata.curriculum.includes('2013') || metadata.curriculum.includes('K13'));

  const classRow: [string, string] = isK13Curriculum
    ? ['Kelas', `: ${metadata.grade || '-'}`]
    : metadata.phase
    ? ['Fase / Kelas', `: ${metadata.phase} / ${metadata.grade || '-'}`]
    : ['Kelas', `: ${metadata.grade || '-'}`];

  const semesterText =
    metadata.academicYear && metadata.semester
      ? `${metadata.academicYear} / ${metadata.semester}`
      : metadata.academicYear || metadata.semester || '-';

  const baseRows: [string, string][] = [
    ['Satuan Pendidikan', `: ${metadata.schoolName || '-'}`],
    ['NPSN', `: ${metadata.npsn || '-'}`],
    ['Alamat', `: ${metadata.schoolAddress || '-'}`],
    ['Kurikulum', `: ${metadata.curriculum || '-'}`],
    ['Mata Pelajaran', `: ${metadata.subject || '-'}`],
    classRow,
    ['Tahun Ajaran / Semester', `: ${semesterText}`],
    ['Guru Mata Pelajaran', `: ${metadata.teacherName || '-'}`],
    ['NIP Guru', `: ${metadata.teacherNip || '-'}`],
    ...extraRows,
  ];

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.NONE },
      bottom: { style: BorderStyle.NONE },
      left: { style: BorderStyle.NONE },
      right: { style: BorderStyle.NONE },
      insideHorizontal: { style: BorderStyle.NONE },
      insideVertical: { style: BorderStyle.NONE },
    },
    rows: baseRows.map(
      ([label, val]) =>
        new TableRow({
          children: [
            new TableCell({
              width: { size: 30, type: WidthType.PERCENTAGE },
              children: [
                new Paragraph({
                  children: [new TextRun({ text: label, bold: true, size: 20, font: 'Arial' })],
                }),
              ],
            }),
            new TableCell({
              width: { size: 70, type: WidthType.PERCENTAGE },
              children: [
                new Paragraph({
                  children: [new TextRun({ text: val, size: 20, font: 'Arial' })],
                }),
              ],
            }),
          ],
        })
    ),
  });
}

function createNormalizedAssessmentSignoffBlock(
  signoff: NormalizedAssessmentDocument['signoff']
): (Paragraph | Table)[] {
  const isBlankMode = signoff.isBlankMode;
  const dateStr = isBlankMode
    ? '....................., .................... 20....'
    : signoff.locationAndDate;

  const principalTitle = signoff.principalTitle || 'Kepala Sekolah';
  const teacherTitle = signoff.teacherTitle || 'Guru Mata Pelajaran';

  const principalNameText = isBlankMode
    ? '(........................)'
    : signoff.principalName
    ? signoff.principalName
    : '(........................)';

  const principalNipText = isBlankMode
    ? 'NIP. ....................'
    : signoff.principalNip
    ? `NIP. ${signoff.principalNip}`
    : 'NIP. ....................';

  const teacherNameText = isBlankMode
    ? '(........................)'
    : signoff.teacherName
    ? signoff.teacherName
    : '(........................)';

  const teacherNipText = isBlankMode
    ? 'NIP. ....................'
    : signoff.teacherNip
    ? `NIP. ${signoff.teacherNip}`
    : 'NIP. ....................';

  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.NONE },
      bottom: { style: BorderStyle.NONE },
      left: { style: BorderStyle.NONE },
      right: { style: BorderStyle.NONE },
      insideHorizontal: { style: BorderStyle.NONE },
      insideVertical: { style: BorderStyle.NONE },
    },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: 50, type: WidthType.PERCENTAGE },
            children: [
              new Paragraph({
                children: [new TextRun({ text: 'Mengetahui,', size: 20, font: 'Arial' })],
              }),
              new Paragraph({
                children: [new TextRun({ text: principalTitle, size: 20, font: 'Arial' })],
              }),
              new Paragraph({ spacing: { after: 720 } }),
              new Paragraph({
                children: [
                  new TextRun({
                    text: principalNameText,
                    bold: !isBlankMode && !!signoff.principalName,
                    size: 20,
                    font: 'Arial',
                    underline: !isBlankMode && signoff.principalName ? {} : undefined,
                  }),
                ],
              }),
              new Paragraph({
                children: [
                  new TextRun({
                    text: principalNipText,
                    size: 20,
                    font: 'Arial',
                  }),
                ],
              }),
            ],
          }),
          new TableCell({
            width: { size: 50, type: WidthType.PERCENTAGE },
            children: [
              new Paragraph({
                children: [new TextRun({ text: dateStr, size: 20, font: 'Arial' })],
              }),
              new Paragraph({
                children: [new TextRun({ text: teacherTitle, size: 20, font: 'Arial' })],
              }),
              new Paragraph({ spacing: { after: 720 } }),
              new Paragraph({
                children: [
                  new TextRun({
                    text: teacherNameText,
                    bold: !isBlankMode && !!signoff.teacherName,
                    size: 20,
                    font: 'Arial',
                    underline: !isBlankMode && signoff.teacherName ? {} : undefined,
                  }),
                ],
              }),
              new Paragraph({
                children: [
                  new TextRun({
                    text: teacherNipText,
                    size: 20,
                    font: 'Arial',
                  }),
                ],
              }),
            ],
          }),
        ],
      }),
    ],
  });

  return [new Paragraph({ spacing: { before: 360 } }), table];
}

/**
 * DOCX Renderer: Produces official DOCX from normalized assessment document model.
 */
export async function renderAssessmentDocx(
  model: NormalizedAssessmentDocument
): Promise<Blob> {
  const isBlank = model.metadata.isBlankMode;
  const docChildren: any[] = [];

  const extraIdentityRows: [string, string][] = [];
  if (!isBlank && model.metadata.packageRevision !== undefined) {
    extraIdentityRows.push(['Nomor Revisi Paket', `: Revisi ${model.metadata.packageRevision}`]);
  }
  if (model.metadata.formattedDocumentDate) {
    extraIdentityRows.push(['Tanggal Dokumen', `: ${model.metadata.formattedDocumentDate}`]);
  }

  // Header & Identity
  docChildren.push(
    ...createDocumentHeader(model.metadata.title, model.metadata.subTitle)
  );
  docChildren.push(
    createNormalizedAssessmentIdentityTable(model.metadata, extraIdentityRows)
  );
  docChildren.push(new Paragraph({ spacing: { after: 240 } }));

  // SECTION I: Kisi-Kisi
  docChildren.push(
    new Paragraph({
      children: [
        new TextRun({
          text: model.kisiKisi.title,
          bold: true,
          size: 22,
          font: 'Arial',
          color: '1E3A8A',
        }),
      ],
      spacing: { before: 200, after: 120 },
    })
  );

  const kisiKisiTableRows: TableRow[] = [
    new TableRow({
      children: [
        createTableHeaderCell('No', 8),
        createTableHeaderCell('Tujuan Pembelajaran / KD', 36, AlignmentType.LEFT),
        createTableHeaderCell('Indikator Asesmen', 26, AlignmentType.LEFT),
        createTableHeaderCell('Materi / Lingkup', 15, AlignmentType.LEFT),
        createTableHeaderCell('Bentuk', 15),
      ],
    }),
    ...model.kisiKisi.rows.map(
      (r) =>
        new TableRow({
          children: [
            createTableDataCell(String(r.no), 8, AlignmentType.CENTER),
            createTableDataCell(r.tpCodeAndStatement, 36),
            createTableDataCell(r.indicator, 26),
            createTableDataCell(r.material, 15),
            createTableDataCell(r.instrumentType, 15, AlignmentType.CENTER),
          ],
        })
    ),
  ];

  docChildren.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: kisiKisiTableRows,
    })
  );
  docChildren.push(new Paragraph({ spacing: { after: 240 } }));

  // SECTION II: Instrumen Asesmen
  docChildren.push(
    new Paragraph({
      children: [
        new TextRun({
          text: model.instruments.title,
          bold: true,
          size: 22,
          font: 'Arial',
          color: '1E3A8A',
        }),
      ],
      spacing: { before: 200, after: 120 },
    })
  );

  if (model.instruments.list.length === 0) {
    docChildren.push(
      new Paragraph({
        children: [
          new TextRun({
            text: isBlank
              ? '(Kolom instrumen dapat dituliskan langsung oleh guru)'
              : 'Belum ada instrumen yang dimuat dalam paket ini.',
            italics: true,
            size: 20,
            font: 'Arial',
            color: '64748B',
          }),
        ],
        spacing: { after: 120 },
      })
    );
  }

  model.instruments.list.forEach((inst, instIdx) => {
    docChildren.push(
      new Paragraph({
        children: [
          new TextRun({
            text: `${instIdx + 1}. [${inst.typeLabel}] ${inst.title || ''}`,
            bold: true,
            size: 20,
            font: 'Arial',
            color: '0F172A',
          }),
        ],
        spacing: { before: 140, after: 80 },
      })
    );

    if (inst.instructions) {
      docChildren.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `Petunjuk: ${inst.instructions}`,
              italics: true,
              size: 19,
              font: 'Arial',
              color: '475569',
            }),
          ],
          spacing: { after: 100 },
        })
      );
    }

    // Specific instrument rendering
    if (inst.type === 'WRITTEN_TEST' && inst.writtenItems) {
      inst.writtenItems.forEach((it) => {
        if (it.stimulus) {
          docChildren.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: `Stimulus:\n${it.stimulus}`,
                  size: 19,
                  font: 'Arial',
                  color: '334155',
                }),
              ],
              spacing: { before: 60, after: 40 },
            })
          );
        }

        docChildren.push(
          new Paragraph({
            children: [
              new TextRun({
                text: `${it.no}. ${it.prompt}`,
                size: 20,
                font: 'Arial',
              }),
            ],
            spacing: { before: 40, after: 40 },
          })
        );

        if (it.options && it.options.length > 0) {
          it.options.forEach((opt) => {
            docChildren.push(
              new Paragraph({
                indent: { left: 360 },
                children: [
                  new TextRun({
                    text: `${opt.label}. ${opt.text}`,
                    size: 19,
                    font: 'Arial',
                  }),
                ],
                spacing: { after: 20 },
              })
            );
          });
        }
      });
    } else if (inst.type === 'PERFORMANCE') {
      if (inst.task) {
        docChildren.push(
          new Paragraph({
            children: [
              new TextRun({ text: 'Tugas Praktik/Kinerja: ', bold: true, size: 19, font: 'Arial' }),
              new TextRun({ text: inst.task, size: 19, font: 'Arial' }),
            ],
            spacing: { after: 60 },
          })
        );
      }
      if (inst.performanceAspects && inst.performanceAspects.length > 0) {
        docChildren.push(
          new Paragraph({
            children: [
              new TextRun({ text: 'Aspek yang Dinilai:', bold: true, size: 19, font: 'Arial' }),
            ],
            spacing: { after: 40 },
          })
        );
        inst.performanceAspects.forEach((asp, aIdx) => {
          let text = `- ${asp.label}${asp.description ? `: ${asp.description}` : ''}`;
          if (asp.weight !== undefined) {
            text += ` — Bobot: ${asp.weight}`;
          }
          docChildren.push(
            new Paragraph({
              indent: { left: 360 },
              children: [
                new TextRun({
                  text,
                  size: 19,
                  font: 'Arial',
                }),
              ],
              spacing: { after: 20 },
            })
          );
        });
      }
    } else if (inst.type === 'ASSIGNMENT') {
      if (inst.expectedOutput) {
        docChildren.push(
          new Paragraph({
            children: [
              new TextRun({ text: 'Hasil / Luaran: ', bold: true, size: 19, font: 'Arial' }),
              new TextRun({ text: inst.expectedOutput, size: 19, font: 'Arial' }),
            ],
            spacing: { after: 60 },
          })
        );
      }
    } else if (inst.type === 'PROJECT') {
      if (inst.projectBrief) {
        docChildren.push(
          new Paragraph({
            children: [
              new TextRun({ text: 'Deskripsi Proyek: ', bold: true, size: 19, font: 'Arial' }),
              new TextRun({ text: inst.projectBrief, size: 19, font: 'Arial' }),
            ],
            spacing: { after: 40 },
          })
        );
      }
      if (inst.expectedDeliverable) {
        docChildren.push(
          new Paragraph({
            children: [
              new TextRun({ text: 'Luaran Proyek: ', bold: true, size: 19, font: 'Arial' }),
              new TextRun({ text: inst.expectedDeliverable, size: 19, font: 'Arial' }),
            ],
            spacing: { after: 60 },
          })
        );
      }
    } else if (inst.type === 'PRODUCT') {
      if (inst.productBrief) {
        docChildren.push(
          new Paragraph({
            children: [
              new TextRun({ text: 'Spesifikasi Produk: ', bold: true, size: 19, font: 'Arial' }),
              new TextRun({ text: inst.productBrief, size: 19, font: 'Arial' }),
            ],
            spacing: { after: 40 },
          })
        );
      }
      if (inst.expectedProduct) {
        docChildren.push(
          new Paragraph({
            children: [
              new TextRun({ text: 'Produk / Hasil yang Diharapkan: ', bold: true, size: 19, font: 'Arial' }),
              new TextRun({ text: inst.expectedProduct, size: 19, font: 'Arial' }),
            ],
            spacing: { after: 60 },
          })
        );
      }
    } else if (inst.type === 'PORTFOLIO') {
      if (inst.evidenceRequirements && inst.evidenceRequirements.length > 0) {
        docChildren.push(
          new Paragraph({
            children: [
              new TextRun({ text: 'Dokumen Bukti Karya: ', bold: true, size: 19, font: 'Arial' }),
            ],
            spacing: { after: 40 },
          })
        );
        inst.evidenceRequirements.forEach((ev) => {
          docChildren.push(
            new Paragraph({
              indent: { left: 360 },
              children: [new TextRun({ text: `• ${ev}`, size: 19, font: 'Arial' })],
              spacing: { after: 20 },
            })
          );
        });
      }
    } else if (inst.type === 'OBSERVATION') {
      if (inst.recordingScheme) {
        docChildren.push(
          new Paragraph({
            children: [
              new TextRun({ text: 'Skema Pencatatan: ', bold: true, size: 19, font: 'Arial' }),
              new TextRun({ text: inst.recordingScheme, size: 19, font: 'Arial' }),
            ],
            spacing: { after: 40 },
          })
        );
      }
      if (inst.observationAspects && inst.observationAspects.length > 0) {
        const obsRows = [
          new TableRow({
            children: [
              createTableHeaderCell('No', 10),
              createTableHeaderCell('Aspek Pengamatan', 45, AlignmentType.LEFT),
              createTableHeaderCell('Indikator', 45, AlignmentType.LEFT),
            ],
          }),
          ...inst.observationAspects.map(
            (asp, aIdx) =>
              new TableRow({
                children: [
                  createTableDataCell(String(aIdx + 1), 10, AlignmentType.CENTER),
                  createTableDataCell(asp.label, 45),
                  createTableDataCell(asp.indicator || '-', 45),
                ],
              })
          ),
        ];
        docChildren.push(
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: obsRows,
          })
        );
      }
    } else if (inst.type === 'ORAL_TEST' && inst.oralItems) {
      inst.oralItems.forEach((it) => {
        docChildren.push(
          new Paragraph({
            children: [
              new TextRun({ text: `${it.no}. ${it.prompt}`, size: 20, font: 'Arial' }),
            ],
            spacing: { before: 40, after: 20 },
          })
        );
      });
    } else if (
      (inst.type === 'SELF_ASSESSMENT' || inst.type === 'PEER_ASSESSMENT') &&
      inst.selfPeerItems
    ) {
      inst.selfPeerItems.forEach((it) => {
        const text = it.category ? `${it.no}. ${it.statement} — ${it.category}` : `${it.no}. ${it.statement}`;
        docChildren.push(
          new Paragraph({
            children: [
              new TextRun({ text, size: 20, font: 'Arial' }),
            ],
            spacing: { before: 40, after: 20 },
          })
        );
      });
    }

    docChildren.push(new Paragraph({ spacing: { after: 120 } }));
  });

  // SECTION III: Kunci Jawaban
  if (model.answerKeys.list.length > 0) {
    docChildren.push(
      new Paragraph({
        children: [
          new TextRun({
            text: model.answerKeys.title,
            bold: true,
            size: 22,
            font: 'Arial',
            color: '1E3A8A',
          }),
        ],
        spacing: { before: 200, after: 120 },
      })
    );

    const akRows = [
      new TableRow({
        children: [
          createTableHeaderCell('No. Butir', 12),
          createTableHeaderCell('Tipe Kunci', 25),
          createTableHeaderCell('Kunci Jawaban', 40, AlignmentType.LEFT),
          createTableHeaderCell('Keterangan / Penjelasan', 23, AlignmentType.LEFT),
        ],
      }),
      ...model.answerKeys.list.map(
        (ak) =>
          new TableRow({
            children: [
              createTableDataCell(String(ak.itemNumber || '-'), 12, AlignmentType.CENTER),
              createTableDataCell(ak.answerType, 25, AlignmentType.CENTER),
              createTableDataCell(ak.value || '-', 40, AlignmentType.LEFT, true),
              createTableDataCell(ak.notes || '-', 23),
            ],
          })
      ),
    ];

    docChildren.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: akRows,
      })
    );
    docChildren.push(new Paragraph({ spacing: { after: 240 } }));
  }

  // SECTION IV: Pedoman Penskoran
  if (model.scoringGuides.list.length > 0) {
    docChildren.push(
      new Paragraph({
        children: [
          new TextRun({
            text: model.scoringGuides.title,
            bold: true,
            size: 22,
            font: 'Arial',
            color: '1E3A8A',
          }),
        ],
        spacing: { before: 200, after: 120 },
      })
    );

    model.scoringGuides.list.forEach((sg, sgIdx) => {
      docChildren.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `${sgIdx + 1}. ${sg.title} [Skor Maks: ${sg.maxScore ?? '-'}]`,
              bold: true,
              size: 20,
              font: 'Arial',
            }),
          ],
          spacing: { before: 60, after: 20 },
        })
      );
      if (sg.instructions) {
        docChildren.push(
          new Paragraph({
            children: [new TextRun({ text: sg.instructions, size: 19, font: 'Arial' })],
            spacing: { after: 40 },
          })
        );
      }
    });
    docChildren.push(new Paragraph({ spacing: { after: 240 } }));
  }

  // SECTION V: Rubrik Penilaian
  if (model.rubrics.list.length > 0) {
    docChildren.push(
      new Paragraph({
        children: [
          new TextRun({
            text: model.rubrics.title,
            bold: true,
            size: 22,
            font: 'Arial',
            color: '1E3A8A',
          }),
        ],
        spacing: { before: 200, after: 120 },
      })
    );

    model.rubrics.list.forEach((rub, rIdx) => {
      docChildren.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `${rIdx + 1}. ${rub.title}`,
              bold: true,
              size: 20,
              font: 'Arial',
            }),
          ],
          spacing: { before: 60, after: 60 },
        })
      );

      const numCols = rub.scale.length + 1;
      const critWidth = 30;
      const scaleWidth = Math.floor(70 / (rub.scale.length || 1));

      const headerCells: TableCell[] = [
        createTableHeaderCell('Kriteria Penilaian', critWidth, AlignmentType.LEFT),
        ...rub.scale.map((s) =>
          createTableHeaderCell(
            s.score !== undefined ? `${s.label} (${s.score})` : s.label,
            scaleWidth
          )
        ),
      ];

      const rubricTableRows = [
        new TableRow({ children: headerCells }),
        ...rub.criteria.map(
          (c) =>
            new TableRow({
              children: [
                createTableDataCell(
                  c.weight !== undefined ? `${c.label} — Bobot: ${c.weight}` : c.label,
                  critWidth,
                  AlignmentType.LEFT,
                  true
                ),
                ...c.descriptors.map((d) => createTableDataCell(d, scaleWidth)),
              ],
            })
        ),
      ];

      docChildren.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: rubricTableRows,
        })
      );
      docChildren.push(new Paragraph({ spacing: { after: 160 } }));
    });
  }

  // SECTION VI: Sign-off Block
  docChildren.push(new Paragraph({ spacing: { after: 200 } }));
  docChildren.push(
    ...createNormalizedAssessmentSignoffBlock(model.signoff)
  );

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 1440, // 1 inch
              bottom: 1440,
              left: 1440,
              right: 1440,
            },
          },
        },
        children: docChildren,
      },
    ],
  });

  return await Packer.toBlob(doc);
}

/**
 * PDF Renderer: Produces official PDF from normalized assessment document model.
 * Sibling renderer to renderAssessmentDocx; reads the exact same semantic model.
 */
export function renderAssessmentPdf(model: NormalizedAssessmentDocument): Blob {
  const isBlank = model.metadata.isBlankMode;

  const extraIdentityRows: [string, string][] = [];
  if (!isBlank && model.metadata.packageRevision !== undefined) {
    extraIdentityRows.push(['Nomor Revisi', `: Revisi ${model.metadata.packageRevision}`]);
  }
  if (model.metadata.formattedDocumentDate) {
    extraIdentityRows.push(['Tanggal Dokumen', `: ${model.metadata.formattedDocumentDate}`]);
  }

  const sections: PdfDocumentSection[] = [];

  // SECTION I: Kisi-Kisi
  sections.push({
    type: 'heading',
    text: model.kisiKisi.title,
    level: 2,
  });

  const kisiKisiCols: (string | PdfTableColumn)[] = [
    { header: 'No', dataKey: 'no', width: 10, align: 'center' },
    { header: 'Tujuan Pembelajaran / KD', dataKey: 'tp', width: 35, align: 'left' },
    { header: 'Indikator Asesmen', dataKey: 'indicator', width: 25, align: 'left' },
    { header: 'Materi / Lingkup', dataKey: 'material', width: 15, align: 'left' },
    { header: 'Bentuk', dataKey: 'instrumentType', width: 15, align: 'center' },
  ];

  const kisiKisiData = model.kisiKisi.rows.map((r) => [
    r.no,
    r.tpCodeAndStatement,
    r.indicator,
    r.material,
    r.instrumentType,
  ]);

  sections.push({
    type: 'table',
    columns: kisiKisiCols,
    rows: kisiKisiData,
  });

  // SECTION II: Instrumen Asesmen
  sections.push({
    type: 'heading',
    text: model.instruments.title,
    level: 2,
  });

  if (model.instruments.list.length === 0) {
    sections.push({
      type: 'paragraph',
      text: isBlank
        ? '(Kolom instrumen dapat dituliskan langsung oleh guru)'
        : 'Belum ada instrumen yang dimuat dalam paket ini.',
      color: [100, 116, 139],
    });
  }

  model.instruments.list.forEach((inst, instIdx) => {
    sections.push({
      type: 'paragraph',
      text: `${instIdx + 1}. [${inst.typeLabel}] ${inst.title || ''}`,
      bold: true,
      spacingAfter: 2,
    });

    if (inst.instructions) {
      sections.push({
        type: 'paragraph',
        text: `Petunjuk: ${inst.instructions}`,
        color: [71, 85, 105],
        spacingAfter: 3,
      });
    }

    if (inst.type === 'WRITTEN_TEST' && inst.writtenItems) {
      inst.writtenItems.forEach((it) => {
        if (it.stimulus) {
          sections.push({
            type: 'callout',
            title: 'Stimulus',
            text: it.stimulus,
          });
        }
        sections.push({
          type: 'paragraph',
          text: `${it.no}. ${it.prompt}`,
          bold: true,
          spacingAfter: 2,
        });

        if (it.options && it.options.length > 0) {
          it.options.forEach((opt) => {
            sections.push({
              type: 'paragraph',
              text: `    ${opt.label}. ${opt.text}`,
              spacingAfter: 1,
            });
          });
        }
      });
    } else if (inst.type === 'PERFORMANCE') {
      if (inst.task) {
        sections.push({
          type: 'paragraph',
          text: `Tugas Praktik/Kinerja: ${inst.task}`,
          bold: true,
          spacingAfter: 2,
        });
      }
      if (inst.performanceAspects && inst.performanceAspects.length > 0) {
        inst.performanceAspects.forEach((asp) => {
          let text = `• ${asp.label}${asp.description ? `: ${asp.description}` : ''}`;
          if (asp.weight !== undefined) {
            text += ` — Bobot: ${asp.weight}`;
          }
          sections.push({
            type: 'paragraph',
            text,
            spacingAfter: 1,
          });
        });
      }
    } else if (inst.type === 'ASSIGNMENT') {
      if (inst.expectedOutput) {
        sections.push({
          type: 'paragraph',
          text: `Hasil / Luaran: ${inst.expectedOutput}`,
          bold: true,
          spacingAfter: 2,
        });
      }
    } else if (inst.type === 'PROJECT') {
      if (inst.projectBrief) {
        sections.push({
          type: 'paragraph',
          text: `Deskripsi Proyek: ${inst.projectBrief}`,
          spacingAfter: 2,
        });
      }
      if (inst.expectedDeliverable) {
        sections.push({
          type: 'paragraph',
          text: `Luaran Proyek: ${inst.expectedDeliverable}`,
          bold: true,
          spacingAfter: 2,
        });
      }
    } else if (inst.type === 'PRODUCT') {
      if (inst.productBrief) {
        sections.push({
          type: 'paragraph',
          text: `Spesifikasi Produk: ${inst.productBrief}`,
          spacingAfter: 2,
        });
      }
      if (inst.expectedProduct) {
        sections.push({
          type: 'paragraph',
          text: `Produk / Hasil yang Diharapkan: ${inst.expectedProduct}`,
          bold: true,
          spacingAfter: 2,
        });
      }
    } else if (inst.type === 'PORTFOLIO') {
      if (inst.evidenceRequirements && inst.evidenceRequirements.length > 0) {
        sections.push({
          type: 'paragraph',
          text: 'Dokumen Bukti Karya:',
          bold: true,
          spacingAfter: 2,
        });
        inst.evidenceRequirements.forEach((ev) => {
          sections.push({
            type: 'paragraph',
            text: `• ${ev}`,
            spacingAfter: 1,
          });
        });
      }
    } else if (inst.type === 'OBSERVATION') {
      if (inst.recordingScheme) {
        sections.push({
          type: 'paragraph',
          text: `Skema Pencatatan: ${inst.recordingScheme}`,
          spacingAfter: 2,
        });
      }
      if (inst.observationAspects && inst.observationAspects.length > 0) {
        sections.push({
          type: 'table',
          columns: [
            { header: 'No', dataKey: 'no', width: 10, align: 'center' },
            { header: 'Aspek Pengamatan', dataKey: 'aspect', width: 45, align: 'left' },
            { header: 'Indikator', dataKey: 'indicator', width: 45, align: 'left' },
          ],
          rows: inst.observationAspects.map((asp, aIdx) => [
            aIdx + 1,
            asp.label,
            asp.indicator || '-',
          ]),
        });
      }
    } else if (inst.type === 'ORAL_TEST' && inst.oralItems) {
      inst.oralItems.forEach((it) => {
        sections.push({
          type: 'paragraph',
          text: `${it.no}. ${it.prompt}`,
          bold: true,
          spacingAfter: 2,
        });
      });
    } else if (
      (inst.type === 'SELF_ASSESSMENT' || inst.type === 'PEER_ASSESSMENT') &&
      inst.selfPeerItems
    ) {
      inst.selfPeerItems.forEach((it) => {
        const text = it.category ? `${it.no}. ${it.statement} — ${it.category}` : `${it.no}. ${it.statement}`;
        sections.push({
          type: 'paragraph',
          text,
          spacingAfter: 2,
        });
      });
    }
  });

  // SECTION III: Kunci Jawaban
  if (model.answerKeys.list.length > 0) {
    sections.push({
      type: 'heading',
      text: model.answerKeys.title,
      level: 2,
    });

    sections.push({
      type: 'table',
      columns: [
        { header: 'No. Butir', dataKey: 'itemNumber', width: 15, align: 'center' },
        { header: 'Tipe Kunci', dataKey: 'answerType', width: 25, align: 'center' },
        { header: 'Kunci Jawaban', dataKey: 'value', width: 35, align: 'left' },
        { header: 'Keterangan', dataKey: 'notes', width: 25, align: 'left' },
      ],
      rows: model.answerKeys.list.map((ak) => [
        ak.itemNumber || '-',
        ak.answerType,
        ak.value || '-',
        ak.notes || '-',
      ]),
    });
  }

  // SECTION IV: Pedoman Penskoran
  if (model.scoringGuides.list.length > 0) {
    sections.push({
      type: 'heading',
      text: model.scoringGuides.title,
      level: 2,
    });

    model.scoringGuides.list.forEach((sg, sgIdx) => {
      sections.push({
        type: 'paragraph',
        text: `${sgIdx + 1}. ${sg.title} [Skor Maks: ${sg.maxScore ?? '-'}]`,
        bold: true,
        spacingAfter: 1,
      });
      if (sg.instructions) {
        sections.push({
          type: 'paragraph',
          text: sg.instructions,
          spacingAfter: 2,
        });
      }
    });
  }

  // SECTION V: Rubrik Penilaian
  if (model.rubrics.list.length > 0) {
    sections.push({
      type: 'heading',
      text: model.rubrics.title,
      level: 2,
    });

    model.rubrics.list.forEach((rub, rIdx) => {
      sections.push({
        type: 'paragraph',
        text: `${rIdx + 1}. ${rub.title}`,
        bold: true,
        spacingAfter: 2,
      });

      const cols: (string | PdfTableColumn)[] = [
        { header: 'Kriteria Penilaian', dataKey: 'crit', width: 30, align: 'left' },
        ...rub.scale.map((s, sIdx) => ({
          header: s.score !== undefined ? `${s.label} (${s.score})` : s.label,
          dataKey: `scale_${sIdx}`,
          align: 'left' as const,
        })),
      ];

      const rows = rub.criteria.map((c) => [
        c.weight !== undefined ? `${c.label} — Bobot: ${c.weight}` : c.label,
        ...c.descriptors,
      ]);

      sections.push({
        type: 'table',
        columns: cols,
        rows,
      });
    });
  }

  const builder = new PdfDocumentBuilder('portrait');
  builder.renderHeader(model.metadata.title, model.metadata.subTitle);
  builder.renderNormalizedIdentityBlock(model.metadata, extraIdentityRows);

  for (const sec of sections) {
    if (sec.type === 'heading') {
      builder.renderHeading(sec.text, sec.level);
    } else if (sec.type === 'paragraph') {
      builder.renderParagraph(sec.text, {
        bold: sec.bold,
        align: sec.align,
        spacingAfter: sec.spacingAfter,
      });
    } else if (sec.type === 'callout') {
      builder.renderCallout(sec.text, sec.title);
    } else if (sec.type === 'table') {
      builder.renderTable(sec);
    }
  }

  builder.renderNormalizedSignatureBlock(model.signoff);

  return builder.getBlob();
}

/**
 * Generates an official, deterministic filename for exported assessment documents.
 */
export function generateAssessmentDocumentFileName(
  snapshot: AssessmentDocumentSnapshot,
  extension: 'docx' | 'pdf'
): string {
  const cleanSubject = (snapshot.subject || 'Asesmen').replace(/[^a-zA-Z0-9]/g, '_');
  const cleanGrade = (snapshot.grade || '').replace(/[^a-zA-Z0-9]/g, '');
  const gradeSuffix = cleanGrade ? `_Kelas_${cleanGrade}` : '';

  if (snapshot.mode === 'BLANK_TEMPLATE' || snapshot.documentMode === 'blank') {
    return `Format_Asesmen_${cleanSubject}${gradeSuffix}_Template.${extension}`;
  }

  if (!isValidAssessmentPackageRevision(snapshot.assessmentPackageRevision)) {
    throw new Error(
      `Gagal membuat nama file: Nomor revisi paket asesmen tidak valid (${snapshot.assessmentPackageRevision}).`
    );
  }

  return `Perangkat_Asesmen_${cleanSubject}${gradeSuffix}_Rev${snapshot.assessmentPackageRevision}.${extension}`;
}

/**
 * Unified DOCX assessment export orchestrator.
 */
export async function exportAssessmentDocx(
  context: DocumentGenerationContext,
  options?: AssessmentExportOptions
): Promise<{ blob: Blob; fileName: string; title: string; snapshot: AssessmentDocumentSnapshot }> {
  const snapshot = createAssessmentDocumentSnapshot(context, options);
  const model = buildNormalizedAssessmentDocumentModel(snapshot);
  const blob = await renderAssessmentDocx(model);
  const fileName = generateAssessmentDocumentFileName(snapshot, 'docx');

  return {
    blob,
    fileName,
    title: model.metadata.title,
    snapshot,
  };
}

/**
 * Unified PDF assessment export orchestrator.
 */
export async function exportAssessmentPdf(
  context: DocumentGenerationContext,
  options?: AssessmentExportOptions
): Promise<{ blob: Blob; fileName: string; title: string; snapshot: AssessmentDocumentSnapshot }> {
  const snapshot = createAssessmentDocumentSnapshot(context, options);
  const model = buildNormalizedAssessmentDocumentModel(snapshot);
  const blob = renderAssessmentPdf(model);
  const fileName = generateAssessmentDocumentFileName(snapshot, 'pdf');

  return {
    blob,
    fileName,
    title: model.metadata.title,
    snapshot,
  };
}
