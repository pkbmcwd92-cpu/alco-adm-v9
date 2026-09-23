import React, { useState, useEffect, useRef } from 'react';
import {
  FileText,
  Plus,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  FolderPlus,
  FileSpreadsheet,
  ListOrdered,
  HelpCircle,
  Sparkles,
  ChevronRight,
  ShieldCheck,
  Edit2,
  Save,
  Layers,
  BookOpen,
} from 'lucide-react';
import {
  SchoolData,
  TeacherProfile,
  AcademicSetting,
  AdministrationWorkspace,
  TPData,
  K13Analysis,
  AssessmentCriterion,
  AssessmentPlan,
  AssessmentPackage,
  AssessmentBlueprintItem,
  AssessmentInstrument,
  WrittenAssessmentInstrument,
  WrittenAssessmentItem,
  WrittenAssessmentOption,
  OralAssessmentInstrument,
  PerformanceAssessmentInstrument,
  ObservationAssessmentInstrument,
  AssignmentAssessmentInstrument,
  ProjectAssessmentInstrument,
  ProductAssessmentInstrument,
  PortfolioAssessmentInstrument,
  SelfPeerAssessmentInstrument,
  AssessmentAnswerKey,
  AssessmentScoringGuide,
  AssessmentRubric,
  RubricCriterion,
  RubricScaleLevel,
  AssessmentInstrumentType,
  MatchingAssessmentEntry,
  MatchingAssessmentPair,
  CategoryResponseStatement,
  CategoryResponseCategory,
  AssessmentRegenerationTarget,
} from '../../types';
import {
  createEmptyAssessmentPackage,
  validateAssessmentPackage,
  confirmAssessmentPackage,
  canConfirmAssessmentPackage,
} from '../../services/assessmentPackageService';
import { isK13, isMerdeka } from '../../services/curriculumRouter';
import { resolveAssessmentGenerationUIState } from '../../services/assessmentGenerationUIStateResolver';
import { resolveAssessmentGenerationSpec } from '../../services/assessmentGenerationSpecService';
import { resolveAssessmentGenerationPlan } from '../../services/assessmentGenerationPlanService';
import { generateAssessmentPackageDraft } from '../../services/assessmentPackageGeneratorService';
import { assessmentRegenerationService } from '../../services/assessmentRegenerationService';
import { assessmentRegenerationEligibilityService } from '../../services/assessmentRegenerationEligibilityService';
import { validateGeneratedAssessment } from '../../services/assessmentValidationService';
import { exportAssessmentDocx, exportAssessmentPdf } from '../../services/documentEngine/assessmentExportService';
import { DocumentGenerationContext } from '../../services/documentEngine/types';
import { RefreshCw, AlertOctagon, Info, Printer } from 'lucide-react';

interface AssessmentPackageBuilderProps {
  school: SchoolData;
  profile: TeacherProfile;
  academicSetting: AcademicSetting;
  workspace?: AdministrationWorkspace;
  tp?: TPData;
  k13Analysis?: K13Analysis;
  assessmentCriteria?: AssessmentCriterion[];
  assessmentPlans?: AssessmentPlan[];
  assessmentPackages?: AssessmentPackage[];
  onSaveAssessmentPackage: (pkg: AssessmentPackage) => void;
  onDeleteAssessmentPackage?: (pkgId: string) => void;
}

