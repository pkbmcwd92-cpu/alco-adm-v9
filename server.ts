import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';
import dotenv from 'dotenv';
import { OfficialEducationDataProvider } from './server/schoolProvider';
import {
  fallbackAnalyzeCP,
  fallbackGenerateATP,
  fallbackRefineText,
} from './server/curriculumFallback';

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '10mb' }));

// Lazy initializer for Gemini client to prevent crashes if key is missing on load
let aiClient: GoogleGenAI | null = null;
function getAIClient(): GoogleGenAI {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY environment variable is not configured');
    }
    aiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return aiClient;
}

// Resilient generator helper with model fallbacks and exponential backoff retry for 503/429/temporary spikes
async function generateContentWithRetry(params: {
  contents: string;
  config?: any;
}): Promise<{ text?: string }> {
  // Standard non-paid models ordered by capability and availability
  const modelsToTry = [
    'gemini-3.8-flash',
    'gemini-3.1-flash-lite',
    'gemini-flash-latest',
  ];
  const ai = getAIClient();
  let lastError: any = null;

  for (const model of modelsToTry) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: params.contents,
          config: params.config,
        });
        if (response && response.text) {
          return response;
        }
      } catch (err: any) {
        lastError = err;
        const errMsg = (err?.message || String(err)).toLowerCase();

        // If 404, model not found so don't retry same model, move to next model immediately
        if (errMsg.includes('404') || errMsg.includes('not found') || errMsg.includes('no longer available')) {
          break;
        }

        // For temporary 503 high demand or 429 rate limits, wait with brief backoff and try next attempt or fallback model
        if (errMsg.includes('503') || errMsg.includes('high demand') || errMsg.includes('429') || errMsg.includes('unavailable')) {
          console.info(`[AI Service] Model ${model} returned temporary status (${attempt + 1}/2). Backing off...`);
          await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 400));
        } else {
          // For other errors, move to next fallback model
          break;
        }
      }
    }
  }

  const finalErrMsg = (lastError?.message || String(lastError)).toLowerCase();
  if (finalErrMsg.includes('503') || finalErrMsg.includes('high demand') || finalErrMsg.includes('unavailable')) {
    throw new Error('Layanan AI sedang mengalami lonjakan antrean trafik tinggi. Silakan klik tombol generate kembali dalam beberapa saat.');
  }
  throw lastError || new Error('Gagal memproses permintaan AI');
}

function cleanAndParseJSON(rawText?: string, fallback: any = {}): any {
  if (!rawText) return fallback;
  let cleaned = rawText.trim();
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.slice(7);
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.slice(3);
  }
  if (cleaned.endsWith('```')) {
    cleaned = cleaned.slice(0, -3);
  }
  cleaned = cleaned.trim();
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    console.error('Failed to parse JSON output from AI:', cleaned);
    return fallback;
  }
}

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    geminiConfigured: !!process.env.GEMINI_API_KEY,
  });
});

// Official Education Reference School Search Endpoint
app.get('/api/schools/search', async (req, res) => {
  try {
    const query = typeof req.query.q === 'string' ? req.query.q : '';
    const result = await OfficialEducationDataProvider.search(query);
    res.json({ success: true, ...result });
  } catch (error: unknown) {
    console.error('Error searching schools:', error);
    const message = error instanceof Error ? error.message : 'Gagal menghubungi data referensi sekolah';
    res.status(500).json({
      success: false,
      found: false,
      candidates: [],
      message: 'Tidak dapat menghubungi sumber data sekolah saat ini.',
      error: message,
    });
  }
});

