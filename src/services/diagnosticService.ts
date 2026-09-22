import { AcademicSetting, ActiveContext, ATPData, TPData, WorkflowCompletionStatus } from '../types';
import { APP_BUILD_ID } from '../config/buildInfo';
import { normalizePhaseCode, TPValidationDetails } from './cpWorkflowService';

export type DiagnosticScope = 'TP' | 'LEARNING_PLAN';

export interface DiagnosticEvent {
  timestamp: string;
  scope: DiagnosticScope;
  action: string;
  status?: string;
  metadata?: Record<string, string | number | boolean | null | undefined>;
}

const STORAGE_KEY = 'alco_diagnostic_events_v1';
const MAX_EVENTS = 30;

function readEvents(): DiagnosticEvent[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.slice(-MAX_EVENTS) : [];
  } catch {
    return [];
  }
}

export function getRecentDiagnosticEvents(scope?: DiagnosticScope): DiagnosticEvent[] {
  const events = readEvents();
  return scope ? events.filter((event) => event.scope === scope) : events;
}

export function recordDiagnosticEvent(event: Omit<DiagnosticEvent, 'timestamp'>): void {
  if (typeof localStorage === 'undefined') return;
  const nextEvent: DiagnosticEvent = {
    timestamp: new Date().toISOString(),
    ...event,
  };
  const events = [...readEvents(), nextEvent].slice(-MAX_EVENTS);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
  } catch {
    // Diagnostics must never interrupt the user workflow.
  }
}

function line(key: string, value: unknown): string {
  return `${key}: ${value === undefined || value === null || value === '' ? '-' : String(value)}`;
}

function formatEvents(scope: DiagnosticScope): string[] {
  const events = getRecentDiagnosticEvents(scope).slice(-10);
  if (events.length === 0) return ['- none'];
  return events.map((event) => {
    const metadata = event.metadata
      ? Object.entries(event.metadata)
          .filter(([, value]) => value !== undefined)
          .map(([key, value]) => `${key}=${value}`)
          .join(', ')
      : '';
    return `- ${event.timestamp} ${event.action}${event.status ? ` status=${event.status}` : ''}${metadata ? ` (${metadata})` : ''}`;
  });
}

export function buildTPDiagnosticReport(data: {
  module?: 'TP' | 'LEARNING_PLAN';
  workspaceId?: string;
  academicSetting?: AcademicSetting | null;
  context?: Partial<ActiveContext> | null;
  tp?: TPData | null;
  uiItemsCount?: number;
  validation?: TPValidationDetails | null;
  atp?: ATPData | null;
  learningPlanGate?: 'ALLOWED' | 'BLOCKED';
  learningPlanGateReason?: string;
}): string {
  const phaseRaw = data.context?.phase || data.academicSetting?.phase || '';
  const tpPhaseRaw = data.tp?.phase || '';
  const validation = data.validation;
  const issues = validation?.issues?.length ? validation.issues.map((issue) => `- ${issue}`) : ['- none'];
  return [
    'ADMINISTRASI GURU AI - DIAGNOSTIC REPORT',
    '',
    'Build:',
    APP_BUILD_ID,
    '',
    'Module:',
    data.module || 'TP',
    '',
    'GeneratedAt:',
    new Date().toISOString(),
    '',
    'Context:',
    line('workspaceId', data.workspaceId),
    line('academicSettingId', data.academicSetting?.id),
    line('curriculumType', data.academicSetting?.curriculumType || data.context?.curriculumType),
    line('academicYear', data.academicSetting?.academicYear || data.context?.academicYear),
    line('semester', data.academicSetting?.semester || data.context?.semester),
    line('level', data.academicSetting?.level || data.context?.level),
    line('grade', data.academicSetting?.grade || data.context?.grade),
    line('phaseRaw', phaseRaw),
    line('phaseNormalized', normalizePhaseCode(phaseRaw)),
    line('subject', data.academicSetting?.subject || data.context?.subject),
    '',
    'TP:',
    line('id', data.tp?.id),
    line('uiItemsCount', data.uiItemsCount ?? data.tp?.items?.length ?? 0),
    line('storedItemsCount', data.tp?.items?.length ?? 0),
    line('workflowStatus', data.tp?.workflowStatus),
    line('runtimeValidationStatus', validation?.status),
    line('runtimeIsSiap', validation?.isSiap),
    line('needsReview', data.tp?.needsReview || false),
    line('generatedBy', data.tp?.generatedBy),
    line('updatedAt', data.tp?.updatedAt),
    line('storedPhaseRaw', tpPhaseRaw),
    line('storedPhaseNormalized', normalizePhaseCode(tpPhaseRaw)),
    '',
    'TP Validation Issues:',
    ...issues,
    '',
    'Downstream:',
    line('atpItemsCount', data.atp?.items?.length ?? 0),
    line('atpWorkflowStatus', data.atp?.workflowStatus),
    line('atpNeedsReview', data.atp?.needsReview || false),
    line('learningPlanGate', data.learningPlanGate || '-'),
    line('learningPlanGateReason', data.learningPlanGateReason || '-'),
    '',
    'Recent Diagnostic Events:',
    ...formatEvents(data.module || 'TP'),
  ].join('\n');
}
