export function chunk<T>(items: readonly T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
    return out;
}

export function normalizeKeyword(keyword: string): string {
    return keyword.normalize('NFC').trim().replace(/\s+/g, ' ');
}

export function keywordKey(keyword: string): string {
    return normalizeKeyword(keyword).toLowerCase();
}

export function uniqueKeywords(keywords: readonly string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of keywords) {
        const keyword = normalizeKeyword(raw);
        if (!keyword) continue;
        const key = keyword.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(keyword);
    }
    return out;
}

export function stripWww(domain: string): string {
    return domain.toLowerCase().replace(/^www\./, '');
}

export interface BatchResult<Row> {
    rows: Row[];
    missing: string[];
    rawIds: number[];
    cost: number;
    cachedCalls: number;
}

const ADS_FORBIDDEN = /[,;:"'`()[\]{}<>&+=!?@#$%^*|\\/]/u;

export function isAdsSafeKeyword(keyword: string): boolean {
    const text = normalizeKeyword(keyword);
    if (!text || text.length > 80) return false;
    if (text.split(' ').length > 10) return false;
    return !ADS_FORBIDDEN.test(text);
}