// Automatic Principal Resolution & Verification Endpoint
app.post('/api/schools/resolve-principal', async (req, res) => {
  try {
    const { name, npsn, district, regency, province } = req.body || {};
    const result = await OfficialEducationDataProvider.resolvePrincipal({
      name: name || '',
      npsn: npsn || '',
      district: district || '',
      regency: regency || '',
      province: province || '',
    });
    res.json({ success: true, ...result });
  } catch (error: unknown) {
    console.error('Error resolving principal:', error);
    const message = error instanceof Error ? error.message : 'Gagal memverifikasi kepala sekolah';
    res.status(500).json({
      success: false,
      found: false,
      verificationStatus: 'unverified',
      message: 'Gagal menghubungi layanan verifikasi kepala sekolah saat ini.',
      error: message,
    });
  }
});

// 1. Endpoint: AI Understanding & Breakdown of CP
app.post('/api/ai/analyze-cp', async (req, res) => {
  const { cpText, elements, subject, grade, phase, curriculum } = req.body || {};

  if (!cpText && (!elements || elements.length === 0)) {
    return res.status(400).json({ error: 'Data CP tidak boleh kosong' });
  }

  // If GEMINI_API_KEY is configured, try Gemini AI first
  if (process.env.GEMINI_API_KEY) {
    try {
      const prompt = `Anda adalah pakar kurikulum dan konsultan pendidikan profesional di Indonesia.
Bantu seorang guru memahami, membedah, dan menganalisis Capaian Pembelajaran (CP) berikut:

- Mata Pelajaran: ${subject || '-'}
- Jenjang & Kelas: ${grade || '-'} (${phase || '-'})
- Kurikulum: ${curriculum || '-'}
- CP Umum: ${cpText || '-'}
- Elemen CP: ${
        elements && elements.length > 0
          ? elements.map((e: { name: string; content: string }) => `[${e.name}]: ${e.content}`).join('\n')
          : 'Tidak ada rincian elemen terpisah'
      }

Berikan output dalam format JSON dengan struktur:
1. "summary": Ringkasan fokus utama CP dalam 1-2 paragraf bahasa Indonesia yang jelas, bernas, dan aplikatif bagi guru. Gunakan terminologi "Murid" (bukan peserta didik).
2. "keyCompetencies": Array string berisi daftar kompetensi utama/kata kerja operasional (KKO) yang ditargetkan pada fase ini.
3. "keyContents": Array string materi/konten inti esensial.
4. "p3Focus": Array string Dimensi Profil Lulusan yang paling relevan.
5. "pedagogicalTips": Array string berisi 2-3 tips strategi pembelajaran kontekstual di kelas.`;

      const response = await generateContentWithRetry({
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              summary: { type: Type.STRING },
              keyCompetencies: { type: Type.ARRAY, items: { type: Type.STRING } },
              keyContents: { type: Type.ARRAY, items: { type: Type.STRING } },
              p3Focus: { type: Type.ARRAY, items: { type: Type.STRING } },
              pedagogicalTips: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: ['summary', 'keyCompetencies', 'keyContents', 'p3Focus', 'pedagogicalTips'],
          },
        },
      });

      const parsed = cleanAndParseJSON(response.text, null);
      if (parsed && parsed.summary) {
        return res.json({ success: true, data: parsed, engine: 'gemini' });
      }
    } catch (error: unknown) {
      console.warn('Gemini analysis failed or unconfigured, using pedagogical fallback engine:', error);
    }
  }

  // Pedagogical Rule Engine fallback
  const fallback = fallbackAnalyzeCP({ cpText, elements, subject, grade, phase, curriculum });
  res.json({ success: true, data: fallback, engine: 'pedagogical_engine' });
});

// Runtime validator for AI TP response
function validateAITPPayload(data: any): { isValid: boolean; reason?: string } {
  if (!Array.isArray(data)) {
    return { isValid: false, reason: 'Payload AI bukan berupa array' };
  }
  if (data.length === 0) {
    return { isValid: false, reason: 'Hasil perumusan AI TP kosong' };
  }
  for (let i = 0; i < data.length; i++) {
    const item = data[i];
    if (!item || typeof item !== 'object') {
      return { isValid: false, reason: `Butir TP ke-${i + 1} bukan berupa objek valid` };
    }
    const statement = item.statement || item.description;
    if (!statement || typeof statement !== 'string' || statement.trim() === '') {
      return { isValid: false, reason: `Rumusan TP ke-${i + 1} kosong atau tidak valid` };
    }
  }
  return { isValid: true };
}

