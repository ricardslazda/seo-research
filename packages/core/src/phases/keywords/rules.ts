import type { SiteConfig } from '../../config/site-config.js';
import { foldAscii, placeTokens, stem, transliterate } from '../screen/rules.js';

export type ExclusionReason = string;

// Modifiers spelled alike in most languages: a round-the-clock 24 and a comparison's vs. A
// configured pattern of the same name extends the default instead of replacing it.
const DEFAULT_MODIFIERS: Record<string, string> = { urgency: '\\b24\\b', comparison: '\\bvs\\b' };

// The trade's words as the site config states them, compiled once per reading. Brands are
// folded here; brand, out_of_area and off_topic are decided by rules, every other reason is a
// pattern the config named.
export interface Vocabulary {
    topicStems: string[];
    nonDistinctive: string[];
    brands: string[];
    exclusions: [string, RegExp][];
    outOfArea: RegExp | null;
    near: RegExp | null;
    modifiers: [string, RegExp][];
}

function modifierPatterns(configured: Record<string, string>): [string, RegExp][] {
    const names = [...new Set([...Object.keys(configured), ...Object.keys(DEFAULT_MODIFIERS)])];
    return names.map((name) => {
        const sources = [DEFAULT_MODIFIERS[name], configured[name]].filter(
            (source): source is string => source !== undefined,
        );
        return [name, new RegExp(sources.map((source) => `(?:${source})`).join('|'), 'i')];
    });
}

export function emptyVocabulary(): Vocabulary {
    return {
        topicStems: [],
        nonDistinctive: [],
        brands: [],
        exclusions: [],
        outOfArea: null,
        near: null,
        modifiers: modifierPatterns({}),
    };
}

export function vocabularyOf(config: SiteConfig): Vocabulary {
    const block = config.vocabulary;
    if (!block) return emptyVocabulary();
    const compile = (patterns: Record<string, string>): [string, RegExp][] =>
        Object.entries(patterns).map(([name, source]) => [name, new RegExp(source, 'i')]);
    return {
        topicStems: [...block.topic_stems],
        nonDistinctive: [...block.non_distinctive],
        brands: block.brands.map(foldedLatin),
        exclusions: compile(block.exclusions),
        outOfArea: block.out_of_area ? new RegExp(block.out_of_area, 'i') : null,
        near: block.near ? new RegExp(block.near, 'i') : null,
        modifiers: modifierPatterns(block.modifiers),
    };
}

export function foldedLatin(text: string): string {
    return transliterate(foldAscii(text));
}

export function wordStart(folded: string, stem: string): boolean {
    if (stem.includes(' ')) return folded.includes(stem);
    return folded.split(/\s+/).some((word) => word.startsWith(stem));
}

export function serviceStemsByKey(config: SiteConfig): Map<string, string[]> {
    const out = new Map<string, string[]>();
    for (const service of config.services) {
        const stems = new Set<string>();
        for (const forms of Object.values(service.head)) {
            for (const form of Object.values(forms)) {
                for (const word of foldedLatin(form).split(/\s+/)) {
                    if (word.length >= 4) stems.add(stem(word));
                }
            }
        }
        out.set(service.key, [...stems]);
    }
    return out;
}

export interface Attribution {
    services: string[];
    primary: string | null;
    fullMatch: boolean;
}

export function serviceFormsByKey(config: SiteConfig): Map<string, string[][]> {
    const out = new Map<string, string[][]>();
    for (const service of config.services) {
        const forms: string[][] = [];
        for (const languageForms of Object.values(service.head)) {
            for (const form of Object.values(languageForms)) {
                const stems = foldedLatin(form)
                    .split(/\s+/)
                    .filter((word) => word.length >= 4)
                    .map((word) => stem(word));
                if (stems.length > 0) forms.push(stems);
            }
        }
        out.set(service.key, forms);
    }
    return out;
}

export function isGenericStem(stemText: string, nonDistinctive: string[]): boolean {
    return nonDistinctive.some((g) => g.startsWith(stemText) || stemText.startsWith(g));
}

export function attributeServices(
    text: string,
    formsByKey: Map<string, string[][]>,
    nonDistinctive: string[] = [],
): Attribution {
    const folded = foldedLatin(text);
    const scored: { key: string; score: number; full: boolean }[] = [];
    for (const [key, forms] of formsByKey) {
        let best = 0;
        let full = false;
        for (const stems of forms) {
            const matched = stems.filter((s) => wordStart(folded, s));
            if (matched.length === 0) continue;
            if (!matched.some((s) => !isGenericStem(s, nonDistinctive))) continue;
            const matchedChars = matched.reduce((sum, s) => sum + s.length, 0);
            const totalChars = stems.reduce((sum, s) => sum + s.length, 0);
            const coverage = matchedChars / totalChars;
            if (coverage <= 0.5) continue;
            const score = coverage * matchedChars;
            if (score > best) best = score;
            if (matched.length === stems.length) full = true;
        }
        if (best > 0) scored.push({ key, score: best, full });
    }
    scored.sort(
        (a, b) =>
            Number(b.full) - Number(a.full) || b.score - a.score || a.key.localeCompare(b.key),
    );
    return {
        services: scored.map((s) => s.key),
        primary: scored[0]?.key ?? null,
        fullMatch: scored[0]?.full ?? false,
    };
}

export function exclusionFor(
    text: string,
    placeStems: string[],
    vocabulary: Vocabulary,
    fullServiceMatch: boolean,
): ExclusionReason | null {
    const folded = foldedLatin(text);
    const words = folded.split(/\s+/);
    if (
        vocabulary.brands.some(
            (brand) =>
                words.includes(brand) ||
                folded.includes(brand + ' ') ||
                folded.endsWith(' ' + brand),
        )
    )
        return 'brand';
    for (const [reason, pattern] of vocabulary.exclusions) {
        if (pattern.test(folded)) return reason;
    }
    if (vocabulary.outOfArea?.test(folded) && !placeStems.some((p) => folded.includes(p)))
        return 'out_of_area';
    if (
        vocabulary.topicStems.length > 0 &&
        !fullServiceMatch &&
        !vocabulary.topicStems.some((g) => wordStart(folded, g))
    )
        return 'off_topic';
    return null;
}

export type Modifier = string;

export function modifiersFor(
    text: string,
    placeStems: string[],
    vocabulary: Vocabulary,
): Modifier[] {
    const folded = foldedLatin(text);
    const out: Modifier[] = [];
    if (placeStems.some((p) => folded.includes(p)) || vocabulary.near?.test(folded))
        out.push('place');
    for (const [name, pattern] of vocabulary.modifiers) {
        if (pattern.test(folded)) out.push(name);
    }
    return out;
}

export function formKey(text: string): string {
    return foldedLatin(text)
        .split(/\s+/)
        .filter((word) => word.length > 0)
        .map((word) => (word.length >= 5 ? stem(word) : word))
        .sort()
        .join(' ');
}

export function placeStemsFor(config: SiteConfig): string[] {
    return placeTokens({ config });
}
