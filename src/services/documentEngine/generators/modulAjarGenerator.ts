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
  HeadingLevel,
  BorderStyle,
} from 'docx';
import saveAs from 'file-saver';
import { DocumentGenerationContext, GeneratedDocumentResult } from '../types';
import {
  createDocumentHeader,
  createIdentityMetadataTable,
  createSignoffBlock,
} from '../docxStyles';
import { LearningPlan } from '../../../types';
import { validateLearningPlan, createEmptyLearningPlan } from '../../learningPlanService';
import { resolveCanonicalLearningPlan } from '../index';

/**
 * Pure Canonical Document Renderer for Modul Ajar / RPP.
 * Strictly adheres to:
 * - NO DATA > FAKE DATA
 * - ID > TEXT MATCH
 * - UNRESOLVED > GUESS
 * - VALIDATOR > AUTO SIAP
 * - AI OUTPUT = DRAFT
 */
export async function generateModulAjar(context: DocumentGenerationContext): Promise<GeneratedDocumentResult> {
  const { school, profile, academicSetting, tp, atp } = context;

  // 1. Resolve canonical LearningPlan
  let plan: LearningPlan | undefined = undefined;
  if (context.documentMode === 'blank') {
    plan = createEmptyLearningPlan({
      academicSetting,
      curriculumType: academicSetting.curriculum?.includes('2013') || academicSetting.curriculum?.includes('K13') ? 'K13' : 'KURIKULUM_MERDEKA',
      tpIds: [],
      atpItemIds: [],
      context: { tp, atp },
    });
  } else {
    const resolved = resolveCanonicalLearningPlan(context);
    if (resolved.error || !resolved.plan) {
      throw new Error(resolved.error || 'Rancangan Pembelajaran (LearningPlan) berstatus SIAP tidak ditemukan.');
    }
    plan = resolved.plan;
  }

  // 2. Validate Plan against active context
  const validation = validateLearningPlan(plan, {
    academicSetting,
    tp,
    atp,
    k13Analysis: context.k13Analysis,
    timeAllocations: context.timeAllocations,
    assessmentCriteria: context.assessmentCriteria,
  });

  // Strict Final Export Guard
  if (context.documentMode !== 'blank') {
    if (plan.status !== 'SIAP') {
      throw new Error(`Rancangan Pembelajaran (Modul Ajar) belum berstatus 'SIAP' (Status saat ini: '${plan.status}'). Silakan verifikasi dan konfirmasi SIAP terlebih dahulu.`);
    }
    if (!validation.valid) {
      throw new Error(`Rancangan Pembelajaran tidak valid untuk ekspor dokumen final: ${validation.errors.join('; ')}`);
    }
  }

  const isDraft = plan.status !== 'SIAP';
  const isBlankMode = context.documentMode === 'blank';

  const docChildren: (Paragraph | Table)[] = [];

  // Header with Draft indicator if not verified/SIAP
  const docTitle = isDraft
    ? `[DRAFT] MODUL AJAR / RPP BERDIFERENSIASI`
    : `MODUL AJAR / RPP BERDIFERENSIASI`;

  docChildren.push(
    ...createDocumentHeader(
      docTitle,
      `${academicSetting.curriculum || '-'} — ${academicSetting.grade || '-'} (${academicSetting.phase || '-'})`
    )
  );

  // Time / JP allocation resolution
  const timeAllocationDisplay =
    validation.resolvedAllocatedJP !== undefined
      ? `${validation.resolvedAllocatedJP} Jam Pelajaran (JP)`
      : typeof plan.allocatedJP === 'number'
      ? `${plan.allocatedJP} Jam Pelajaran (JP)`
      : 'Belum Ditetapkan';

  // Identity Table
  docChildren.push(
    createIdentityMetadataTable(school, profile, academicSetting, [
      ['Alokasi Waktu', `: ${timeAllocationDisplay}`],
      ['Status Dokumen', `: ${plan.status} (${plan.sourceType})`],
      ['Topik / Materi', `: ${plan.topic || plan.title || '-'}`],
    ])
  );
  docChildren.push(new Paragraph({ spacing: { after: 180 } }));

  // Section Builder Helper
  const addSectionTitle = (title: string) => {
    docChildren.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 180, after: 80 },
        children: [
          new TextRun({
            text: title,
            bold: true,
            size: 24, // 12pt
            font: 'Arial',
            color: '1E3A8A',
          }),
        ],
      })
    );
  };

  const addSubSection = (subTitle: string, content: string) => {
    docChildren.push(
      new Paragraph({
        spacing: { before: 80, after: 40 },
        children: [
          new TextRun({
            text: subTitle,
            bold: true,
            size: 20,
            font: 'Arial',
            color: '0F172A',
          }),
        ],
      }),
      new Paragraph({
        spacing: { after: 100 },
        children: [
          new TextRun({
            text: content,
            size: 19,
            font: 'Arial',
            color: '334155',
          }),
        ],
      })
    );
  };

  // Compile TP list strictly from canonical objectives / resolved TPs
  let tpListText = '-';
  if (plan.objectives && plan.objectives.length > 0) {
    tpListText = plan.objectives
      .map((obj, idx) => `${idx + 1}. ${obj.code ? `[${obj.code}] ` : ''}${obj.statement}${obj.materialScope ? ` (Materi: ${obj.materialScope})` : ''}`)
      .join('\n');
  } else if (validation.resolvedTPs.length > 0) {
    tpListText = validation.resolvedTPs
      .map((t, idx) => `${idx + 1}. ${t.code ? `[${t.code}] ` : ''}${t.statement}${t.materialScope ? ` (Materi: ${t.materialScope})` : ''}`)
      .join('\n');
  }

  // Compile Profil dimensions (prefer graduateProfileDimensions, backward compatible with p3Dimensions)
  const explicitDimensions =
    plan.graduateProfileDimensions && plan.graduateProfileDimensions.length > 0
      ? plan.graduateProfileDimensions
      : plan.p3Dimensions && plan.p3Dimensions.length > 0
      ? plan.p3Dimensions
      : [];
  const dimensionTitle = 'B. Dimensi Profil Lulusan';
  const dimensionsText = explicitDimensions.length > 0 ? explicitDimensions.join(', ') : '-';

  // I. INFORMASI UMUM
  addSectionTitle('I. INFORMASI UMUM');
  addSubSection('A. Kompetensi Awal', isBlankMode ? '........................................................' : (plan.initialCompetency || '-'));
  addSubSection(dimensionTitle, isBlankMode ? '........................................................' : dimensionsText);

  // Resources
  const resourcesText =
    plan.resources && plan.resources.length > 0
      ? plan.resources.map((r, i) => `${i + 1}. ${r.title}${r.source ? ` (${r.source})` : ''}`).join('\n')
      : '-';
  addSubSection('C. Sarana dan Prasarana', isBlankMode ? '........................................................' : resourcesText);

  // Students count
  const studentCountText = context.students?.length !== undefined ? `${context.students.length} Murid` : '-';
  const targetStudentsFull = `Jumlah Murid: ${studentCountText}${plan.targetStudents ? `\nTarget/Karakteristik: ${plan.targetStudents}` : ''}`;
  addSubSection('D. Target Murid', isBlankMode ? 'Jumlah Murid: ..........\nKarakteristik: ........................................................' : targetStudentsFull);

  addSubSection('E. Model Pembelajaran', isBlankMode ? '........................................................' : (plan.learningModel || '-'));

  // II. KOMPONEN INTI
  addSectionTitle('II. KOMPONEN INTI');
  addSubSection('A. Tujuan Pembelajaran (TP)', isBlankMode ? '........................................................................................................................' : tpListText);
  addSubSection('B. Pemahaman Bermakna', isBlankMode ? '........................................................................................................................' : (plan.meaningfulUnderstanding || '-'));

  const triggerQuestionsText =
    plan.triggerQuestions && plan.triggerQuestions.length > 0
      ? plan.triggerQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n')
      : '-';
  addSubSection('C. Pertanyaan Pemantik', isBlankMode ? '........................................................................................................................' : triggerQuestionsText);

  // III. KEGIATAN / PENGALAMAN PEMBELAJARAN
  const experiences = plan.learningExperiences || [];
  const openingSteps = plan.learningSteps?.opening || [];
  const coreSteps = plan.learningSteps?.core || [];
  const closingSteps = plan.learningSteps?.closing || [];

  if (experiences.length > 0) {
    addSectionTitle('III. PENGALAMAN BELAJAR');

    const formatExpGroup = (phase: 'UNDERSTAND' | 'APPLY' | 'REFLECT', label: string) => {
      const filtered = experiences.filter((e) => e.phase === phase);
      if (isBlankMode) {
        return `${label}:\n........................................................................................................................`;
      }
      if (filtered.length === 0) {
        return `${label}: -`;
      }
      return `${label}:\n${filtered
        .map(
          (e) =>
            `• ${e.description}${typeof e.durationMinutes === 'number' && e.durationMinutes > 0 ? ` (${e.durationMinutes} Menit)` : ''}`
        )
        .join('\n')}`;
    };

    addSubSection('A. Memahami', formatExpGroup('UNDERSTAND', 'Memahami'));
    addSubSection('B. Mengaplikasi', formatExpGroup('APPLY', 'Mengaplikasi'));
    addSubSection('C. Merefleksi', formatExpGroup('REFLECT', 'Merefleksi'));
  } else {
    addSectionTitle('III. KEGIATAN PEMBELAJARAN');

    const formatStepGroup = (label: string, steps: typeof openingSteps) => {
      if (isBlankMode) {
        return `${label}:\n........................................................................................................................`;
      }
      if (steps.length === 0) {
        return `${label}: -`;
      }
      return `${label}:\n${steps
        .map(
          (s, i) =>
            `• ${s.title ? `[${s.title}] ` : ''}${s.description}${typeof s.durationMinutes === 'number' && s.durationMinutes > 0 ? ` (${s.durationMinutes} Menit)` : ''}`
        )
        .join('\n')}`;
    };

    addSubSection('A. Kegiatan Pendahuluan', formatStepGroup('Kegiatan Pendahuluan', openingSteps));
    addSubSection('B. Kegiatan Inti', formatStepGroup('Kegiatan Inti', coreSteps));
    addSubSection('C. Kegiatan Penutup', formatStepGroup('Kegiatan Penutup', closingSteps));
  }

  if (plan.differentiation) {
    const diffText = [
      plan.differentiation.content ? `• Diferensiasi Konten: ${plan.differentiation.content}` : '',
      plan.differentiation.process ? `• Diferensiasi Proses: ${plan.differentiation.process}` : '',
      plan.differentiation.product ? `• Diferensiasi Produk: ${plan.differentiation.product}` : '',
      plan.differentiation.notes ? `• Catatan: ${plan.differentiation.notes}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    if (diffText) {
      addSubSection('D. Rencana Pembelajaran Berdiferensiasi', diffText);
    }
  }

  // IV. ASESMEN PEMBELAJARAN
  addSectionTitle('IV. ASESMEN PEMBELAJARAN');

  const formatAssessmentGroup = (label: string, items?: typeof plan.assessmentPlan.initial) => {
    if (isBlankMode) return `${label}:\n........................................................................................................................`;
    if (!items || items.length === 0) return `${label}: -`;
    return `${label}:\n${items
      .map(
        (a, i) =>
          `• ${a.description || a.method || a.technique || 'Asesmen'}${a.technique ? ` (Teknik: ${a.technique})` : ''}${a.instrument ? ` (Instrumen: ${a.instrument})` : ''}`
      )
      .join('\n')}`;
  };

  addSubSection('A. Asesmen Awal (Diagnostik)', formatAssessmentGroup('Asesmen Awal', plan.assessmentPlan?.initial));
  addSubSection('B. Asesmen Formatif', formatAssessmentGroup('Asesmen Formatif', plan.assessmentPlan?.formative));
  addSubSection('C. Asesmen Sumatif', formatAssessmentGroup('Asesmen Sumatif', plan.assessmentPlan?.summative));

  // V. PENGAYAAN DAN REMEDIAL (Planning only)
  addSectionTitle('V. PENGAYAAN DAN REMEDIAL');
  addSubSection('A. Rencana Pengayaan', isBlankMode ? '........................................................' : (plan.enrichmentPlan || '-'));
  addSubSection('B. Rencana Remedial', isBlankMode ? '........................................................' : (plan.remedialPlan || '-'));

  // VI. REFLEKSI
  if (plan.reflection?.teacherReflection || plan.reflection?.studentReflection || isBlankMode) {
    addSectionTitle('VI. REFLEKSI');
    if (plan.reflection?.teacherReflection || isBlankMode) {
      addSubSection('A. Refleksi Guru', isBlankMode ? '........................................................' : (plan.reflection?.teacherReflection || '-'));
    }
    if (plan.reflection?.studentReflection || isBlankMode) {
      addSubSection('B. Refleksi Peserta Didik', isBlankMode ? '........................................................' : (plan.reflection?.studentReflection || '-'));
    }
  }

  // Signoff Block
  docChildren.push(...createSignoffBlock(school, profile));

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 1440,
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

  const blob = await Packer.toBlob(doc);
  const cleanSubject = (academicSetting.subject || 'Mapel').replace(/[^a-zA-Z0-9]/g, '_');
  const cleanGrade = (academicSetting.grade || 'Kelas').replace(/[^a-zA-Z0-9]/g, '_');
  const fileName = `MODUL_AJAR_${cleanSubject}_${cleanGrade}_${new Date().toISOString().slice(0, 10)}.docx`;

  if (!context.skipDownload) {
    saveAs(blob, fileName);
  }

  return {
    success: true,
    type: 'MODUL_AJAR',
    title: docTitle,
    fileName,
    blob,
    document: doc,
    record: {
      id: `doc-modul-${Date.now()}`,
      type: 'MODUL_AJAR',
      title: docTitle,
      status: 'completed',
      lastGenerated: new Date().toISOString(),
      fileName,
      academicSettingId: academicSetting.id,
      workspaceId: context.workspace?.id,
    },
  };
}