// 2. Endpoint: AI Generate TP from CP
app.post('/api/ai/generate-tp', async (req, res) => {
  const { cpGeneral, cpElements, cpAnalysis, subject, grade, phase, curriculum, count = 4 } = req.body || {};

  if (!cpGeneral && (!cpElements || cpElements.length === 0)) {
    return res.status(400).json({ error: 'Capaian Pembelajaran (CP) harus diisi terlebih dahulu' });
  }

  if (!process.env.GEMINI_API_KEY) {
    return res.status(503).json({ error: 'Layanan AI belum dikonfigurasi (GEMINI_API_KEY tidak terpasang).' });
  }

  try {
    const prompt = `Anda adalah ahli perancangan kurikulum pendidikan nasional Indonesia.
Tugas Anda adalah merumuskan Tujuan Pembelajaran (TP) yang diturunkan SECARA KETAT dan EKSPLISIT dari Capaian Pembelajaran (CP) dan Hasil Analisis CP yang diberikan di bawah ini.

PERINGATAN PENTING:
- TP HARUS mencakup Kompetensi (kemampuan/keterampilan) dan Lingkup Materi (konten esensial).
- Formula TP yang baik: "Murid mampu [Kompetensi/KKO] [Lingkup Materi] melalui [Konteks/Aktivitas/Kondisi] dengan [Kriteria/Tepat]."
- TP harus dapat diobservasi dan diukur (mengacu pada Taksonomi Bloom / Anderson atau Marzano).
- Jangan membuat TP yang menyimpang dari CP yang tersimpan.

DATA PEMBELAJARAN:
- Mata Pelajaran: ${subject || '-'}
- Tingkat: ${grade || '-'} (${phase || '-'})
- Kurikulum: ${curriculum || '-'}
- Deskripsi CP Umum: ${cpGeneral || '-'}
- Elemen-Elemen CP:
${
  cpElements && cpElements.length > 0
    ? cpElements.map((e: { name: string; content: string }, idx: number) => `${idx + 1}. [Elemen: ${e.name}]: ${e.content}`).join('\n')
    : 'Tidak ada rincian elemen.'
}
${
  cpAnalysis && Array.isArray(cpAnalysis) && cpAnalysis.length > 0
    ? `\nANALISIS CP (Rujukan Kompetensi & Materi):
${cpAnalysis.map((a: any, idx: number) => `${idx + 1}. [Elemen: ${a.elementName || '-'}] Kompetensi: ${a.cpCompetence || '-'} | Materi: ${a.materialScope || '-'} | Rekomendasi TP: ${a.suggestedTp || '-'}`).join('\n')}`
    : ''
}

Buatlah sekitar ${count} hingga 6 butir Tujuan Pembelajaran (TP) yang sistematis.
Kembalikan respon dalam format JSON sesuai schema:`;

    const response = await generateContentWithRetry({
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              code: { type: Type.STRING, description: 'Kode TP misal TP 4.1, TP 4.2' },
              elementName: { type: Type.STRING, description: 'Nama Elemen CP yang menjadi rujukan' },
              statement: { type: Type.STRING, description: 'Rumusan kalimat Tujuan Pembelajaran lengkap' },
              competence: { type: Type.STRING, description: 'Kata Kerja Operasional / Kompetensi utama' },
              contentScope: { type: Type.STRING, description: 'Lingkup Materi / Topik Pembelajaran' },
              p3Dimensions: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: 'Dimensi Profil Lulusan yang diasah (1-3 dimensi)',
              },
            },
            required: ['code', 'elementName', 'statement', 'competence', 'contentScope', 'p3Dimensions'],
          },
        },
      },
    });

    const parsed = cleanAndParseJSON(response.text, null);
    const validation = validateAITPPayload(parsed);

    if (!validation.isValid) {
      console.warn('Gemini generate TP output invalid:', validation.reason);
      return res.status(500).json({ error: `Respons AI tidak memenuhi kualifikasi struktur TP: ${validation.reason}` });
    }

    return res.json({ success: true, items: parsed, engine: 'gemini' });
  } catch (error: any) {
    console.error('Gemini generate TP failed:', error);
    return res.status(500).json({ error: `Gagal merumuskan AI TP: ${error.message || 'Respons provider AI tidak dapat diproses'}` });
  }
});

