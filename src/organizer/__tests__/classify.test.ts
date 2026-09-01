import { describe, test, expect } from 'bun:test';
import { buildPlan, classifyFile, type ScanResult } from '../classify';

const f = (name: string, dir = '') => ({ path: `/x/${dir}/${name}`, name, size: 100, dir });

describe('classifyFile', () => {
    test('government / ID documents', () => {
        expect(classifyFile(f('passport-scan.pdf'))).toBe('Personal — ID & Government');
        expect(classifyFile(f('Tax Return 2025.pdf'))).toBe('Personal — ID & Government');
        expect(classifyFile(f('scan001.pdf', 'Visa Documents'))).toBe('Personal — ID & Government');
    });

    test('finance, work, writing categories', () => {
        expect(classifyFile(f('invoice_march.pdf'))).toBe('Personal — Finance');
        expect(classifyFile(f('Farhaan_CV_2026.docx'))).toBe('Work — CV & Applications');
        expect(classifyFile(f('employment contract.pdf'))).toBe('Work — Contracts & Documents');
        expect(classifyFile(f('chapter-12-final.docx', 'My Book'))).toBe('Writing — Book & Drafts');
    });

    test('directory names count as signal', () => {
        expect(classifyFile(f('final.docx', 'Novel/Drafts'))).toBe('Writing — Book & Drafts');
    });

    test('extension fallbacks and unsorted', () => {
        expect(classifyFile(f('IMG_2041.jpg'))).toBe('Photos & Images');
        expect(classifyFile(f('data.xlsx'))).toBe('Spreadsheets');
        expect(classifyFile(f('random.pdf'))).toBe('Documents — Unsorted');
    });

    test('rule match beats extension fallback', () => {
        expect(classifyFile(f('passport.jpg'))).toBe('Personal — ID & Government');
    });
});

describe('buildPlan', () => {
    const scan: ScanResult = {
        root: '/x',
        files: [
            f('passport.pdf'),
            f('invoice.pdf'),
            f('game-save.sav'),
            f('setup.exe'),
            f('photo.png'),
        ],
        units: [{ path: '/x/my-repo', kind: 'code project', fileCount: 120 }],
        truncated: false,
    };

    test('groups sortable files, excludes units, leaves unknown types untouched', () => {
        const plan = buildPlan(scan);
        expect(plan.groups['Personal — ID & Government']).toHaveLength(1);
        expect(plan.groups['Personal — Finance']).toHaveLength(1);
        expect(plan.groups['Photos & Images']).toHaveLength(1);
        expect(plan.excludedUnits).toHaveLength(1);
        expect(plan.excludedUnits[0]?.kind).toBe('code project');
        // .sav and .exe must never be sortable — layer-1 allowlist
        expect(plan.untouched.map((u) => u.name).sort()).toEqual(['game-save.sav', 'setup.exe']);
    });

    test('empty groups are omitted and order is stable', () => {
        const plan = buildPlan(scan);
        const cats = Object.keys(plan.groups);
        expect(cats[0]).toBe('Personal — ID & Government');
        expect(cats).not.toContain('Writing — Book & Drafts');
    });
});
