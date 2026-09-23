import { SchoolData } from '../../../../types';
import { INDONESIAN_MONTHS, formatOfficialDate } from '../../docxStyles';

export { INDONESIAN_MONTHS, formatOfficialDate };

export type PdfStyleProfile = 'DEFAULT' | 'FORMAL_NEUTRAL';

export const PDF_FORMAL_NEUTRAL_THEME = {
  colors: {
    primary: [0, 0, 0] as [number, number, number],
    primaryDark: [0, 0, 0] as [number, number, number],
    secondary: [0, 0, 0] as [number, number, number],
    text: [0, 0, 0] as [number, number, number],
    textLight: [50, 50, 50] as [number, number, number],
    border: [0, 0, 0] as [number, number, number],
    tableHeaderBg: [240, 240, 240] as [number, number, number],
    tableAltRowBg: [255, 255, 255] as [number, number, number],
    calloutBg: [248, 248, 248] as [number, number, number],
  },
  fonts: {
    base: 'times',
    bold: 'times',
  },
  sizes: {
    docTitle: 14,
    docSubTitle: 12,
    heading1: 12,
    heading2: 12,
    heading3: 11,
    body: 11,
    small: 10,
    tableHeader: 10,
    tableBody: 10,
    pageNumber: 9,
  },
  margins: {
    portrait: { top: 25, bottom: 25, left: 30, right: 25 },
    landscape: { top: 20, bottom: 20, left: 25, right: 20 },
  },
};

export const PDF_THEME = {
  colors: {
    primary: [30, 58, 138], // Deep Royal Navy #1E3A8A
    primaryDark: [15, 23, 42], // Slate 900 #0F172A
    secondary: [71, 85, 105], // Slate 600 #475569
    text: [30, 41, 59], // Slate 800 #1E293B
    textLight: [100, 116, 139], // Slate 500 #64748B
    border: [203, 213, 225], // Slate 300 #CBD5E1
    tableHeaderBg: [30, 58, 138], // Navy header
    tableAltRowBg: [248, 250, 252], // Slate 50 #F8FAFC
    calloutBg: [241, 245, 249], // Slate 100
  },
  fonts: {
    base: 'helvetica',
    bold: 'helvetica',
  },
  sizes: {
    docTitle: 13,
    docSubTitle: 10,
    heading1: 11,
    heading2: 10,
    body: 9,
    small: 8,
    tableHeader: 8.5,
    tableBody: 8,
    pageNumber: 7.5,
  },
  margins: {
    portrait: { top: 20, bottom: 20, left: 20, right: 20 },
    landscape: { top: 15, bottom: 18, left: 15, right: 15 },
  },
};