// 3. Endpoint: AI Generate ATP from TP
app.post('/api/ai/generate-atp', async (req, res) => {
  const { tps, cpGeneral, subject, grade, phase, semester, academicYear, curriculum, totalHoursPerWeek = 5 } = req.body || {};

  // 1. Validate TP array prerequisite
  if (!tps || !Array.isArray(tps) || tps.length === 0) {
    return res.status(400).json({ error: 'Daftar Tujuan Pembelajaran (TP) harus diisi dan tidak boleh kosong sebelum menyusun ATP.' });
  }

  // 2. Validate Academic Context Prerequisites
  if (!subject || typeof subject !== 'string' || subject.trim() === '') {
    return res.status(400).json({ error: 'Mata pelajaran harus diisi sebelum menyusun ATP.' });
  }

  if (!grade || typeof grade !== 'string' || grade.trim() === '') {
    return res.status(400).json({ error: 'Kelas/tingkat harus diisi sebelum menyusun ATP.' });
  }

  const isK13 = (curriculum && String(curriculum).toUpperCase().includes('K13')) || (curriculum && String(curriculum).toUpperCase().includes('2013'));
  if (!isK13) {
    if (!phase || typeof phase !== 'string' || phase.trim() === '') {
      return res.status(400).json({ error: 'Fase harus diisi untuk Kurikulum Merdeka sebelum menyusun ATP.' });
    }
  }

  if (!academicYear || typeof academicYear !== 'string' || academicYear.trim() === '') {
    return res.status(400).json({ error: 'Tahun ajaran/akademik harus diisi sebelum menyusun ATP.' });
  }

  if (!semester || typeof semester !== 'string' || semester.trim() === '') {
    return res.status(400).json({ error: 'Semester harus diisi sebelum menyusun ATP.' });
  }

  // If GEMINI_API_KEY is configured, try Gemini AI
  if (process.env.GEMINI_API_KEY) {
    try {
      const prompt = `Anda adalah spesialis penyusun Alur Tujuan Pembelajaran (ATP) dan perangkat pembelajaran Kurikulum Merdeka.
Susunlah Matriks Alur Tujuan Pembelajaran (ATP) yang berurutan secara logis, pedagogis, dan terstruktur dari daftar Tujuan Pembelajaran (TP) berikut:

DATA PEMBELAJARAN:
- Mata Pelajaran: ${subject || '-'}
- Kelas / Fase: ${grade || '-'} / ${phase || '-'}
- Tahun Ajaran / Semester: ${academicYear || '-'} / ${semester || '-'}
- Alokasi Jam per Minggu: ${totalHoursPerWeek} JP
- Rujukan CP: ${cpGeneral || '-'}

DAFTAR TP YANG SUDAH DIBUAT:
${tps
  .map(
    (tp: { code: string; statement: string; competence?: string; contentScope?: string; p3Dimensions?: string[] }, idx: number) =>
      `${idx + 1}. [Kode: ${tp.code || '-'}] ${tp.statement} (Materi: ${tp.contentScope || '-'}, Kompetensi: ${
        tp.competence || '-'
      }, Dimensi Profil Lulusan: ${tp.p3Dimensions?.join(', ') || '-'})`
  )
  .join('\n')}

INSTRUKSI PENYUSUNAN ATP:
1. Urutkan TP secara logis (misal dari konkret ke abstrak, mudah ke sukar, atau hierarki keterampilan bahasa/sains/matematika).
2. Tentukan Alokasi Waktu (JP) yang realistis untuk tiap langkah pembelajaran.
3. Rincikan Rencana Asesmen (Asesmen Awal, Formatif, dan Sumatif Lingkup Materi).
4. Rincikan Glosarium / Kata Kunci penting.
5. Gunakan terminologi "Murid" (bukan peserta didik) dan "Dimensi Profil Lulusan".
6. Buat rasionalisasi alur pembelajaran secara komprehensif.

Kembalikan output JSON sesuai schema:`;

      const response = await generateContentWithRetry({
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              rationale: {
                type: Type.STRING,
                description: 'Penjelasan rasional mengapa alur TP disusun dalam urutan ini.',
              },
              items: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    stepNumber: { type: Type.INTEGER, description: 'Urutan alur pembelajaran (1, 2, 3...)' },
                    tpCode: { type: Type.STRING, description: 'Kode TP yang diurutkan' },
                    tpStatement: { type: Type.STRING, description: 'Rumusan TP' },
                    materialScope: { type: Type.STRING, description: 'Lingkup Materi / Topik Pembelajaran Spesifik' },
                    jp: { type: Type.INTEGER, description: 'Jumlah Alokasi Jam Pelajaran (JP), misal 4, 6, 8' },
                    p3Dimensions: { type: Type.ARRAY, items: { type: Type.STRING } },
                    assessmentPlan: { type: Type.STRING, description: 'Bentuk Asesmen Awal, Formatif, dan Sumatif' },
                    glossary: { type: Type.STRING, description: 'Kata kunci / Glosarium istilah penting' },
                    resources: { type: Type.STRING, description: 'Sumber belajar / Media yang disarankan' },
                  },
                  required: [
                    'stepNumber',
                    'tpCode',
                    'tpStatement',
                    'materialScope',
                    'jp',
                    'p3Dimensions',
                    'assessmentPlan',
                    'glossary',
                  ],
                },
              },
            },
            required: ['rationale', 'items'],
          },
        },
      });

      const parsed = cleanAndParseJSON(response.text, null);
      if (parsed && Array.isArray(parsed.items) && parsed.items.length > 0) {
        return res.json({ success: true, data: parsed, engine: 'gemini' });
      }
    } catch (error: unknown) {
      console.warn('Gemini ATP generation failed or unconfigured, using pedagogical fallback engine:', error);
    }
  }

  // Pedagogical Rule Engine fallback
  const fallbackMatrix = fallbackGenerateATP({ tps, cpGeneral, subject, grade, phase, semester, academicYear, totalHoursPerWeek });
  res.json({ success: true, data: fallbackMatrix, engine: 'pedagogical_engine' });
});

