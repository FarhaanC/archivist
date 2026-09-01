import JSZip from 'jszip';
import type { ParseResult } from '@/parsers/types';

/**
 * Parse PowerPoint (.pptx) into searchable text.
 * A .pptx is a zip of XML; slide text lives in <a:t> runs inside
 * ppt/slides/slideN.xml (and notesSlides for speaker notes).
 */
const extractTextRuns = (xml: string): string => {
    const runs: string[] = [];
    const re = /<a:t>([^<]*)<\/a:t>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml)) !== null) {
        if (m[1]) runs.push(m[1]);
    }
    return runs.join(' ').replace(/\s+/g, ' ').trim();
};

const decodeXmlEntities = (s: string): string =>
    s
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&');

const slideNumber = (path: string): number => {
    const m = path.match(/(\d+)\.xml$/);
    return m && m[1] ? parseInt(m[1], 10) : 0;
};

export const parsePptx = async (file: File): Promise<ParseResult> => {
    const zip = await JSZip.loadAsync(await file.arrayBuffer());

    const slidePaths = Object.keys(zip.files)
        .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
        .sort((a, b) => slideNumber(a) - slideNumber(b));
    const notesPaths = Object.keys(zip.files)
        .filter((p) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(p))
        .sort((a, b) => slideNumber(a) - slideNumber(b));

    if (slidePaths.length === 0) {
        throw new Error('No slides found in presentation');
    }

    const sections: string[] = [];
    for (const path of slidePaths) {
        const xml = await zip.files[path]?.async('text');
        if (!xml) continue;
        const text = decodeXmlEntities(extractTextRuns(xml));
        if (text) sections.push(`Slide ${slideNumber(path)}: ${text}`);
    }
    for (const path of notesPaths) {
        const xml = await zip.files[path]?.async('text');
        if (!xml) continue;
        const text = decodeXmlEntities(extractTextRuns(xml));
        if (text) sections.push(`Slide ${slideNumber(path)} notes: ${text}`);
    }

    const text = sections.join('\n\n');
    if (!text.trim()) {
        throw new Error('Presentation contains no readable text');
    }
    return { title: file.name, text };
};
