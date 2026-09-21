import { CalendarDayStatus, CalendarSourceType } from '../../types';

export interface NationalHolidayRecord {
  date: string; // YYYY-MM-DD
  name: string;
  type: 'NATIONAL_HOLIDAY' | 'CUTI_BERSAMA';
  year: number;
  regulationTitle: string;
  authority: string;
  sourceUrl?: string;
}

export interface RegionalCalendarEvent {
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  name: string;
  status: CalendarDayStatus;
  category:
    | 'SEMESTER_BREAK'
    | 'MID_SEMESTER_BREAK'
    | 'SCHOOL_EVENT'
    | 'ASSESSMENT'
    | 'REGIONAL_HOLIDAY'
    | 'RELIGIOUS_HOLIDAY'
    | 'OTHER';
  notes?: string;
}

export interface RegionalSemesterConfig {
  semester: '1' | '2';
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  events: RegionalCalendarEvent[];
  defaultSchoolDaysPerWeek?: 5 | 6;
}

export interface RegionalEducationCalendar {
  id: string;
  province: string;
  regency?: string; // Optional if specific to regency/city
  academicYear: string; // e.g. "2024/2025", "2025/2026", "2026/2027"
  authority: string; // e.g. "Dinas Pendidikan Provinsi Jawa Barat"
  documentTitle: string; // e.g. "Pedoman Penyusunan Kalender Pendidikan TP 2026/2027"
  documentNumber: string; // e.g. "SK Kadisdik No. 421.2/10006-Set.Disdik/2026"
  sourceUrl?: string;
  effectiveFrom: string;
  verifiedAt: string;
  semesters: {
    semester1: RegionalSemesterConfig;
    semester2: RegionalSemesterConfig;
  };
  notes?: string;
}