// 4. Endpoint: AI Refine / Polish any custom text
app.post('/api/ai/refine-text', async (req, res) => {
  const { text, instruction, context } = req.body || {};
  if (!text) {
    return res.status(400).json({ error: 'Teks tidak boleh kosong' });
  }

  // If GEMINI_API_KEY is configured, try Gemini AI first
  if (process.env.GEMINI_API_KEY) {
    try {
      const prompt = `Anda adalah asisten ahli administrasi guru Indonesia.
Teks asli: "${text}"
Konteks: ${context || 'Administrasi Kurikulum Merdeka'}
Instruksi perbaikan: ${instruction || 'Sempurnakan tata bahasa, ketepatan pedagogis, dan istilah Kurikulum Merdeka agar lebih formal, jelas, dan operasional.'}

Berikan versi teks hasil penyempurnaan dalam bahasa Indonesia yang baku dan elegan. Langsung berikan teks hasil tanpa pembuka/penutup.`;

      const response = await generateContentWithRetry({
        contents: prompt,
      });

      if (response.text && response.text.trim().length > 0) {
        return res.json({ success: true, refinedText: response.text.trim(), engine: 'gemini' });
      }
    } catch (error: unknown) {
      console.warn('Gemini refine text failed or unconfigured, using fallback:', error);
    }
  }

  const refined = fallbackRefineText(text, instruction, context);
  res.json({ success: true, refinedText: refined, engine: 'pedagogical_engine' });
});

