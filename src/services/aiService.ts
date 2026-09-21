import { CPElem, TPItem, ATPItem, AcademicSetting, LearningPlan } from '../types';

export interface CPAnalysisResult {
  summary: string;
  keyCompetencies: string[];
  keyContents: string[];
  p3Focus: string[];
  pedagogicalTips: string[];
}

export interface GenerateTPParams {
  cpGeneral: string;
  cpElements: CPElem[];
  cpAnalysis?: any[];
  cpAnalysisItems?: any[];
  subject: string;
  grade: string;
  phase: string;
  curriculum: string;
  count?: number;
}

export interface GenerateATPParams {
  tps: TPItem[];
  cpGeneral: string;
  subject: string;
  grade: string;
  phase: string;
  semester: string;
  academicYear: string;
  totalHoursPerWeek?: number;
}

export interface GenerateATPResult {
  rationale: string;
  items: Omit<ATPItem, 'id' | 'tpId'>[];
}

/**
 * Maps raw backend or fetch errors into a clear, user-friendly Indonesian explanation.
 */
export function formatAIErrorMessage(error: any, actionName: string = 'memproses permintaan'): string {
  if (!error) return `Terjadi kendala saat ${actionName}. Silakan coba lagi.`;
  const raw = (error.message || String(error)).toLowerCase();

  if (raw.includes('503') || raw.includes('high demand') || raw.includes('unavailable') || raw.includes('spikes in demand')) {
    return 'Layanan AI sedang mengalami lonjakan antrean trafik tinggi. Silakan klik tombol "Coba Lagi" dalam beberapa detik.';
  }
  if (raw.includes('429') || raw.includes('quota') || raw.includes('rate limit')) {
    return 'Batas kuota AI sementara tercapai. Mohon tunggu sebentar lalu coba kembali.';
  }
  if (raw.includes('failed to fetch') || raw.includes('network') || raw.includes('econnrefused')) {
    return 'Gagal terhubung ke server backend AI. Pastikan koneksi internet Anda aktif dan server berjalan.';
  }
  if (raw.includes('api key') || raw.includes('unauthorized') || raw.includes('401')) {
    return 'Kunci API Gemini belum dikonfigurasi di lingkungan server.';
  }
  if (raw.includes('timeout') || raw.includes('timed out')) {
    return 'Permintaan AI membutuhkan waktu terlalu lama. Silakan coba kembali dengan cakupan data yang lebih spesifik.';
  }

  return error.message || `Terjadi kesalahan saat ${actionName}. Silakan periksa kembali data Anda.`;
}

export async function analyzeCPWithAI(params: {
  cpText: string;
  elements: CPElem[];
  subject: string;
  grade: string;
  phase: string;
  curriculum: string;
}): Promise<CPAnalysisResult> {
  try {
    const res = await fetch('/api/ai/analyze-cp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `Gagal menganalisis CP (Status ${res.status})`);
    }

    const data = await res.json();
    return data.data;
  } catch (err) {
    throw new Error(formatAIErrorMessage(err, 'menganalisis Capaian Pembelajaran'));
  }
}

export async function generateTPWithAI(params: GenerateTPParams): Promise<TPItem[]> {
  try {
    const res = await fetch('/api/ai/generate-tp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `Gagal menghasilkan TP dengan AI (Status ${res.status})`);
    }

    const data = await res.json();
    const rawItems = data.items || [];
    return rawItems.map((item: any, idx: number) => {
      const stmt = item.statement || item.description || '';
      return {
        id: `tp-item-${Date.now()}-${idx}-${Math.random().toString(36).substring(2, 6)}`,
        code: item.code || '',
        elementName: item.elementName || '',
        statement: stmt,
        description: stmt,
        competence: item.competence || '',
        contentScope: item.contentScope || '',
        p3Dimensions: Array.isArray(item.p3Dimensions) ? item.p3Dimensions : [],
        order: idx + 1,
        cpAnalysisItemIds: Array.isArray(item.cpAnalysisItemIds) ? item.cpAnalysisItemIds : [],
      };
    });
  } catch (err) {
    throw new Error(formatAIErrorMessage(err, 'merumuskan Tujuan Pembelajaran'));
  }
}

export interface GenerateLearningPlanParams {
  academicSetting: AcademicSetting;
  tps: TPItem[];
  atpItems?: ATPItem[];
  topic?: string;
}

export async function generateLearningPlanWithAI(params: GenerateLearningPlanParams): Promise<Partial<LearningPlan>> {
  try {
    const res = await fetch('/api/ai/generate-learning-plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `Gagal menyusun draf Modul Ajar AI (Status ${res.status})`);
    }

    const data = await res.json();
    if (!data.data || typeof data.data !== 'object' || Array.isArray(data.data)) {
      throw new Error('Hasil respon AI Modul Ajar tidak berbentuk objek valid.');
    }

    // Runtime validation for critical structure
    if (!Array.isArray(data.data.learningExperiences) || data.data.learningExperiences.length === 0) {
      throw new Error('Hasil respon AI Modul Ajar tidak memuat Pengalaman Belajar (learningExperiences).');
    }

    const validPhases = ['UNDERSTAND', 'APPLY', 'REFLECT'];
    for (let i = 0; i < data.data.learningExperiences.length; i++) {
      const exp = data.data.learningExperiences[i];
      if (!exp || typeof exp !== 'object') {
        throw new Error(`Butir pengalaman belajar ke-${i + 1} tidak valid.`);
      }
      if (!validPhases.includes(exp.phase)) {
        throw new Error(`Fase pengalaman belajar ke-${i + 1} ('${exp.phase}') tidak sah.`);
      }
      if (!exp.description || typeof exp.description !== 'string' || exp.description.trim() === '') {
        throw new Error(`Deskripsi pengalaman belajar ke-${i + 1} kosong.`);
      }
    }

    return data.data;
  } catch (err) {
    throw new Error(formatAIErrorMessage(err, 'menyusun Modul Ajar / RPP'));
  }
}

export async function generateATPWithAI(params: GenerateATPParams): Promise<GenerateATPResult> {
  try {
    const res = await fetch('/api/ai/generate-atp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `Gagal menyusun ATP dengan AI (Status ${res.status})`);
    }

    const data = await res.json();
    return data.data;
  } catch (err) {
    throw new Error(formatAIErrorMessage(err, 'menyusun Alur Tujuan Pembelajaran'));
  }
}

export async function refineTextWithAI(params: {
  text: string;
  instruction?: string;
  context?: string;
}): Promise<string> {
  try {
    const res = await fetch('/api/ai/refine-text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'Gagal menyempurnakan teks');
    }

    const data = await res.json();
    return data.refinedText;
  } catch (err) {
    throw new Error(formatAIErrorMessage(err, 'menyempurnakan kalimat'));
  }
}