export const AssessmentPackageBuilder: React.FC<AssessmentPackageBuilderProps> = ({
  school,
  profile,
  academicSetting,
  workspace,
  tp,
  k13Analysis,
  assessmentCriteria = [],
  assessmentPlans = [],
  assessmentPackages = [],
  onSaveAssessmentPackage,
  onDeleteAssessmentPackage,
}) => {
  const readyPlans = assessmentPlans.filter((p) => p.workflowStatus === 'SIAP' && p.needsReview !== true);

  const [selectedPlanId, setSelectedPlanId] = useState<string>('');

  // Ref for authoritative current-package lookup (Blocker 4)
  const latestPackagesRef = useRef(assessmentPackages);
  useEffect(() => {
    latestPackagesRef.current = assessmentPackages;
  }, [assessmentPackages]);

  const [activeTab, setActiveTab] = useState<'overview' | 'blueprint' | 'instruments' | 'keys_rubrics' | 'validation'>('overview');
  const [activeInstType, setActiveInstType] = useState<AssessmentInstrumentType | ''>('');

  // 9C.7 AI Generation & Validation State
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [isRegenerating, setIsRegenerating] = useState<boolean>(false);
  const [isValidating, setIsValidating] = useState<boolean>(false);
  const [isExportingDocx, setIsExportingDocx] = useState<boolean>(false);
  const [isExportingPdf, setIsExportingPdf] = useState<boolean>(false);
  const [validationReport, setValidationReport] = useState<any>(null);
  const [generationError, setGenerationError] = useState<string | null>(null);

  const selectedPlan = assessmentPlans.find((p) => p.id === selectedPlanId);
  const activePackage = assessmentPackages.find((pkg) => pkg.assessmentPlanId === selectedPlanId);

  useEffect(() => {
    setValidationReport(null);
  }, [activePackage?.id]);

  const validationContext = {
    academicSetting,
    assessmentPlan: selectedPlan,
    tp,
    k13Analysis,
    assessmentCriteria,
  };

  const confirmationEligible = activePackage
    ? canConfirmAssessmentPackage(activePackage, validationContext).eligible
    : false;

  // Deterministic state machine resolver
  const uiState = resolveAssessmentGenerationUIState({
    selectedPlanId,
    assessmentPlan: selectedPlan,
    activePackage,
    isGenerating,
    isRegenerating,
    isValidating,
    academicSetting,
    tp,
    k13Analysis,
    assessmentCriteria,
    validationReport,
    confirmationEligible,
  });

  // Synchronize active instrument tab
  useEffect(() => {
    if (selectedPlan && selectedPlan.instruments.length > 0) {
      if (!activeInstType || !selectedPlan.instruments.some((i) => i.type === activeInstType)) {
        setActiveInstType(selectedPlan.instruments[0].type);
      }
    }
  }, [selectedPlan, activeInstType]);

  const validationResult = activePackage
    ? validateAssessmentPackage(activePackage, validationContext)
    : { valid: false, errors: ['Belum ada Perangkat Asesmen.'], warnings: [] };

  // Helper to handle creation of new empty package
  const handleCreatePackage = () => {
    if (!selectedPlan || selectedPlan.workflowStatus !== 'SIAP' || selectedPlan.needsReview) return;
    const newPkg = createEmptyAssessmentPackage(selectedPlan, academicSetting.id, workspace?.id);
    onSaveAssessmentPackage(newPkg);
    setValidationReport(null);
  };

  // Helper to update active package with centralized manual edit logic and field-level provenance tracking (Blocker 5)
  const updatePackage = (updated: AssessmentPackage) => {
    if (!activePackage) return;

    // 1. Clone package
    const pkgCopy = JSON.parse(JSON.stringify(updated)) as AssessmentPackage;

    // 2. Intelligently detect what changed between activePackage and updated to add/merge field-level provenance
    if (activePackage.title !== updated.title) {
      (pkgCopy as any).provenance = (pkgCopy as any).provenance || {};
      (pkgCopy as any).provenance.fields = (pkgCopy as any).provenance.fields || {};
      (pkgCopy as any).provenance.fields['title'] = 'TEACHER_EDITED';
    }
    // Detect changed instruments
    pkgCopy.instruments.forEach((inst: any) => {
      const oldInst = activePackage.instruments.find((i) => i.id === inst.id);
      if (oldInst) {
        inst.provenance = JSON.parse(JSON.stringify((oldInst as any).provenance || {}));
        const fieldsToCheck = ['task', 'instructions', 'expectedOutput', 'projectBrief', 'productBrief'];
        fieldsToCheck.forEach((f) => {
          if (inst[f] !== (oldInst as any)[f]) {
            inst.provenance = inst.provenance || {};
            inst.provenance.fields = inst.provenance.fields || {};
            inst.provenance.fields[f] = 'TEACHER_EDITED';
          }
        });
        // If it's a written instrument, check written items too
        if (inst.type === 'WRITTEN_TEST') {
          const wr = inst as WrittenAssessmentInstrument;
          const oldWr = oldInst as WrittenAssessmentInstrument;
          wr.items?.forEach((item: any) => {
            const oldItem = oldWr.items?.find((oi) => oi.id === item.id);
            if (oldItem) {
              item.provenance = JSON.parse(JSON.stringify((oldItem as any).provenance || {}));
              if (item.prompt !== oldItem.prompt) {
                item.provenance = item.provenance || {};
                item.provenance.fields = item.provenance.fields || {};
                item.provenance.fields['prompt'] = 'TEACHER_EDITED';
              }
              if (JSON.stringify(item.options) !== JSON.stringify(oldItem.options)) {
                item.provenance = item.provenance || {};
                item.provenance.fields = item.provenance.fields || {};
                item.provenance.fields['options'] = 'TEACHER_EDITED';
              }
              if (item.stimulus !== oldItem.stimulus) {
                item.provenance = item.provenance || {};
                item.provenance.fields = item.provenance.fields || {};
                item.provenance.fields['stimulus'] = 'TEACHER_EDITED';
              }
            }
          });
        }
      }
    });
    // Detect changed rubrics
    pkgCopy.rubrics.forEach((rub: any) => {
      const oldRub = activePackage.rubrics.find((r) => r.id === rub.id);
      if (oldRub) {
        rub.provenance = JSON.parse(JSON.stringify((oldRub as any).provenance || {}));
        const fieldsToCheck = ['title', 'criteria', 'scale'];
        fieldsToCheck.forEach((f) => {
          if (JSON.stringify(rub[f]) !== JSON.stringify((oldRub as any)[f])) {
            rub.provenance = rub.provenance || {};
            rub.provenance.fields = rub.provenance.fields || {};
            rub.provenance.fields[f] = 'TEACHER_EDITED';
          }
        });
      }
    });
    // Detect changed blueprintItems
    pkgCopy.blueprintItems.forEach((bp: any) => {
      const oldBp = activePackage.blueprintItems.find((b) => b.id === bp.id);
      if (oldBp) {
        bp.provenance = JSON.parse(JSON.stringify((oldBp as any).provenance || {}));
        const fieldsToCheck = ['assessmentIndicator', 'materialOrContext'];
        fieldsToCheck.forEach((f) => {
          if (bp[f] !== (oldBp as any)[f]) {
            bp.provenance = bp.provenance || {};
            bp.provenance.fields = bp.provenance.fields || {};
            bp.provenance.fields[f] = 'TEACHER_EDITED';
          }
        });
      }
    });
    // Detect changed answerKeys
    pkgCopy.answerKeys.forEach((ak: any) => {
      const oldAk = activePackage.answerKeys.find((k) => k.id === ak.id);
      if (oldAk) {
        ak.provenance = JSON.parse(JSON.stringify((oldAk as any).provenance || {}));
        const fieldsToCheck = ['value', 'answer', 'optionIds', 'matchingPairs', 'categoryAnswers'];
        fieldsToCheck.forEach((f) => {
          if (JSON.stringify(ak[f]) !== JSON.stringify((oldAk as any)[f])) {
            ak.provenance = ak.provenance || {};
            ak.provenance.fields = ak.provenance.fields || {};
            ak.provenance.fields[f] = 'TEACHER_EDITED';
          }
        });
      }
    });

    // 3. Mark package level attributes: revert to DRAFT, needs review, update timestamp, increment revision
    pkgCopy.workflowStatus = 'DRAFT';
    pkgCopy.needsReview = true;
    pkgCopy.revision = (activePackage.revision ?? 1) + 1;
    pkgCopy.updatedAt = new Date().toISOString();

    // 4. Invalidate validation state in UI
    setValidationReport(null);

    // 5. Persist
    onSaveAssessmentPackage(pkgCopy);
  };

  // 9C.7 Auto Generate First Integration
  const handleAutoGeneratePackage = async () => {
    if (!selectedPlan) return;
    setIsGenerating(true);
    setGenerationError(null);

    try {
      // 1. Resolve Generation Spec
      const spec = resolveAssessmentGenerationSpec({
        assessmentPlan: selectedPlan,
        academicSetting,
        tp,
        k13Analysis,
        assessmentCriteria,
      });

      // 2. Resolve Generation Plan
      const genPlan = resolveAssessmentGenerationPlan({
        generationSpec: spec,
      });

      // 3. Inject standard provider calling the backend proxy endpoint
      const provider = {
        generate: async (request: any) => {
          const res = await fetch('/api/ai/generate-assessment-package', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              systemPrompt: request.systemPrompt,
              userPrompt: request.userPrompt,
            }),
          });
          if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.error || `Gagal menghubungi AI (Status ${res.status})`);
          }
          const data = await res.json();
          return { rawText: data.rawText };
        },
      };

      // 4. Generate the draft using canonical Generator Service
      const result = await generateAssessmentPackageDraft({
        generationPlan: genPlan,
        academicSettingId: academicSetting.id,
        provider,
      });

      if (result.status === 'GENERATED' || result.status === 'PARTIAL') {
        if (result.generatedPackage) {
          // Set parent workspace ID if available
          if (workspace?.id) {
            result.generatedPackage.workspaceId = workspace.id;
          }
          onSaveAssessmentPackage(result.generatedPackage);
          setValidationReport(null);
        } else {
          throw new Error('AI menghasilkan paket kosong.');
        }
      } else {
        const issuesMsg = result.issues.map((i) => i.message).join(', ');
        throw new Error(issuesMsg || 'AI gagal menyusun draf perangkat.');
      }
    } catch (err: any) {
      console.error('Auto generate package error:', err);
      setGenerationError(err.message || 'Terjadi kesalahan saat generate draf perangkat.');
    } finally {
      setIsGenerating(false);
    }
  };

  // 9C.7 Comprehensive Validation Integration
  const handleValidatePackage = async () => {
    if (!activePackage || !selectedPlan) return;
    setIsValidating(true);
    setGenerationError(null);

    try {
      const spec = resolveAssessmentGenerationSpec({
        assessmentPlan: selectedPlan,
        academicSetting,
        tp,
        k13Analysis,
        assessmentCriteria,
      });

      const genPlan = resolveAssessmentGenerationPlan({
        generationSpec: spec,
      });

      const report = await validateGeneratedAssessment({
        assessmentPackage: activePackage,
        generationPlan: genPlan,
        validationContext,
        gradeCalibration: spec.generationProfile?.gradeCalibration,
        subjectProfile: spec.subjectProfile,
      });

      setValidationReport(report);
    } catch (err: any) {
      console.error('Validation error:', err);
      setGenerationError(err.message || 'Terjadi kesalahan saat validasi perangkat.');
    } finally {
      setIsValidating(false);
    }
  };

  // 9C.7 Granular Regeneration Integration
  const handleRegenerateTarget = async (
    target: AssessmentRegenerationTarget,
    targetId: string,
    explicitOverride: boolean = false,
    locator?: import('../../types').AssessmentRegenerationLocator
  ) => {
    if (!activePackage || !selectedPlan) return;
    setIsRegenerating(true);
    setGenerationError(null);

    try {
      const request = {
        packageId: activePackage.id,
        expectedPackageRevision: activePackage.revision ?? 1,
        target,
        targetId,
        locator,
        explicitTeacherOverride: explicitOverride,
      };

      const spec = resolveAssessmentGenerationSpec({
        assessmentPlan: selectedPlan,
        academicSetting,
        tp,
        k13Analysis,
        assessmentCriteria,
      });

      const provider = {
        regenerate: async (contract: any) => {
          const res = await fetch('/api/ai/regenerate-assessment-target', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contract }),
          });
          if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.error || `HTTP error ${res.status}`);
          }
          const data = await res.json();
          return data.data;
        },
      };

      const extra = {
        gradeCalibration: spec.generationProfile?.gradeCalibration,
        subjectProfile: spec.subjectProfile,
        validationFindings: validationReport ? [
          ...(validationReport.structural?.findings || []),
          ...(validationReport.coverage?.findings || []),
          ...(validationReport.answerVerification?.findings || []),
          ...(validationReport.quality?.findings || []),
          ...(validationReport.assembly?.findings || []),
        ] : [],
        getCurrentPackageRevision: () => {
          const current = latestPackagesRef.current.find(
            pkg => pkg.id === request.packageId
          );
          return current?.revision;
        },
      };

      const result = await assessmentRegenerationService.regenerate(
        activePackage,
        request,
        provider,
        extra
      );

      if (result.status === 'REGENERATED') {
        if (result.regeneratedPackage) {
          onSaveAssessmentPackage(result.regeneratedPackage);
          // Auto reset validation to force re-evaluation
          setValidationReport(null);
        }
      } else if (result.status === 'TEACHER_EDIT_PROTECTED') {
        const confirmOverwrite = window.confirm(
          'Perhatian: Komponen ini telah Anda edit secara manual. Apakah Anda yakin ingin menimpa (overwrite) perubahan Anda dengan hasil generasi baru dari AI?'
        );
        if (confirmOverwrite) {
          await handleRegenerateTarget(target, targetId, true, locator);
        }
      } else {
        const msg = result.issues?.join(', ') || 'Gagal melakukan regenerasi granular.';
        throw new Error(msg);
      }
    } catch (err: any) {
      console.error('Granular regeneration error:', err);
      setGenerationError(err.message || 'Terjadi kesalahan saat regenerasi granular.');
    } finally {
      setIsRegenerating(false);
    }
  };

  // 9C.8 Document / Export Integration
  const handleExportDocx = async () => {
    if (!activePackage || activePackage.workflowStatus !== 'SIAP') return;
    setIsExportingDocx(true);
    setGenerationError(null);
    try {
      const context: DocumentGenerationContext = {
        school,
        profile,
        academicSetting,
        workspace,
        tp,
        k13Analysis,
        assessmentCriteria,
        assessmentPlans,
        assessmentPackages,
        activeAssessmentPackageId: activePackage.id,
        documentMode: 'data',
      };
      await exportAssessmentDocx(context, { documentMode: 'data' });
    } catch (err: any) {
      console.error('Export DOCX error:', err);
      setGenerationError(err.message || 'Gagal mengekspor dokumen Word (.docx).');
    } finally {
      setIsExportingDocx(false);
    }
  };

  const handleExportPdf = async () => {
    if (!activePackage || activePackage.workflowStatus !== 'SIAP') return;
    setIsExportingPdf(true);
    setGenerationError(null);
    try {
      const context: DocumentGenerationContext = {
        school,
        profile,
        academicSetting,
        workspace,
        tp,
        k13Analysis,
        assessmentCriteria,
        assessmentPlans,
        assessmentPackages,
        activeAssessmentPackageId: activePackage.id,
        documentMode: 'data',
      };
      await exportAssessmentPdf(context, { documentMode: 'data' });
    } catch (err: any) {
      console.error('Export PDF error:', err);
      setGenerationError(err.message || 'Gagal mencetak dokumen PDF.');
    } finally {
      setIsExportingPdf(false);
    }
  };

  // If no AssessmentPlans exist with SIAP status
  if (readyPlans.length === 0) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8 text-center max-w-2xl mx-auto my-8">
        <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
          <BookOpen className="w-8 h-8" />
        </div>
        <h3 className="text-xl font-bold text-slate-800 mb-2">Rencana asesmen perlu direview dan disiapkan terlebih dahulu.</h3>
        <p className="text-slate-600 mb-6 text-sm">
          Perangkat Asesmen hanya dapat dibuat dari Rencana Asesmen yang telah dikonfirmasi berstatus <strong>SIAP</strong>. Silakan tinjau dan siapkan rencana asesmen terlebih dahulu di tab <strong>Rencana Asesmen</strong>.
        </p>
        {assessmentPlans.length > 0 ? (
          <div className="space-y-2">
            <p className="text-xs text-amber-700 bg-amber-50 p-2.5 rounded-lg border border-amber-200 inline-block font-medium">
              Terdapat {assessmentPlans.length} Rencana Asesmen yang masih berstatus DRAFT atau belum SIAP.
            </p>
            <p className="text-xs text-slate-500">
              Buka tab <strong>Rencana Asesmen</strong> untuk meninjau instrumen dan kriteria ketercapaian, lalu klik <strong>Konfirmasi SIAP</strong>.
            </p>
          </div>
        ) : (
          <p className="text-xs text-slate-500">
            Belum ada rencana asesmen. Silakan buka tab <strong>Rencana Asesmen</strong> untuk membuat atau meng-generate draf rencana asesmen secara otomatis.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Plan Selector Header */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
            Pilih Rencana Asesmen Induk (Parent Plan)
          </label>
          <select
            value={selectedPlanId}
            onChange={(e) => setSelectedPlanId(e.target.value)}
            className="w-full md:w-96 px-3 py-2 border border-slate-300 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium text-sm"
          >
            <option value="">-- Pilih Rencana Asesmen --</option>
            {assessmentPlans.map((plan) => {
              const isReady = plan.workflowStatus === 'SIAP' && plan.needsReview !== true;
              return (
                <option key={plan.id} value={plan.id} disabled={!isReady}>
                  {plan.displayLabel || plan.title} [{plan.workflowStatus}]{!isReady ? ' - (Belum SIAP)' : ''}
                </option>
              );
            })}
          </select>
        </div>

        {activePackage && (
          <div className="flex items-center gap-3">
            <span
              className={`px-3 py-1 rounded-full text-xs font-bold tracking-wide uppercase ${
                activePackage.workflowStatus === 'SIAP'
                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                  : activePackage.workflowStatus === 'PERLU_DILENGKAPI'
                  ? 'bg-amber-100 text-amber-800 border border-amber-300'
                  : 'bg-slate-100 text-slate-700 border border-slate-300'
              }`}
            >
              Status: {activePackage.workflowStatus}
            </span>
          </div>
        )}
      </div>

      {/* Review Reason Alert */}
      {activePackage?.needsReview && activePackage.reviewReason && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 p-4 rounded-xl flex items-start gap-3 text-sm">
          <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div>
            <span className="font-bold">Perlu Review / Penyesuaian:</span> {activePackage.reviewReason}
          </div>
        </div>
      )}

      {/* UI State Driven Layouts */}
      {uiState === 'NO_PLAN' ? (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center max-w-xl mx-auto shadow-sm">
          <BookOpen className="w-12 h-12 text-slate-400 mx-auto mb-3" />
          <h4 className="text-lg font-bold text-slate-800 mb-2">Pilih Rencana Asesmen</h4>
          <p className="text-slate-600 text-sm">
            Silakan pilih salah satu Rencana Asesmen berstatus <strong>SIAP</strong> pada dropdown di atas untuk melihat atau menyusun Perangkat Asesmen.
          </p>
        </div>
      ) : uiState === 'GENERATION_BLOCKED' ? (
        <div className="bg-red-50 border border-red-200 text-red-800 p-6 rounded-xl text-center max-w-xl mx-auto shadow-sm">
          <AlertOctagon className="w-12 h-12 text-red-600 mx-auto mb-3" />
          <h4 className="text-lg font-bold mb-2">Generasi AI Diblokir</h4>
          <p className="text-sm text-red-700">
            Beberapa kelengkapan data kurikulum atau kriteria asesmen belum dikonfigurasi secara lengkap untuk rencana ini. Silakan lengkapi data TP/KD atau kriteria di tab sebelumnya.
          </p>
        </div>
      ) : uiState === 'READY_TO_GENERATE' ? (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center max-w-2xl mx-auto space-y-6 shadow-sm">
          <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mx-auto">
            <Sparkles className="w-8 h-8" />
          </div>
          <div>
            <h4 className="text-xl font-bold text-slate-800 mb-2">Rancang Perangkat Asesmen Berbasis AI</h4>
            <p className="text-slate-600 text-sm max-w-md mx-auto">
              Rencana Asesmen "{selectedPlan?.displayLabel || selectedPlan?.title}" siap disusun. AI akan merumuskan kisi-kisi, merancang instrumen soal/tugas, menyusun kunci jawaban, serta membuat pedoman penilaian secara otomatis dan presisi sesuai kaidah kurikulum.
            </p>
          </div>

          {generationError && (
            <div className="bg-red-50 border border-red-200 text-red-800 text-xs p-3 rounded-lg text-left max-w-md mx-auto flex items-start gap-2">
              <AlertOctagon className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
              <span>{generationError}</span>
            </div>
          )}

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <button
              onClick={handleAutoGeneratePackage}
              className="w-full sm:w-auto px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold text-sm inline-flex items-center justify-center gap-2 shadow-md transition-all transform hover:scale-[1.01]"
            >
              <Sparkles className="w-4 h-4" />
              Buat Perangkat Asesmen
            </button>

            <button
              onClick={handleCreatePackage}
              className="w-full sm:w-auto px-5 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-semibold text-sm inline-flex items-center justify-center gap-2 transition"
            >
              Mulai Manual
            </button>
          </div>
        </div>
      ) : uiState === 'GENERATING' ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center max-w-xl mx-auto space-y-4 shadow-sm">
          <RefreshCw className="w-10 h-10 text-blue-600 animate-spin mx-auto" />
          <h4 className="text-lg font-bold text-slate-800">Menyusun Perangkat Asesmen...</h4>
          <p className="text-slate-600 text-sm max-w-xs mx-auto">
            AI sedang merumuskan indikator asesmen, merancang draf soal instrumen, dan memetakan rubrik kriteria penilaian berdasarkan rencana Anda. Proses ini membutuhkan beberapa detik.
          </p>
        </div>
      ) : uiState === 'REGENERATING_TARGET' ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center max-w-xl mx-auto space-y-4 shadow-sm">
          <RefreshCw className="w-10 h-10 text-blue-600 animate-spin mx-auto" />
          <h4 className="text-lg font-bold text-slate-800">Melakukan Regenerasi Granular...</h4>
          <p className="text-slate-600 text-sm max-w-xs mx-auto">
            AI sedang memperbarui elemen terpilih berdasarkan instruksi dan data pendukung secara aman dan bertahap. Mohon tunggu sebentar.
          </p>
        </div>
      ) : uiState === 'FINAL_VALIDATION' ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center max-w-xl mx-auto space-y-4 shadow-sm">
          <RefreshCw className="w-10 h-10 text-blue-600 animate-spin mx-auto" />
          <h4 className="text-lg font-bold text-slate-800">Menjalankan Pengujian Kualitas & Validasi...</h4>
          <p className="text-slate-600 text-sm max-w-xs mx-auto">
            Sistem sedang memeriksa keselarasan draf perangkat dengan standar kurikulum kanonikal serta verifikasi kunci jawaban secara deterministik.
          </p>
        </div>
      ) : (
        /* Package Editor Active (DRAFT_REVIEW, READY_FOR_CONFIRMATION, SIAP) */
        <div className="space-y-6">
          {/* Validation Banner at the top of workspace */}
          {uiState === 'DRAFT_REVIEW' && (
            <div className="bg-blue-50 border border-blue-200 p-4 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-start gap-2.5">
                <Info className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold text-blue-800 text-sm">Draf Perangkat Siap Direview</span>
                  <p className="text-xs text-blue-700">
                    Review draf, lakukan penyesuaian manual bila perlu, kemudian jalankan validasi otomatis sebelum menandai perangkat ini sebagai siap pakai.
                  </p>
                </div>
              </div>
              <button
                onClick={handleValidatePackage}
                disabled={isValidating}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 shadow"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isValidating ? 'animate-spin' : ''}`} />
                Periksa Perangkat
              </button>
            </div>
          )}

          {uiState === 'READY_FOR_CONFIRMATION' && (
            <div className={`p-4 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
              validationReport?.overallStatus === 'REVIEW'
                ? 'bg-amber-50 border-amber-200 text-amber-900'
                : validationReport?.overallStatus === 'FAIL' 
                ? 'bg-red-50 border-red-200 text-red-800' 
                : 'bg-emerald-50 border-emerald-200 text-emerald-800'
            }`}>
              <div className="flex items-start gap-2.5">
                {validationReport?.overallStatus === 'REVIEW' ? (
                  <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                ) : validationReport?.overallStatus === 'FAIL' ? (
                  <AlertOctagon className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                ) : (
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
                )}
                <div>
                  <span className="font-bold text-sm">
                    {validationReport?.overallStatus === 'REVIEW'
                      ? 'Perlu Pemeriksaan Manual Sebelum Konfirmasi'
                      : validationReport?.overallStatus === 'FAIL'
                      ? 'Validasi Gagal'
                      : 'Hasil Validasi: Siap Dikonfirmasi'}
                  </span>
                  <p className="text-xs">
                    {validationReport?.overallStatus === 'REVIEW'
                      ? 'Tidak ada error blocking, tetapi terdapat peringatan atau catatan yang perlu ditinjau guru. Setelah seluruh catatan diperiksa, guru dapat mengonfirmasi perangkat berstatus SIAP.'
                      : validationReport?.overallStatus === 'FAIL'
                      ? 'Terdapat kendala struktural yang perlu diperbaiki terlebih dahulu.'
                      : 'Perangkat telah melewati pemeriksaan otomatis dan siap ditinjau akhir serta dikonfirmasi oleh guru.'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 self-end sm:self-auto">
                <button
                  onClick={handleValidatePackage}
                  disabled={isValidating}
                  className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg text-xs font-semibold flex items-center gap-1"
                >
                  <RefreshCw className="w-3 h-3" /> Uji Ulang
                </button>
                <button
                  onClick={() => {
                    if (!activePackage) return;
                    const res = confirmAssessmentPackage(activePackage, validationContext);
                    onSaveAssessmentPackage(res.package);
                  }}
                  className={`px-4 py-2 ${
                    validationReport?.overallStatus === 'REVIEW'
                      ? 'bg-amber-600 hover:bg-amber-700'
                      : 'bg-emerald-600 hover:bg-emerald-700'
                  } text-white rounded-lg text-xs font-bold flex items-center gap-1.5 shadow`}
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />{' '}
                  {validationReport?.overallStatus === 'REVIEW'
                    ? 'Konfirmasi Setelah Review & Tandai SIAP'
                    : 'Konfirmasi & Tandai SIAP'}
                </button>
              </div>
            </div>
          )}

          {uiState === 'SIAP' && (
            <div className="p-4 rounded-xl border bg-emerald-50 border-emerald-200 text-emerald-900 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-start gap-2.5">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm">Status: SIAP DIPAKAI (Dokumen Terverifikasi)</span>
                    <span className="px-2 py-0.5 bg-emerald-600 text-white rounded text-[10px] font-bold">SIAP</span>
                  </div>
                  <p className="text-xs text-emerald-800 mt-0.5">
                    Perangkat asesmen telah diverifikasi valid dan dikonfirmasi guru. Dokumen siap dicetak atau diekspor ke format resmi DOCX & PDF.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 self-end sm:self-auto flex-wrap">
                <button
                  onClick={handleExportDocx}
                  disabled={isExportingDocx}
                  className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 shadow"
                >
                  <FileText className="w-3.5 h-3.5" />
                  {isExportingDocx ? 'Memproses...' : 'Ekspor Word (.docx)'}
                </button>
                <button
                  onClick={handleExportPdf}
                  disabled={isExportingPdf}
                  className="px-3.5 py-1.5 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 shadow"
                >
                  <Printer className="w-3.5 h-3.5" />
                  {isExportingPdf ? 'Memproses...' : 'Cetak PDF'}
                </button>
                <button
                  onClick={() => {
                    if (!activePackage) return;
                    const pkgCopy = JSON.parse(JSON.stringify(activePackage));
                    pkgCopy.workflowStatus = 'DRAFT';
                    pkgCopy.needsReview = true;
                    onSaveAssessmentPackage(pkgCopy);
                  }}
                  className="px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-semibold flex items-center gap-1"
                  title="Kembalikan ke status Draf untuk melakukan pengeditan lebih lanjut"
                >
                  <Edit2 className="w-3 h-3" /> Edit Draf
                </button>
              </div>
            </div>
          )}

          {generationError && (
            <div className="bg-red-50 border border-red-200 text-red-800 text-xs p-3 rounded-lg flex items-start gap-2">
              <AlertOctagon className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
              <span>{generationError}</span>
            </div>
          )}

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            {/* Main Navigation Tabs */}
            <div className="border-b border-slate-200 bg-slate-50 flex flex-wrap gap-1 p-2">
            <button
              onClick={() => setActiveTab('overview')}
              className={`px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 transition ${
                activeTab === 'overview' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <FileText className="w-4 h-4" />
              1. Ringkasan
            </button>
            <button
              onClick={() => setActiveTab('blueprint')}
              className={`px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 transition ${
                activeTab === 'blueprint' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <FileSpreadsheet className="w-4 h-4" />
              2. Kisi-Kisi Asesmen ({activePackage.blueprintItems.length})
            </button>
            <button
              onClick={() => setActiveTab('instruments')}
              className={`px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 transition ${
                activeTab === 'instruments' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <ListOrdered className="w-4 h-4" />
              3. Instrumen ({activePackage.instruments.length})
            </button>
            <button
              onClick={() => setActiveTab('keys_rubrics')}
              className={`px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 transition ${
                activeTab === 'keys_rubrics' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <ShieldCheck className="w-4 h-4" />
              4. Kunci, Pedoman & Rubrik
            </button>
            <button
              onClick={() => setActiveTab('validation')}
              className={`px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 transition ${
                activeTab === 'validation' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <CheckCircle2 className={`w-4 h-4 ${validationResult.valid ? 'text-emerald-600' : 'text-amber-600'}`} />
              5. Validasi Status ({validationResult.errors.length} Error)
            </button>
          </div>

          <div className="p-6">
            {/* TAB 1: OVERVIEW */}
            {activeTab === 'overview' && (
              <div className="space-y-6">
                <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
                  <h4 className="text-base font-bold text-slate-800 mb-3">Informasi Rencana Asesmen Induk</h4>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                    <div>
                      <span className="text-slate-500 block text-xs">Tujuan Asesmen</span>
                      <span className="font-semibold text-slate-800">{selectedPlan?.purpose}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block text-xs">Waktu Pelaksanaan</span>
                      <span className="font-semibold text-slate-800">{selectedPlan?.timing}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block text-xs">Cakupan Asesmen</span>
                      <span className="font-semibold text-slate-800">{selectedPlan?.scopeType}</span>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-bold text-slate-800 mb-1">Judul Perangkat Asesmen</label>
                  <input
                    type="text"
                    value={activePackage.title}
                    onChange={(e) => updatePackage({ ...activePackage, title: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                  />
                </div>

                <div>
                  <h5 className="text-sm font-bold text-slate-800 mb-2">Daftar Tipe Instrumen Terencana:</h5>
                  <div className="flex flex-wrap gap-2">
                    {selectedPlan?.instruments.map((inst) => (
                      <span key={inst.id} className="px-3 py-1 bg-blue-50 border border-blue-200 text-blue-800 text-xs font-bold rounded-lg">
                        {inst.label || inst.type}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: BLUEPRINT (KISI-KISI) */}
            {activeTab === 'blueprint' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-base font-bold text-slate-800">Kisi-Kisi Asesmen Pembelajaran</h4>
                  <button
                    onClick={() => {
                      const newBpItem: AssessmentBlueprintItem = {
                        id: `bp-${Date.now()}`,
                        objectiveRefId: '',
                        instrumentType: '',
                        instrumentItemIds: [],
                        order: activePackage.blueprintItems.length + 1,
                        assessmentIndicator: '',
                        materialOrContext: '',
                      };
                      updatePackage({
                        ...activePackage,
                        blueprintItems: [...activePackage.blueprintItems, newBpItem],
                      });
                    }}
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition"
                  >
                    <Plus className="w-4 h-4" />
                    Tambah Baris Kisi-Kisi
                  </button>
                </div>

                {activePackage.blueprintItems.length === 0 ? (
                  <p className="text-slate-500 text-sm italic py-4">Belum ada baris kisi-kisi. Klik tombol Tambah di atas.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm border-collapse">
                      <thead>
                        <tr className="bg-slate-100 text-slate-700 text-xs uppercase font-bold border-b border-slate-200">
                          <th className="p-3 text-center w-12">No</th>
                          <th className="p-3 text-left">TP / KD Tujuan</th>
                          <th className="p-3 text-left">Indikator Asesmen</th>
                          <th className="p-3 text-left">Materi / Konteks</th>
                          <th className="p-3 text-left">Bentuk Instrumen</th>
                          <th className="p-3 text-center w-16">Aksi</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {activePackage.blueprintItems.map((bp, idx) => (
                          <tr key={bp.id} className="hover:bg-slate-50">
                            <td className="p-3 text-center font-semibold text-slate-600">{idx + 1}</td>
                            <td className="p-3">
                              <select
                                value={bp.objectiveRefId}
                                onChange={(e) => {
                                  const updated = activePackage.blueprintItems.map((b) =>
                                    b.id === bp.id ? { ...b, objectiveRefId: e.target.value } : b
                                  );
                                  updatePackage({ ...activePackage, blueprintItems: updated });
                                }}
                                className="w-full text-xs p-1.5 border border-slate-300 rounded focus:ring-1 focus:ring-blue-500"
                              >
                                <option value="">-- Pilih TP/KD --</option>
                                {isMerdeka(academicSetting)
                                  ? tp?.items?.map((item) => (
                                      <option key={item.id} value={item.id}>
                                        [{item.code}] {(item.statement || item.description || '').slice(0, 60)}...
                                      </option>
                                    ))
                                  : k13Analysis?.items?.map((item) => (
                                      <option key={item.id} value={item.id}>
                                        [{item.kdCode || item.code || ''}] {(item.kdDisplay || item.materiPokok || (item as any).kdStatement || '').slice(0, 60)}...
                                      </option>
                                    ))}
                              </select>
                            </td>
                            <td className="p-3">
                              <input
                                type="text"
                                placeholder="Indikator asesmen (ditulis guru)..."
                                value={bp.assessmentIndicator || ''}
                                onChange={(e) => {
                                  const updated = activePackage.blueprintItems.map((b) =>
                                    b.id === bp.id ? { ...b, assessmentIndicator: e.target.value } : b
                                  );
                                  updatePackage({ ...activePackage, blueprintItems: updated });
                                }}
                                className="w-full text-xs p-1.5 border border-slate-300 rounded"
                              />
                            </td>
                            <td className="p-3">
                              <input
                                type="text"
                                placeholder="Lingkup materi/konteks..."
                                value={bp.materialOrContext || ''}
                                onChange={(e) => {
                                  const updated = activePackage.blueprintItems.map((b) =>
                                    b.id === bp.id ? { ...b, materialOrContext: e.target.value } : b
                                  );
                                  updatePackage({ ...activePackage, blueprintItems: updated });
                                }}
                                className="w-full text-xs p-1.5 border border-slate-300 rounded"
                              />
                            </td>
                            <td className="p-3">
                              <select
                                value={bp.instrumentType}
                                onChange={(e) => {
                                  const updated = activePackage.blueprintItems.map((b) =>
                                    b.id === bp.id ? { ...b, instrumentType: e.target.value as AssessmentInstrumentType } : b
                                  );
                                  updatePackage({ ...activePackage, blueprintItems: updated });
                                }}
                                className="w-full text-xs p-1.5 border border-slate-300 rounded"
                              >
                                <option value="">-- Pilih Bentuk Instrumen --</option>
                                {selectedPlan?.instruments.map((i) => (
                                  <option key={i.id} value={i.type}>
                                    {i.label || i.type}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="p-3 text-center">
                              <button
                                onClick={() => {
                                  const updated = activePackage.blueprintItems.filter((b) => b.id !== bp.id);
                                  updatePackage({ ...activePackage, blueprintItems: updated });
                                }}
                                className="text-red-500 hover:text-red-700 p-1"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* TAB 3: INSTRUMENTS */}
            {activeTab === 'instruments' && (
              <div className="space-y-6">
                <div className="flex gap-2 border-b border-slate-200 pb-2 overflow-x-auto">
                  {selectedPlan?.instruments.map((instRef) => (
                    <button
                      key={instRef.id}
                      onClick={() => setActiveInstType(instRef.type)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                        activeInstType === instRef.type ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      }`}
                    >
                      {instRef.label || instRef.type}
                    </button>
                  ))}
                </div>

                {/* WRITTEN TEST EDITOR */}
                {activeInstType === 'WRITTEN_TEST' && (
                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <h4 className="text-base font-bold text-slate-800">Instrumen Tes Tertulis</h4>
                      <button
                        onClick={() => {
                          let writtenInst = activePackage.instruments.find((i) => i.type === 'WRITTEN_TEST') as WrittenAssessmentInstrument | undefined;
                          const newItem: WrittenAssessmentItem = {
                            id: `item-${Date.now()}`,
                            itemType: '',
                            prompt: '',
                            options: [],
                            order: writtenInst ? writtenInst.items.length + 1 : 1,
                          };

                          let updatedInstruments = [...activePackage.instruments];
                          if (!writtenInst) {
                            writtenInst = {
                              id: `inst-written-${Date.now()}`,
                              type: 'WRITTEN_TEST',
                              items: [newItem],
                            };
                            updatedInstruments.push(writtenInst);
                          } else {
                            updatedInstruments = updatedInstruments.map((inst) =>
                              inst.type === 'WRITTEN_TEST'
                                ? { ...writtenInst, items: [...writtenInst.items, newItem] }
                                : inst
                            );
                          }
                          updatePackage({ ...activePackage, instruments: updatedInstruments });
                        }}
                        className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-bold flex items-center gap-1"
                      >
                        <Plus className="w-4 h-4" /> Tambah Soal Tertulis
                      </button>
                    </div>

                    {(() => {
                      const writtenInst = activePackage.instruments.find((i) => i.type === 'WRITTEN_TEST') as WrittenAssessmentInstrument | undefined;
                      if (!writtenInst || writtenInst.items.length === 0) {
                        return <p className="text-slate-500 text-sm italic">Belum ada butir soal tertulis.</p>;
                      }
                      return (
                        <div className="space-y-4">
                          {writtenInst.items.map((item, itemIdx) => (
                            <div key={item.id} className="p-4 border border-slate-200 rounded-lg bg-slate-50 space-y-3">
                              <div className="flex justify-between items-center">
                                <span className="font-bold text-xs uppercase tracking-wider text-slate-700">Soal #{itemIdx + 1}</span>
                                <div className="flex items-center gap-2">
                                  <select
                                    value={item.itemType}
                                    onChange={(e) => {
                                      const updatedItems = writtenInst!.items.map((it) =>
                                        it.id === item.id ? { ...it, itemType: e.target.value as any } : it
                                      );
                                      const updatedInstruments = activePackage.instruments.map((inst) =>
                                        inst.type === 'WRITTEN_TEST' ? { ...writtenInst!, items: updatedItems } : inst
                                      );
                                      updatePackage({ ...activePackage, instruments: updatedInstruments });
                                    }}
                                    className="text-xs p-1 border border-slate-300 rounded font-semibold"
                                  >
                                    <option value="">-- Pilih Jenis Soal --</option>
                                    <option value="MULTIPLE_CHOICE">Pilihan Ganda</option>
                                    <option value="MULTIPLE_SELECT">Pilihan Ganda Kompleks</option>
                                    <option value="TRUE_FALSE">Benar / Salah</option>
                                    <option value="SHORT_ANSWER">Isian Singkat</option>
                                    <option value="ESSAY">Uraian / Esai</option>
                                    <option value="MATCHING">Menjodohkan (Matching)</option>
                                    <option value="CATEGORY_RESPONSE">Kategori / Benar-Salah Majemuk (Category Response)</option>
                                  </select>

                                  <button
                                    onClick={() => {
                                      const updatedItems = writtenInst!.items.filter((it) => it.id !== item.id);
                                      const updatedInstruments = activePackage.instruments.map((inst) =>
                                        inst.type === 'WRITTEN_TEST' ? { ...writtenInst!, items: updatedItems } : inst
                                      );
                                      updatePackage({ ...activePackage, instruments: updatedInstruments });
                                    }}
                                    className="text-red-500 hover:text-red-700 p-1"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                              </div>

                              {!item.itemType && (
                                <p className="text-xs text-amber-700 bg-amber-50 p-2 rounded border border-amber-200">
                                  Silakan tentukan jenis soal (Pilihan Ganda, Benar/Salah, Isian, Uraian, Menjodohkan, atau Kategori) pada menu di atas.
                                </p>
                              )}

                              <div>
                                <label className="block text-xs font-semibold text-slate-600 mb-1">Pertanyaan / Soal</label>
                                <textarea
                                  value={item.prompt}
                                  onChange={(e) => {
                                    const updatedItems = writtenInst!.items.map((it) =>
                                      it.id === item.id ? { ...it, prompt: e.target.value } : it
                                    );
                                    const updatedInstruments = activePackage.instruments.map((inst) =>
                                      inst.type === 'WRITTEN_TEST' ? { ...writtenInst!, items: updatedItems } : inst
                                    );
                                    updatePackage({ ...activePackage, instruments: updatedInstruments });
                                  }}
                                  className="w-full text-xs p-2 border border-slate-300 rounded bg-white"
                                  rows={2}
                                />
                              </div>

                              {item.itemType === 'SHORT_ANSWER' && (
                                <div className="flex items-center gap-2 pt-1">
                                  <label className="text-xs font-semibold text-slate-600">Mode Respon (Opsional):</label>
                                  <select
                                    value={item.responseMode || ''}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      const updatedItems = writtenInst!.items.map((it) =>
                                        it.id === item.id ? { ...it, responseMode: val ? (val as any) : undefined } : it
                                      );
                                      const updatedInstruments = activePackage.instruments.map((inst) =>
                                        inst.type === 'WRITTEN_TEST' ? { ...writtenInst!, items: updatedItems } : inst
                                      );
                                      updatePackage({ ...activePackage, instruments: updatedInstruments });
                                    }}
                                    className="text-xs p-1 border border-slate-300 rounded bg-white"
                                  >
                                    <option value="">-- Belum Ditentukan (Default) --</option>
                                    <option value="SHORT_RESPONSE">Jawaban Singkat (Short Response)</option>
                                    <option value="COMPLETION">Melengkapi Kalimat / Isian (Completion)</option>
                                  </select>
                                </div>
                              )}

                              {(item.itemType === 'MULTIPLE_CHOICE' || item.itemType === 'MULTIPLE_SELECT') && (
                                <div className="space-y-2 pl-4 border-l-2 border-blue-200">
                                  <label className="block text-xs font-bold text-slate-700">Opsi Jawaban:</label>
                                  {(!item.options || item.options.length === 0) && (
                                    <p className="text-xs text-slate-400 italic">Belum ada opsi jawaban. Klik tombol di bawah untuk menambahkan opsi.</p>
                                  )}
                                  {(item.options || []).map((opt) => (
                                    <div key={opt.id} className="flex items-center gap-2">
                                      <input
                                        type="checkbox"
                                        checked={opt.isCorrect || false}
                                        onChange={(e) => {
                                          const isCheck = e.target.checked;
                                          const updatedOpts = item.options?.map((o) => {
                                            if (item.itemType === 'MULTIPLE_CHOICE') {
                                              return o.id === opt.id ? { ...o, isCorrect: isCheck } : { ...o, isCorrect: false };
                                            }
                                            return o.id === opt.id ? { ...o, isCorrect: isCheck } : o;
                                          });
                                          const updatedItems = writtenInst!.items.map((it) =>
                                            it.id === item.id ? { ...it, options: updatedOpts } : it
                                          );
                                          const updatedInstruments = activePackage.instruments.map((inst) =>
                                            inst.type === 'WRITTEN_TEST' ? { ...writtenInst!, items: updatedItems } : inst
                                          );
                                          updatePackage({ ...activePackage, instruments: updatedInstruments });
                                        }}
                                      />
                                      <span className="text-xs font-bold text-slate-600 w-4">{opt.label}.</span>
                                      <input
                                        type="text"
                                        value={opt.text}
                                        onChange={(e) => {
                                          const updatedOpts = item.options?.map((o) => (o.id === opt.id ? { ...o, text: e.target.value } : o));
                                          const updatedItems = writtenInst!.items.map((it) =>
                                            it.id === item.id ? { ...it, options: updatedOpts } : it
                                          );
                                          const updatedInstruments = activePackage.instruments.map((inst) =>
                                            inst.type === 'WRITTEN_TEST' ? { ...writtenInst!, items: updatedItems } : inst
                                          );
                                          updatePackage({ ...activePackage, instruments: updatedInstruments });
                                        }}
                                        className="text-xs p-1.5 border border-slate-300 rounded flex-1 bg-white"
                                        placeholder="Teks opsi jawaban..."
                                      />
                                      <button
                                        onClick={() => {
                                          const updatedOpts = item.options?.filter((o) => o.id !== opt.id);
                                          const updatedItems = writtenInst!.items.map((it) =>
                                            it.id === item.id ? { ...it, options: updatedOpts } : it
                                          );
                                          const updatedInstruments = activePackage.instruments.map((inst) =>
                                            inst.type === 'WRITTEN_TEST' ? { ...writtenInst!, items: updatedItems } : inst
                                          );
                                          updatePackage({ ...activePackage, instruments: updatedInstruments });
                                        }}
                                        className="text-red-500 hover:text-red-700 p-1"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  ))}
                                  <button
                                    onClick={() => {
                                      const newOptLabel = String.fromCharCode(65 + (item.options?.length || 0));
                                      const newOpt: WrittenAssessmentOption = {
                                        id: `opt-${Date.now()}`,
                                        label: newOptLabel,
                                        text: '',
                                      };
                                      const updatedOpts = [...(item.options || []), newOpt];
                                      const updatedItems = writtenInst!.items.map((it) =>
                                        it.id === item.id ? { ...it, options: updatedOpts } : it
                                      );
                                      const updatedInstruments = activePackage.instruments.map((inst) =>
                                        inst.type === 'WRITTEN_TEST' ? { ...writtenInst!, items: updatedItems } : inst
                                      );
                                      updatePackage({ ...activePackage, instruments: updatedInstruments });
                                    }}
                                    className="text-xs text-blue-600 font-semibold hover:underline flex items-center gap-1 mt-1"
                                  >
                                    + Opsi Jawaban
                                  </button>
                                </div>
                              )}

                               {item.itemType === 'MATCHING' && (() => {
                                 const matchingKey = (activePackage.answerKeys || []).find(
                                   (ak) => ak.instrumentItemId === item.id && ak.answerType === 'MATCHING'
                                 );
                                 const pairs = matchingKey?.matchingPairs || [];

                                 const updateMatchingPairs = (updatedPairs: MatchingAssessmentPair[]) => {
                                   let updatedAnswerKeys: AssessmentAnswerKey[];
                                   if (matchingKey) {
                                     updatedAnswerKeys = activePackage.answerKeys.map((ak) =>
                                       ak.id === matchingKey.id ? { ...ak, matchingPairs: updatedPairs } : ak
                                     );
                                   } else {
                                     const newKey: AssessmentAnswerKey = {
                                       id: `ak-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                                       instrumentId: writtenInst!.id,
                                       instrumentItemId: item.id,
                                       answerType: 'MATCHING',
                                       matchingPairs: updatedPairs,
                                     };
                                     updatedAnswerKeys = [...(activePackage.answerKeys || []), newKey];
                                   }
                                   // Clean deprecated item.matchingPairs from item to ensure SSOT
                                   const updatedItems = writtenInst!.items.map((it) => {
                                     if (it.id === item.id) {
                                       const { matchingPairs: _, ...rest } = it;
                                       return rest as WrittenAssessmentItem;
                                     }
                                     return it;
                                   });
                                   const updatedInstruments = activePackage.instruments.map((inst) =>
                                     inst.type === 'WRITTEN_TEST' ? { ...writtenInst!, items: updatedItems } : inst
                                   );
                                   updatePackage({ ...activePackage, instruments: updatedInstruments, answerKeys: updatedAnswerKeys });
                                 };

                                 return (
                                   <div className="space-y-4 pl-4 border-l-2 border-indigo-200">
                                     {/* Premises */}
                                     <div className="space-y-2">
                                       <label className="block text-xs font-bold text-slate-700">Daftar Premis / Pernyataan Asal (Kolom Kiri):</label>
                                       {(!item.matchingPremises || item.matchingPremises.length === 0) && (
                                         <p className="text-xs text-slate-400 italic">Belum ada premis.</p>
                                       )}
                                       {(item.matchingPremises || []).map((premise, pIdx) => (
                                         <div key={premise.id} className="flex items-center gap-2">
                                           <span className="text-xs font-bold text-slate-600 w-6">#{pIdx + 1}.</span>
                                           <input
                                             type="text"
                                             value={premise.text}
                                             onChange={(e) => {
                                               const updatedPremises = item.matchingPremises?.map((p) =>
                                                 p.id === premise.id ? { ...p, text: e.target.value } : p
                                               );
                                               const updatedItems = writtenInst!.items.map((it) =>
                                                 it.id === item.id ? { ...it, matchingPremises: updatedPremises } : it
                                               );
                                               const updatedInstruments = activePackage.instruments.map((inst) =>
                                                 inst.type === 'WRITTEN_TEST' ? { ...writtenInst!, items: updatedItems } : inst
                                               );
                                               updatePackage({ ...activePackage, instruments: updatedInstruments });
                                             }}
                                             className="text-xs p-1.5 border border-slate-300 rounded flex-1 bg-white"
                                             placeholder="Teks premis / soal asal..."
                                           />
                                           <button
                                             onClick={() => {
                                               const updatedPremises = item.matchingPremises?.filter((p) => p.id !== premise.id);
                                               const updatedPairs = pairs.filter((pair) => pair.premiseId !== premise.id);
                                               const updatedAnswerKeys = matchingKey
                                                 ? activePackage.answerKeys.map((ak) =>
                                                     ak.id === matchingKey.id ? { ...ak, matchingPairs: updatedPairs } : ak
                                                   )
                                                 : activePackage.answerKeys;
                                               const updatedItems = writtenInst!.items.map((it) =>
                                                 it.id === item.id ? { ...it, matchingPremises: updatedPremises } : it
                                               );
                                               const updatedInstruments = activePackage.instruments.map((inst) =>
                                                 inst.type === 'WRITTEN_TEST' ? { ...writtenInst!, items: updatedItems } : inst
                                               );
                                               updatePackage({
                                                 ...activePackage,
                                                 instruments: updatedInstruments,
                                                 answerKeys: updatedAnswerKeys,
                                               });
                                             }}
                                             className="text-red-500 hover:text-red-700 p-1"
                                           >
                                             <Trash2 className="w-3.5 h-3.5" />
                                           </button>
                                         </div>
                                       ))}
                                       <button
                                         onClick={() => {
                                           const newPremise: MatchingAssessmentEntry = {
                                             id: `p-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                                             text: '',
                                           };
                                           const updatedPremises = [...(item.matchingPremises || []), newPremise];
                                           const updatedItems = writtenInst!.items.map((it) =>
                                             it.id === item.id ? { ...it, matchingPremises: updatedPremises } : it
                                           );
                                           const updatedInstruments = activePackage.instruments.map((inst) =>
                                             inst.type === 'WRITTEN_TEST' ? { ...writtenInst!, items: updatedItems } : inst
                                           );
                                           updatePackage({ ...activePackage, instruments: updatedInstruments });
                                         }}
                                         className="text-xs text-indigo-600 font-semibold hover:underline flex items-center gap-1"
                                       >
                                         + Tambah Premis
                                       </button>
                                     </div>

                                     {/* Responses */}
                                     <div className="space-y-2">
                                       <label className="block text-xs font-bold text-slate-700">Daftar Respon / Pilihan Pasangan (Kolom Kanan):</label>
                                       {(!item.matchingResponses || item.matchingResponses.length === 0) && (
                                         <p className="text-xs text-slate-400 italic">Belum ada respon pasangan.</p>
                                       )}
                                       {(item.matchingResponses || []).map((resp, rIdx) => (
                                         <div key={resp.id} className="flex items-center gap-2">
                                           <span className="text-xs font-bold text-slate-600 w-6">{String.fromCharCode(65 + rIdx)}.</span>
                                           <input
                                             type="text"
                                             value={resp.text}
                                             onChange={(e) => {
                                               const updatedResp = item.matchingResponses?.map((r) =>
                                                 r.id === resp.id ? { ...r, text: e.target.value } : r
                                               );
                                               const updatedItems = writtenInst!.items.map((it) =>
                                                 it.id === item.id ? { ...it, matchingResponses: updatedResp } : it
                                               );
                                               const updatedInstruments = activePackage.instruments.map((inst) =>
                                                 inst.type === 'WRITTEN_TEST' ? { ...writtenInst!, items: updatedItems } : inst
                                               );
                                               updatePackage({ ...activePackage, instruments: updatedInstruments });
                                             }}
                                             className="text-xs p-1.5 border border-slate-300 rounded flex-1 bg-white"
                                             placeholder="Teks opsi pasangan..."
                                           />
                                           <button
                                             onClick={() => {
                                               const updatedResp = item.matchingResponses?.filter((r) => r.id !== resp.id);
                                               const updatedPairs = pairs.filter((pair) => pair.responseId !== resp.id);
                                               const updatedAnswerKeys = matchingKey
                                                 ? activePackage.answerKeys.map((ak) =>
                                                     ak.id === matchingKey.id ? { ...ak, matchingPairs: updatedPairs } : ak
                                                   )
                                                 : activePackage.answerKeys;
                                               const updatedItems = writtenInst!.items.map((it) =>
                                                 it.id === item.id ? { ...it, matchingResponses: updatedResp } : it
                                               );
                                               const updatedInstruments = activePackage.instruments.map((inst) =>
                                                 inst.type === 'WRITTEN_TEST' ? { ...writtenInst!, items: updatedItems } : inst
                                               );
                                               updatePackage({
                                                 ...activePackage,
                                                 instruments: updatedInstruments,
                                                 answerKeys: updatedAnswerKeys,
                                               });
                                             }}
                                             className="text-red-500 hover:text-red-700 p-1"
                                           >
                                             <Trash2 className="w-3.5 h-3.5" />
                                           </button>
                                         </div>
                                       ))}
                                       <button
                                         onClick={() => {
                                           const newResp: MatchingAssessmentEntry = {
                                             id: `r-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                                             text: '',
                                           };
                                           const updatedResp = [...(item.matchingResponses || []), newResp];
                                           const updatedItems = writtenInst!.items.map((it) =>
                                             it.id === item.id ? { ...it, matchingResponses: updatedResp } : it
                                           );
                                           const updatedInstruments = activePackage.instruments.map((inst) =>
                                             inst.type === 'WRITTEN_TEST' ? { ...writtenInst!, items: updatedItems } : inst
                                           );
                                           updatePackage({ ...activePackage, instruments: updatedInstruments });
                                         }}
                                         className="text-xs text-indigo-600 font-semibold hover:underline flex items-center gap-1"
                                       >
                                         + Tambah Respon
                                       </button>
                                     </div>

                                     {/* Pairs / Kunci Pasangan (AssessmentAnswerKey) */}
                                     <div className="space-y-2 pt-2 border-t border-slate-200">
                                       <div className="flex items-center justify-between">
                                         <label className="block text-xs font-bold text-slate-700">Kunci Pasangan (AssessmentAnswerKey):</label>
                                         <span className="text-[10px] text-indigo-600 font-medium bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200">
                                           Single Source of Truth
                                         </span>
                                       </div>
                                       {pairs.length === 0 && (
                                         <p className="text-xs text-slate-400 italic">Belum ada pasangan kunci jawaban.</p>
                                       )}
                                       {pairs.map((pair, pIdx) => (
                                         <div key={pIdx} className="flex items-center gap-2">
                                           <select
                                             value={pair.premiseId}
                                             onChange={(e) => {
                                               const updatedPairs = pairs.map((pr, idx) =>
                                                 idx === pIdx ? { ...pr, premiseId: e.target.value } : pr
                                               );
                                               updateMatchingPairs(updatedPairs);
                                             }}
                                             className="text-xs p-1.5 border border-slate-300 rounded bg-white flex-1"
                                           >
                                             <option value="">-- Pilih Premis --</option>
                                             {(item.matchingPremises || []).map((p, idx) => (
                                               <option key={p.id} value={p.id}>
                                                 Premis #{idx + 1}: {p.text ? p.text.slice(0, 30) : '(kosong)'}
                                               </option>
                                             ))}
                                           </select>
                                           <span className="text-xs font-bold text-slate-500">➔</span>
                                           <select
                                             value={pair.responseId}
                                             onChange={(e) => {
                                               const updatedPairs = pairs.map((pr, idx) =>
                                                 idx === pIdx ? { ...pr, responseId: e.target.value } : pr
                                               );
                                               updateMatchingPairs(updatedPairs);
                                             }}
                                             className="text-xs p-1.5 border border-slate-300 rounded bg-white flex-1"
                                           >
                                             <option value="">-- Pilih Respon Pasangan --</option>
                                             {(item.matchingResponses || []).map((r, idx) => (
                                               <option key={r.id} value={r.id}>
                                                 Respon {String.fromCharCode(65 + idx)}: {r.text ? r.text.slice(0, 30) : '(kosong)'}
                                               </option>
                                             ))}
                                           </select>
                                           <button
                                             onClick={() => {
                                               const updatedPairs = pairs.filter((_, idx) => idx !== pIdx);
                                               updateMatchingPairs(updatedPairs);
                                             }}
                                             className="text-red-500 hover:text-red-700 p-1"
                                           >
                                             <Trash2 className="w-3.5 h-3.5" />
                                           </button>
                                         </div>
                                       ))}
                                       <button
                                         onClick={() => {
                                           const newPair: MatchingAssessmentPair = {
                                             premiseId: '',
                                             responseId: '',
                                           };
                                           updateMatchingPairs([...pairs, newPair]);
                                         }}
                                         className="text-xs text-indigo-600 font-semibold hover:underline flex items-center gap-1"
                                       >
                                         + Tambah Pasangan Kunci
                                       </button>
                                     </div>
                                   </div>
                                 );
                               })()}

                               {item.itemType === 'CATEGORY_RESPONSE' && (() => {
                                 const catAnswerKey = (activePackage.answerKeys || []).find(
                                   (ak) => ak.instrumentItemId === item.id && ak.answerType === 'CATEGORY_RESPONSE'
                                 );
                                 const catAnswers = catAnswerKey?.categoryAnswers || [];
                                 const catAnswerMap = new Map(catAnswers.map((ca) => [ca.statementId, ca.categoryId]));

                                 const updateStatementCategoryAnswer = (stmtId: string, categoryId: string) => {
                                   let updatedAnswers: { statementId: string; categoryId: string }[];
                                   if (categoryId) {
                                     const exists = catAnswers.some((ca) => ca.statementId === stmtId);
                                     if (exists) {
                                       updatedAnswers = catAnswers.map((ca) =>
                                         ca.statementId === stmtId ? { statementId: stmtId, categoryId } : ca
                                       );
                                     } else {
                                       updatedAnswers = [...catAnswers, { statementId: stmtId, categoryId }];
                                     }
                                   } else {
                                     updatedAnswers = catAnswers.filter((ca) => ca.statementId !== stmtId);
                                   }

                                   let updatedAnswerKeys: AssessmentAnswerKey[];
                                   if (catAnswerKey) {
                                     updatedAnswerKeys = activePackage.answerKeys.map((ak) =>
                                       ak.id === catAnswerKey.id ? { ...ak, categoryAnswers: updatedAnswers } : ak
                                     );
                                   } else {
                                     const newKey: AssessmentAnswerKey = {
                                       id: `ak-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                                       instrumentId: writtenInst!.id,
                                       instrumentItemId: item.id,
                                       answerType: 'CATEGORY_RESPONSE',
                                       categoryAnswers: updatedAnswers,
                                     };
                                     updatedAnswerKeys = [...(activePackage.answerKeys || []), newKey];
                                   }

                                   // Clean deprecated correctCategoryId from statements to ensure SSOT
                                   const updatedStmts = (item.categoryResponseStatements || []).map((s) => {
                                     const { correctCategoryId: _, ...rest } = s;
                                     return rest;
                                   });
                                   const updatedItems = writtenInst!.items.map((it) =>
                                     it.id === item.id ? { ...it, categoryResponseStatements: updatedStmts } : it
                                   );
                                   const updatedInstruments = activePackage.instruments.map((inst) =>
                                     inst.type === 'WRITTEN_TEST' ? { ...writtenInst!, items: updatedItems } : inst
                                   );
                                   updatePackage({
                                     ...activePackage,
                                     instruments: updatedInstruments,
                                     answerKeys: updatedAnswerKeys,
                                   });
                                 };

                                 return (
                                   <div className="space-y-4 pl-4 border-l-2 border-emerald-200">
                                     {/* Categories */}
                                     <div className="space-y-2">
                                       <label className="block text-xs font-bold text-slate-700">Daftar Kategori Pilihan (misal: Benar / Salah):</label>
                                       {(!item.categoryResponseCategories || item.categoryResponseCategories.length === 0) && (
                                         <p className="text-xs text-slate-400 italic">Belum ada kategori pilihan.</p>
                                       )}
                                       {(item.categoryResponseCategories || []).map((cat, cIdx) => (
                                         <div key={cat.id} className="flex items-center gap-2">
                                           <span className="text-xs font-bold text-slate-600 w-6">Cat #{cIdx + 1}:</span>
                                           <input
                                             type="text"
                                             value={cat.label}
                                             onChange={(e) => {
                                               const updatedCats = item.categoryResponseCategories?.map((c) =>
                                                 c.id === cat.id ? { ...c, label: e.target.value } : c
                                               );
                                               const updatedItems = writtenInst!.items.map((it) =>
                                                 it.id === item.id ? { ...it, categoryResponseCategories: updatedCats } : it
                                               );
                                               const updatedInstruments = activePackage.instruments.map((inst) =>
                                                 inst.type === 'WRITTEN_TEST' ? { ...writtenInst!, items: updatedItems } : inst
                                               );
                                               updatePackage({ ...activePackage, instruments: updatedInstruments });
                                             }}
                                             className="text-xs p-1.5 border border-slate-300 rounded flex-1 bg-white"
                                             placeholder="Label kategori (misal: Benar, Salah, Sesuai)..."
                                           />
                                           <button
                                             onClick={() => {
                                               const updatedCats = item.categoryResponseCategories?.filter((c) => c.id !== cat.id);
                                               const updatedAnswers = catAnswers.filter((ca) => ca.categoryId !== cat.id);
                                               const updatedAnswerKeys = catAnswerKey
                                                 ? activePackage.answerKeys.map((ak) =>
                                                     ak.id === catAnswerKey.id ? { ...ak, categoryAnswers: updatedAnswers } : ak
                                                   )
                                                 : activePackage.answerKeys;
                                               const updatedItems = writtenInst!.items.map((it) =>
                                                 it.id === item.id ? { ...it, categoryResponseCategories: updatedCats } : it
                                               );
                                               const updatedInstruments = activePackage.instruments.map((inst) =>
                                                 inst.type === 'WRITTEN_TEST' ? { ...writtenInst!, items: updatedItems } : inst
                                               );
                                               updatePackage({
                                                 ...activePackage,
                                                 instruments: updatedInstruments,
                                                 answerKeys: updatedAnswerKeys,
                                               });
                                             }}
                                             className="text-red-500 hover:text-red-700 p-1"
                                           >
                                             <Trash2 className="w-3.5 h-3.5" />
                                           </button>
                                         </div>
                                       ))}
                                       <button
                                         onClick={() => {
                                           const newCat: CategoryResponseCategory = {
                                             id: `cat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                                             label: '',
                                           };
                                           const updatedCats = [...(item.categoryResponseCategories || []), newCat];
                                           const updatedItems = writtenInst!.items.map((it) =>
                                             it.id === item.id ? { ...it, categoryResponseCategories: updatedCats } : it
                                           );
                                           const updatedInstruments = activePackage.instruments.map((inst) =>
                                             inst.type === 'WRITTEN_TEST' ? { ...writtenInst!, items: updatedItems } : inst
                                           );
                                           updatePackage({ ...activePackage, instruments: updatedInstruments });
                                         }}
                                         className="text-xs text-emerald-600 font-semibold hover:underline flex items-center gap-1"
                                       >
                                         + Tambah Kategori
                                       </button>
                                     </div>

                                     {/* Statements */}
                                     <div className="space-y-2 pt-2 border-t border-slate-200">
                                       <div className="flex items-center justify-between">
                                         <label className="block text-xs font-bold text-slate-700">Daftar Pernyataan & Kunci Kategori (AssessmentAnswerKey):</label>
                                         <span className="text-[10px] text-emerald-600 font-medium bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                                           Single Source of Truth
                                         </span>
                                       </div>
                                       {(!item.categoryResponseStatements || item.categoryResponseStatements.length === 0) && (
                                         <p className="text-xs text-slate-400 italic">Belum ada butir pernyataan.</p>
                                       )}
                                       {(item.categoryResponseStatements || []).map((stmt, sIdx) => (
                                         <div key={stmt.id} className="flex items-center gap-2">
                                           <span className="text-xs font-bold text-slate-600 w-6">#{sIdx + 1}.</span>
                                           <input
                                             type="text"
                                             value={stmt.text}
                                             onChange={(e) => {
                                               const updatedStmts = item.categoryResponseStatements?.map((s) =>
                                                 s.id === stmt.id ? { ...s, text: e.target.value } : s
                                               );
                                               const updatedItems = writtenInst!.items.map((it) =>
                                                 it.id === item.id ? { ...it, categoryResponseStatements: updatedStmts } : it
                                               );
                                               const updatedInstruments = activePackage.instruments.map((inst) =>
                                                 inst.type === 'WRITTEN_TEST' ? { ...writtenInst!, items: updatedItems } : inst
                                               );
                                               updatePackage({ ...activePackage, instruments: updatedInstruments });
                                             }}
                                             className="text-xs p-1.5 border border-slate-300 rounded flex-1 bg-white"
                                             placeholder="Teks butir pernyataan..."
                                           />
                                           <select
                                             value={catAnswerMap.get(stmt.id) || ''}
                                             onChange={(e) => {
                                               updateStatementCategoryAnswer(stmt.id, e.target.value);
                                             }}
                                             className="text-xs p-1.5 border border-slate-300 rounded bg-white w-44"
                                           >
                                             <option value="">-- Kunci Kategori --</option>
                                             {(item.categoryResponseCategories || []).map((cat) => (
                                               <option key={cat.id} value={cat.id}>
                                                 {cat.label || '(tanpa label)'}
                                               </option>
                                             ))}
                                           </select>
                                           <button
                                             onClick={() => {
                                               const updatedStmts = item.categoryResponseStatements?.filter((s) => s.id !== stmt.id);
                                               const updatedAnswers = catAnswers.filter((ca) => ca.statementId !== stmt.id);
                                               const updatedAnswerKeys = catAnswerKey
                                                 ? activePackage.answerKeys.map((ak) =>
                                                     ak.id === catAnswerKey.id ? { ...ak, categoryAnswers: updatedAnswers } : ak
                                                   )
                                                 : activePackage.answerKeys;
                                               const updatedItems = writtenInst!.items.map((it) =>
                                                 it.id === item.id ? { ...it, categoryResponseStatements: updatedStmts } : it
                                               );
                                               const updatedInstruments = activePackage.instruments.map((inst) =>
                                                 inst.type === 'WRITTEN_TEST' ? { ...writtenInst!, items: updatedItems } : inst
                                               );
                                               updatePackage({
                                                 ...activePackage,
                                                 instruments: updatedInstruments,
                                                 answerKeys: updatedAnswerKeys,
                                               });
                                             }}
                                             className="text-red-500 hover:text-red-700 p-1"
                                           >
                                             <Trash2 className="w-3.5 h-3.5" />
                                           </button>
                                         </div>
                                       ))}
                                       <button
                                         onClick={() => {
                                           const newStmt: CategoryResponseStatement = {
                                             id: `stmt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                                             text: '',
                                           };
                                           const updatedStmts = [...(item.categoryResponseStatements || []), newStmt];
                                           const updatedItems = writtenInst!.items.map((it) =>
                                             it.id === item.id ? { ...it, categoryResponseStatements: updatedStmts } : it
                                           );
                                           const updatedInstruments = activePackage.instruments.map((inst) =>
                                             inst.type === 'WRITTEN_TEST' ? { ...writtenInst!, items: updatedItems } : inst
                                           );
                                           updatePackage({ ...activePackage, instruments: updatedInstruments });
                                         }}
                                         className="text-xs text-emerald-600 font-semibold hover:underline flex items-center gap-1"
                                       >
                                         + Tambah Pernyataan
                                       </button>
                                     </div>
                                   </div>
                                 );
                               })()}
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                  </div>
                )}

                {/* OBSERVATION EDITOR */}
                {activeInstType === 'OBSERVATION' && (
                  <div className="space-y-4">
                    <h4 className="text-base font-bold text-slate-800">Lembar Observasi / Pengamatan</h4>
                    <p className="text-xs text-slate-500">Tentukan aspek-aspek pengamatan yang akan dinilai oleh guru.</p>
                    <button
                      onClick={() => {
                        let obsInst = activePackage.instruments.find((i) => i.type === 'OBSERVATION') as ObservationAssessmentInstrument | undefined;
                        const newAspect = { id: `asp-${Date.now()}`, label: '', indicator: '' };

                        let updatedInstruments = [...activePackage.instruments];
                        if (!obsInst) {
                          obsInst = {
                            id: `inst-obs-${Date.now()}`,
                            type: 'OBSERVATION',
                            aspects: [newAspect],
                          };
                          updatedInstruments.push(obsInst);
                        } else {
                          updatedInstruments = updatedInstruments.map((inst) =>
                            inst.type === 'OBSERVATION' ? { ...obsInst, aspects: [...obsInst.aspects, newAspect] } : inst
                          );
                        }
                        updatePackage({ ...activePackage, instruments: updatedInstruments });
                      }}
                      className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-bold flex items-center gap-1"
                    >
                      <Plus className="w-4 h-4" /> Tambah Aspek Observasi
                    </button>

                    {(() => {
                      const obsInst = activePackage.instruments.find((i) => i.type === 'OBSERVATION') as ObservationAssessmentInstrument | undefined;
                      if (!obsInst || obsInst.aspects.length === 0) {
                        return <p className="text-slate-500 text-sm italic">Belum ada aspek observasi.</p>;
                      }
                      return (
                        <div className="space-y-2">
                          {obsInst.aspects.map((asp, aspIdx) => (
                            <div key={asp.id} className="flex items-center gap-2 bg-slate-50 p-2 border border-slate-200 rounded">
                              <span className="text-xs font-bold text-slate-600">{aspIdx + 1}.</span>
                              <input
                                type="text"
                                value={asp.label}
                                onChange={(e) => {
                                  const updatedAspects = obsInst!.aspects.map((a) => (a.id === asp.id ? { ...a, label: e.target.value } : a));
                                  const updatedInstruments = activePackage.instruments.map((inst) =>
                                    inst.type === 'OBSERVATION' ? { ...obsInst!, aspects: updatedAspects } : inst
                                  );
                                  updatePackage({ ...activePackage, instruments: updatedInstruments });
                                }}
                                placeholder="Label aspek (misal: Keaktifan Diskusi)..."
                                className="text-xs p-1.5 border border-slate-300 rounded flex-1"
                              />
                              <button
                                onClick={() => {
                                  const updatedAspects = obsInst!.aspects.filter((a) => a.id !== asp.id);
                                  const updatedInstruments = activePackage.instruments.map((inst) =>
                                    inst.type === 'OBSERVATION' ? { ...obsInst!, aspects: updatedAspects } : inst
                                  );
                                  updatePackage({ ...activePackage, instruments: updatedInstruments });
                                }}
                                className="text-red-500 hover:text-red-700 p-1"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                  </div>
                )}

                {/* OTHER INSTRUMENTS FALLBACK EDITOR */}
                {activeInstType && activeInstType !== 'WRITTEN_TEST' && activeInstType !== 'OBSERVATION' && (
                  <div className="space-y-4">
                    <h4 className="text-base font-bold text-slate-800">Pengaturan Instrumen ({activeInstType})</h4>
                    <p className="text-xs text-slate-500">Lengkapi detail dan instruksi instrumen sesuai rencana pembelajaran.</p>
                  </div>
                )}
              </div>
            )}

            {/* TAB 4: KEYS, PEDOMAN & RUBRIK */}
            {activeTab === 'keys_rubrics' && (
              <div className="space-y-6">
                <div>
                  <h4 className="text-base font-bold text-slate-800 mb-2">Rubrik Penilaian & KKTP</h4>
                  <p className="text-xs text-slate-500 mb-4">
                    Tambahkan rubrik kriteria dan skala capaian penilaian.
                  </p>
                  <button
                    onClick={() => {
                      const newRubric: AssessmentRubric = {
                        id: `rubric-${Date.now()}`,
                        title: '',
                        criteria: [],
                        scale: [],
                      };
                      updatePackage({ ...activePackage, rubrics: [...activePackage.rubrics, newRubric] });
                    }}
                    className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-bold flex items-center gap-1"
                  >
                    <Plus className="w-4 h-4" /> Tambah Rubrik
                  </button>
                </div>

                {activePackage.rubrics.length === 0 ? (
                  <p className="text-slate-500 text-sm italic">Belum ada rubrik yang dibuat.</p>
                ) : (
                  <div className="space-y-4">
                    {activePackage.rubrics.map((rub) => (
                      <div key={rub.id} className="p-4 border border-slate-200 rounded-lg bg-slate-50 space-y-3">
                        <div className="flex justify-between items-center gap-2">
                          <input
                            type="text"
                            placeholder="Judul Rubrik Penilaian..."
                            value={rub.title}
                            onChange={(e) => {
                              const updated = activePackage.rubrics.map((r) => (r.id === rub.id ? { ...r, title: e.target.value } : r));
                              updatePackage({ ...activePackage, rubrics: updated });
                            }}
                            className="font-bold text-sm bg-white p-1.5 border border-slate-300 rounded text-slate-800 flex-1"
                          />
                          <button
                            onClick={() => {
                              const updated = activePackage.rubrics.filter((r) => r.id !== rub.id);
                              updatePackage({ ...activePackage, rubrics: updated });
                            }}
                            className="text-red-500 hover:text-red-700 p-1 text-xs"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>

                        {/* Criteria Section */}
                        <div className="space-y-2">
                          <div className="flex justify-between items-center">
                            <span className="font-bold text-xs text-slate-700">Kriteria Penilaian:</span>
                            <button
                              onClick={() => {
                                const newCrit = { id: `crit-${Date.now()}`, label: '' };
                                const updated = activePackage.rubrics.map((r) =>
                                  r.id === rub.id ? { ...r, criteria: [...r.criteria, newCrit] } : r
                                );
                                updatePackage({ ...activePackage, rubrics: updated });
                              }}
                              className="text-xs text-blue-600 font-semibold hover:underline flex items-center gap-1"
                            >
                              <Plus className="w-3.5 h-3.5" /> Tambah Kriteria
                            </button>
                          </div>
                          {rub.criteria.length === 0 ? (
                            <p className="text-xs text-slate-400 italic">Belum ada kriteria. Silakan tambahkan kriteria penilaian.</p>
                          ) : (
                            rub.criteria.map((crit, cIdx) => (
                              <div key={crit.id} className="flex items-center gap-2">
                                <span className="text-xs font-semibold text-slate-500 w-5">{cIdx + 1}.</span>
                                <input
                                  type="text"
                                  value={crit.label}
                                  onChange={(e) => {
                                    const updatedCrits = rub.criteria.map((c) => (c.id === crit.id ? { ...c, label: e.target.value } : c));
                                    const updated = activePackage.rubrics.map((r) =>
                                      r.id === rub.id ? { ...r, criteria: updatedCrits } : r
                                    );
                                    updatePackage({ ...activePackage, rubrics: updated });
                                  }}
                                  placeholder="Label kriteria (misal: Ketepatan Konsep, Sistematika)..."
                                  className="text-xs p-1.5 border border-slate-300 rounded flex-1 bg-white"
                                />
                                <button
                                  onClick={() => {
                                    const updatedCrits = rub.criteria.filter((c) => c.id !== crit.id);
                                    const updated = activePackage.rubrics.map((r) =>
                                      r.id === rub.id ? { ...r, criteria: updatedCrits } : r
                                    );
                                    updatePackage({ ...activePackage, rubrics: updated });
                                  }}
                                  className="text-red-500 hover:text-red-700 p-1"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ))
                          )}
                        </div>

                        {/* Scale Section */}
                        <div className="space-y-2 pt-2 border-t border-slate-200">
                          <div className="flex justify-between items-center">
                            <span className="font-bold text-xs text-slate-700">Tingkat Skala Penilaian:</span>
                            <button
                              onClick={() => {
                                const newScale = {
                                  id: `scale-${Date.now()}`,
                                  label: '',
                                  order: rub.scale.length + 1,
                                  score: undefined,
                                  descriptor: '',
                                };
                                const updated = activePackage.rubrics.map((r) =>
                                  r.id === rub.id ? { ...r, scale: [...r.scale, newScale] } : r
                                );
                                updatePackage({ ...activePackage, rubrics: updated });
                              }}
                              className="text-xs text-blue-600 font-semibold hover:underline flex items-center gap-1"
                            >
                              <Plus className="w-3.5 h-3.5" /> Tambah Tingkat Skala
                            </button>
                          </div>
                          {rub.scale.length === 0 ? (
                            <p className="text-xs text-slate-400 italic">Belum ada tingkat skala. Silakan tambahkan skala penilaian.</p>
                          ) : (
                            rub.scale.map((sc, sIdx) => (
                              <div key={sc.id} className="p-2 bg-white border border-slate-200 rounded space-y-1.5">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-semibold text-slate-500 w-5">#{sIdx + 1}</span>
                                  <input
                                    type="text"
                                    value={sc.label}
                                    onChange={(e) => {
                                      const updatedScale = rub.scale.map((s) => (s.id === sc.id ? { ...s, label: e.target.value } : s));
                                      const updated = activePackage.rubrics.map((r) =>
                                        r.id === rub.id ? { ...r, scale: updatedScale } : r
                                      );
                                      updatePackage({ ...activePackage, rubrics: updated });
                                    }}
                                    placeholder="Label skala (misal: Baru Memulai, Berkembang, Mahir)..."
                                    className="text-xs p-1 border border-slate-300 rounded flex-1 bg-white font-medium"
                                  />
                                  <input
                                    type="number"
                                    value={sc.score !== undefined ? sc.score : ''}
                                    onChange={(e) => {
                                      const val = e.target.value === '' ? undefined : Number(e.target.value);
                                      const updatedScale = rub.scale.map((s) => (s.id === sc.id ? { ...s, score: val } : s));
                                      const updated = activePackage.rubrics.map((r) =>
                                        r.id === rub.id ? { ...r, scale: updatedScale } : r
                                      );
                                      updatePackage({ ...activePackage, rubrics: updated });
                                    }}
                                    placeholder="Skor (opsional)"
                                    className="text-xs p-1 border border-slate-300 rounded w-28 bg-white"
                                  />
                                  <button
                                    onClick={() => {
                                      const updatedScale = rub.scale.filter((s) => s.id !== sc.id);
                                      const updated = activePackage.rubrics.map((r) =>
                                        r.id === rub.id ? { ...r, scale: updatedScale } : r
                                      );
                                      updatePackage({ ...activePackage, rubrics: updated });
                                    }}
                                    className="text-red-500 hover:text-red-700 p-1"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                                <input
                                  type="text"
                                  value={sc.descriptor || ''}
                                  onChange={(e) => {
                                    const updatedScale = rub.scale.map((s) => (s.id === sc.id ? { ...s, descriptor: e.target.value } : s));
                                    const updated = activePackage.rubrics.map((r) =>
                                      r.id === rub.id ? { ...r, scale: updatedScale } : r
                                    );
                                    updatePackage({ ...activePackage, rubrics: updated });
                                  }}
                                  placeholder="Deskriptor capaian untuk tingkat ini (opsional)..."
                                  className="text-xs p-1 border border-slate-200 rounded w-full text-slate-600 bg-slate-50"
                                />
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* TAB 5: VALIDATION & STATUS */}
            {activeTab === 'validation' && (
              <div className="space-y-6">
                <div
                  className={`p-4 rounded-xl border ${
                    validationResult.valid ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : 'bg-amber-50 border-amber-200 text-amber-900'
                  }`}
                >
                  <div className="flex items-center gap-3 mb-2">
                    {validationResult.valid ? (
                      <CheckCircle2 className="w-6 h-6 text-emerald-600" />
                    ) : (
                      <AlertTriangle className="w-6 h-6 text-amber-600" />
                    )}
                    <h4 className="font-bold text-base">
                      {validationResult.valid ? 'Perangkat Asesmen Lengkap & Valid' : 'Perangkat Asesmen Belum Lengkap'}
                    </h4>
                  </div>
                  <p className="text-sm">
                    {validationResult.valid
                      ? 'Seluruh komponen perangkat asesmen (kisi-kisi, instrumen, kunci/rubrik) telah terverifikasi valid.'
                      : 'Lengkapi seluruh item bertanda error di bawah ini agar Perangkat Asesmen dapat dikonfirmasi berstatus SIAP.'}
                  </p>
                </div>

                {validationResult.errors.length > 0 && (
                  <div>
                    <h5 className="font-bold text-sm text-red-700 mb-2">Daftar Hal Yang Wajib Perlu Ditingkatkan (Errors):</h5>
                    <ul className="list-disc list-inside space-y-1 text-xs text-red-600 bg-red-50 p-3 rounded-lg border border-red-200">
                      {validationResult.errors.map((err, i) => (
                        <li key={i}>{err}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {validationResult.warnings.length > 0 && (
                  <div>
                    <h5 className="font-bold text-sm text-amber-700 mb-2">Peringatan / Catatan (Warnings):</h5>
                    <ul className="list-disc list-inside space-y-1 text-xs text-amber-700 bg-amber-50 p-3 rounded-lg border border-amber-200">
                      {validationResult.warnings.map((warn, i) => (
                        <li key={i}>{warn}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {validationReport && (
                  <div className="bg-white p-4 rounded-xl border border-slate-200 space-y-4">
                    <h5 className="font-bold text-sm text-slate-800 flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-blue-600" />
                      Bagian yang Perlu Diperiksa
                    </h5>
                    {(() => {
                      const allFindings = [
                        ...(validationReport.structural?.findings || []),
                        ...(validationReport.coverage?.findings || []),
                        ...(validationReport.answerVerification?.findings || []),
                        ...(validationReport.quality?.findings || []),
                        ...(validationReport.assembly?.findings || []),
                      ];
                      if (allFindings.length === 0) {
                        return <p className="text-xs text-slate-500">Tidak ada temuan kualitas AI. Perangkat siap.</p>;
                      }
                      return (
                        <div className="space-y-2">
                          {allFindings.map((finding: any, idx: number) => {
                            const action = assessmentRegenerationEligibilityService.resolveActionForFinding(finding);
                            return (
                              <div key={idx} className="p-3 bg-slate-50 rounded-lg border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                                <div>
                                  <div className="font-semibold text-slate-800 flex items-center gap-2">
                                    <span className="px-2 py-0.5 bg-slate-200 text-slate-700 rounded text-[10px] font-bold uppercase">{finding.dimension || finding.code}</span>
                                    <span>{finding.message || finding.description || finding.code}</span>
                                  </div>
                                </div>
                                <div className="flex-shrink-0">
                                  {action.eligible && action.target && action.targetId ? (
                                    <button
                                      onClick={() => handleRegenerateTarget(action.target!, action.targetId!, false, action.locator)}
                                      disabled={isRegenerating}
                                      className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold flex items-center gap-1 shadow-sm transition"
                                    >
                                      <RefreshCw className="w-3 h-3" /> {action.label}
                                    </button>
                                  ) : (
                                    <span className="px-3 py-1 bg-amber-100 text-amber-800 border border-amber-300 rounded-lg font-semibold">
                                      Periksa Manual
                                    </span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    )}
  </div>
);
};