// Runtime validator for AI Learning Plan response
function validateAILearningPlanPayload(data: any): { isValid: boolean; reason?: string } {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { isValid: false, reason: 'Payload AI bukan berupa objek valid' };
  }

  if (!Array.isArray(data.learningExperiences) || data.learningExperiences.length === 0) {
    return { isValid: false, reason: 'Daftar Pengalaman Belajar (learningExperiences) kosong atau bukan array' };
  }

  const validPhases = ['UNDERSTAND', 'APPLY', 'REFLECT'];
  for (let i = 0; i < data.learningExperiences.length; i++) {
    const exp = data.learningExperiences[i];
    if (!exp || typeof exp !== 'object') {
      return { isValid: false, reason: `Butir pengalaman belajar ke-${i + 1} bukan berupa objek` };
    }
    if (!validPhases.includes(exp.phase)) {
      return { isValid: false, reason: `Fase pengalaman belajar ke-${i + 1} ('${exp.phase}') tidak valid. Pilihan sah: UNDERSTAND, APPLY, REFLECT` };
    }
    if (!exp.description || typeof exp.description !== 'string' || exp.description.trim() === '') {
      return { isValid: false, reason: `Deskripsi pengalaman belajar ke-${i + 1} kosong` };
    }
  }

  if (data.triggerQuestions !== undefined && !Array.isArray(data.triggerQuestions)) {
    return { isValid: false, reason: 'Pertanyaan pemantik (triggerQuestions) harus berupa array' };
  }
  if (data.resources !== undefined && !Array.isArray(data.resources)) {
    return { isValid: false, reason: 'Sumber belajar (resources) harus berupa array' };
  }
  if (data.graduateProfileDimensions !== undefined && !Array.isArray(data.graduateProfileDimensions)) {
    return { isValid: false, reason: 'Dimensi Profil Lulusan harus berupa array' };
  }

  return { isValid: true };
}

