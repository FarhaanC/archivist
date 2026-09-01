/**
 * Organizer Phase 1: pure classification logic (fully testable).
 * Takes a read-only scan and produces a PLAN — nothing is ever written here.
 *
 * Safety model (see Project Docs/organizer-plan.md):
 *  - Layer 1: only allowlisted document types are ever sortable
 *  - Layer 2: code projects / app & game installs are atomic units,
 *    excluded wholesale by the scanner before we even get here
 */

import { isOrganizableFile } from '@/upload/collect-files';

export interface ScannedFile {
    path: string;
    name: string;
    size: number;
    /** directory relative to the scan root */
    dir: string;
}

export interface ScannedUnit {
    path: string;
    kind: string;
    fileCount: number;
}

export interface ScanResult {
    root: string;
    files: ScannedFile[];
    units: ScannedUnit[];
    truncated: boolean;
}

export interface OrganizePlan {
    root: string;
    /** category -> files that would be copied there */
    groups: Record<string, ScannedFile[]>;
    /** atomic folders left alone (code, games, apps) */
    excludedUnits: ScannedUnit[];
    /** files not touched because their type isn't allowlisted */
    untouched: { name: string; dir: string; reason: string }[];
    truncated: boolean;
}

interface CategoryRule {
    category: string;
    /** matched against the lowercased file name AND its relative dir */
    keywords: string[];
}

// Order matters: first match wins. Filename/path keywords are a strong Phase 1
// baseline; Phase 1.5 adds content-based classification via the library brain.
const CATEGORY_RULES: CategoryRule[] = [
    {
        category: 'Personal — ID & Government',
        keywords: ['passport', 'visa', 'license', 'licence', 'id-card', 'idcard', 'national-id', 'birth', 'certificate', 'ssn', 'social-security', 'emirates-id', 'residence', 'immigration', 'government', 'tax', 'vat'],
    },
    {
        category: 'Personal — Finance',
        keywords: ['invoice', 'receipt', 'statement', 'bank', 'salary', 'payslip', 'pay-slip', 'budget', 'insurance', 'loan', 'mortgage'],
    },
    {
        category: 'Work — CV & Applications',
        keywords: ['cv', 'resume', 'cover-letter', 'coverletter', 'application', 'offer-letter', 'offer_letter'],
    },
    {
        category: 'Work — Contracts & Documents',
        keywords: ['contract', 'agreement', 'nda', 'proposal', 'report', 'minutes', 'memo', 'spec', 'specification', 'datasheet', 'manual', 'guide'],
    },
    {
        category: 'Writing — Book & Drafts',
        keywords: ['chapter', 'draft', 'manuscript', 'book', 'novel', 'story', 'outline', 'synopsis'],
    },
    {
        category: 'Study & Reference',
        keywords: ['lecture', 'notes', 'course', 'tutorial', 'thesis', 'paper', 'assignment', 'exam'],
    },
];

const EXT_FALLBACK_CATEGORIES: { category: string; exts: string[] }[] = [
    { category: 'Photos & Images', exts: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] },
    { category: 'Audio & Recordings', exts: ['mp3', 'wav', 'm4a', 'webm', 'ogg', 'flac'] },
    { category: 'Spreadsheets', exts: ['xlsx', 'xls', 'ods', 'csv', 'tsv'] },
    { category: 'Presentations', exts: ['pptx'] },
];

const FALLBACK_CATEGORY = 'Documents — Unsorted';

const extOf = (name: string): string => name.split('.').pop()?.toLowerCase() ?? '';

export const classifyFile = (file: ScannedFile): string => {
    const haystack = (file.dir + ' ' + file.name).toLowerCase().replace(/[_\s]+/g, '-');
    for (const rule of CATEGORY_RULES) {
        if (rule.keywords.some((k) => haystack.includes(k))) return rule.category;
    }
    const ext = extOf(file.name);
    for (const fb of EXT_FALLBACK_CATEGORIES) {
        if (fb.exts.includes(ext)) return fb.category;
    }
    return FALLBACK_CATEGORY;
};

export const buildPlan = (scan: ScanResult): OrganizePlan => {
    const groups: Record<string, ScannedFile[]> = {};
    const untouched: OrganizePlan['untouched'] = [];

    for (const file of scan.files) {
        if (!isOrganizableFile(file.name)) {
            const ext = extOf(file.name);
            untouched.push({
                name: file.name,
                dir: file.dir,
                reason: ext ? `.${ext} is not a document type Archivist handles` : 'No extension',
            });
            continue;
        }
        const category = classifyFile(file);
        (groups[category] ??= []).push(file);
    }

    // Stable ordering: rule categories first (their declared order), then
    // extension fallbacks, then unsorted last.
    const order = [
        ...CATEGORY_RULES.map((r) => r.category),
        ...EXT_FALLBACK_CATEGORIES.map((f) => f.category),
        FALLBACK_CATEGORY,
    ];
    const ordered: Record<string, ScannedFile[]> = {};
    for (const cat of order) {
        if (groups[cat]?.length) ordered[cat] = groups[cat];
    }

    return {
        root: scan.root,
        groups: ordered,
        excludedUnits: scan.units,
        untouched,
        truncated: scan.truncated,
    };
};