// Endpoint: AI Generate Learning Plan (Modul Ajar DRAFT)
app.post('/api/ai/generate-learning-plan', async (req, res) => {
  const { academicSetting, tps, atpItems, topic } = req.body || {};

  if (!tps || !Array.isArray(tps) || tps.length === 0) {
    return res.status(400).json({ error: 'At least one Purpose of Learning (TP) is required to generate a Learning Plan' });
  }

  if (!process.env.GEMINI_API_KEY) {
    return res.status(503).json({ error: 'Layanan AI belum dikonfigurasi (GEMINI_API_KEY tidak terpasang).' });
  }

  try {
    const subject = academicSetting?.subject || '';
    const grade = academicSetting?.grade || '';
    const phase = academicSetting?.phase || '';

    const prompt = `Anda adalah spesialis penyusun Modul Ajar / RPP Berdiferensiasi Kurikulum Merdeka 2026 (Deep Learning & Kemendikdasmen).
Susun draf Modul Ajar pedagogis yang komprehensif berdasarkan data rujukan berikut:

MATA PELAJARAN: ${subject}
KELAS / FASE: ${grade} / ${phase}
TOPIK: ${topic || tps[0]?.contentScope || tps[0]?.statement || 'Topik Pembelajaran'}

TUJUAN PEMBELAJARAN (TP) RUJUKAN:
${tps.map((t: any, i: number) => `${i + 1}. [Kode: ${t.code || '-'}] ${t.statement} (Materi: ${t.contentScope || '-'}, Kompetensi: ${t.competence || '-'})`).join('\n')}

ATP / ALOKASI JP RUJUKAN:
${atpItems && atpItems.length > 0 ? atpItems.map((a: any, i: number) => `${i + 1}. Langkah ${a.stepNumber || i + 1}: Lingkup ${a.materialScope || '-'} (${a.jp || 2} JP)`).join('\n') : 'Sesuai standar'}

INSTRUKSI:
1. Susun Pengalaman Belajar (learningExperiences) dengan struktur 3 fase utama (UNDERSTAND, APPLY, REFLECT) sesuai panduan 2026.
2. Gunakan terminologi "Murid" (bukan peserta didik) dan "Dimensi Profil Lulusan".
3. Sediakan Rencana Asesmen (Asesmen Diagnostik Awal, Formatif, dan Sumatif).
4. Sediakan Rencana Diferensiasi (Konten, Proses, Produk).
5. Buat kalimat pemahaman bermakna dan pertanyaan pemantik yang relevan.

Kembalikan output JSON sesuai schema.`;

    const response = await generateContentWithRetry({
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            topic: { type: Type.STRING },
            meaningfulUnderstanding: { type: Type.STRING },
            triggerQuestions: { type: Type.ARRAY, items: { type: Type.STRING } },
            learningExperiences: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  phase: { type: Type.STRING, description: 'MUST be UNDERSTAND, APPLY, or REFLECT' },
                  description: { type: Type.STRING },
                  durationMinutes: { type: Type.NUMBER },
                },
                required: ['phase', 'description'],
              },
            },
            deepLearningContext: {
              type: Type.OBJECT,
              properties: {
                principles: { type: Type.ARRAY, items: { type: Type.STRING } },
                graduateProfileDimensions: { type: Type.ARRAY, items: { type: Type.STRING } },
              },
            },
            graduateProfileDimensions: { type: Type.ARRAY, items: { type: Type.STRING } },
            learningSteps: {
              type: Type.OBJECT,
              properties: {
                opening: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      stepName: { type: Type.STRING },
                      description: { type: Type.STRING },
                      durationMinutes: { type: Type.NUMBER },
                    },
                  },
                },
                core: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      stepName: { type: Type.STRING },
                      description: { type: Type.STRING },
                      durationMinutes: { type: Type.NUMBER },
                    },
                  },
                },
                closing: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      stepName: { type: Type.STRING },
                      description: { type: Type.STRING },
                      durationMinutes: { type: Type.NUMBER },
                    },
                  },
                },
              },
            },
            assessmentPlan: {
              type: Type.OBJECT,
              properties: {
                initial: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      type: { type: Type.STRING },
                      technique: { type: Type.STRING },
                      description: { type: Type.STRING },
                    },
                  },
                },
                formative: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      type: { type: Type.STRING },
                      technique: { type: Type.STRING },
                      description: { type: Type.STRING },
                    },
                  },
                },
                summative: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      type: { type: Type.STRING },
                      technique: { type: Type.STRING },
                      description: { type: Type.STRING },
                    },
                  },
                },
              },
            },
            differentiation: {
              type: Type.OBJECT,
              properties: {
                content: { type: Type.STRING },
                process: { type: Type.STRING },
                product: { type: Type.STRING },
              },
            },
            reflection: {
              type: Type.OBJECT,
              properties: {
                teacher: { type: Type.STRING },
                student: { type: Type.STRING },
              },
            },
            enrichmentPlan: { type: Type.STRING },
            remedialPlan: { type: Type.STRING },
            resources: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  title: { type: Type.STRING },
                },
              },
            },
            allocatedJP: { type: Type.NUMBER },
          },
        },
      },
    });

    const parsed = cleanAndParseJSON(response.text, null);
    const validation = validateAILearningPlanPayload(parsed);

    if (!validation.isValid) {
      console.warn('Gemini generate learning plan output invalid:', validation.reason);
      return res.status(500).json({ error: `Respons AI tidak memenuhi kualifikasi struktur Modul Ajar: ${validation.reason}` });
    }

    return res.json({ success: true, data: parsed, engine: 'gemini' });
  } catch (error: any) {
    console.error('Gemini generate learning plan failed:', error);
    return res.status(500).json({ error: `Gagal menyusun Draf AI Modul Ajar: ${error.message || 'Respons provider AI tidak dapat diproses'}` });
  }
});

// 2. Endpoint: AI Assessment Package Generation (9C.4 / 9C.7)
app.post('/api/ai/generate-assessment-package', async (req, res) => {
  const { systemPrompt, userPrompt } = req.body || {};
  if (!userPrompt) {
    return res.status(400).json({ error: 'User prompt is required' });
  }

  if (process.env.GEMINI_API_KEY) {
    try {
      const response = await generateContentWithRetry({
        contents: userPrompt,
        config: {
          systemInstruction: systemPrompt,
        },
      });

      if (response.text) {
        return res.json({ success: true, rawText: response.text });
      }
    } catch (error: any) {
      console.error('Gemini generate assessment package failed:', error);
      return res.status(500).json({ error: error.message || 'Gagal generate perangkat asesmen via Gemini' });
    }
  }

  return res.status(501).json({ error: 'Kunci API Gemini belum dikonfigurasi di lingkungan server.' });
});

// 3. Endpoint: AI Assessment Target Granular Regeneration (9C.6 / 9C.7)
app.post('/api/ai/regenerate-assessment-target', async (req, res) => {
  const { contract } = req.body || {};
  if (!contract) {
    return res.status(400).json({ error: 'Contract is required' });
  }

  if (process.env.GEMINI_API_KEY) {
    try {
      const systemInstruction = `Anda adalah asisten AI kurikulum dan pembuat soal profesional di Indonesia.
Bantu guru melakukan regenerasi granular (pembaruan bertahap) secara aman untuk target: ${contract.target}.
Target ID: ${contract.targetId}.

Aturan utama:
- Tanggapi HANYA dengan objek JSON valid berisi rincian bidang yang diminta di editableContent.
- Kembalikan bidang yang berubah atau yang baru saja, pertahankan tipe data bidang aslinya.
- Jangan menambahkan penjelasan, markdown block (seperti \`\`\`json), atau teks pengantar lainnya. Tanggapi dengan format mentah JSON objek saja.`;

      const userPrompt = `Lakukan regenerasi target ${contract.target} untuk Target ID: ${contract.targetId}.

Konteks tidak berubah (Immutable Context):
${JSON.stringify(contract.immutableContext, null, 2)}

Materi & Kriteria:
- Kalibrasi Kelas: ${JSON.stringify(contract.gradeCalibration, null, 2)}
- Profil Subjek: ${JSON.stringify(contract.subjectProfile, null, 2)}

Temuan Validasi yang Perlu Diperbaiki (Validation Findings):
${JSON.stringify(contract.validationFindings, null, 2)}

Konten yang Dipertahankan (Preserved Content):
${JSON.stringify(contract.preservedContent, null, 2)}

Konten yang Boleh Diedit & Diminta Regenerasi (Editable/Requested Content):
${JSON.stringify(contract.editableContent, null, 2)}

Hasilkan pembaruan untuk editableContent tersebut dalam format JSON.`;

      const response = await generateContentWithRetry({
        contents: userPrompt,
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
        },
      });

      if (response.text) {
        const cleanedText = response.text.trim();
        const parsed = cleanAndParseJSON(cleanedText, null);
        if (parsed) {
          return res.json({ success: true, data: parsed });
        } else {
          return res.status(500).json({ error: 'Gagal parse JSON hasil regenerasi AI' });
        }
      }
    } catch (error: any) {
      console.error('Gemini regenerate assessment target failed:', error);
      return res.status(500).json({ error: error.message || 'Gagal regenerasi granular via Gemini' });
    }
  }

  return res.status(501).json({ error: 'Kunci API Gemini belum dikonfigurasi di lingkungan server.' });
});

// Vite middleware in dev or static files in prod
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Administrasi Guru AI Server running at http://0.0.0.0:${PORT}`);
  });
}

startServer();
