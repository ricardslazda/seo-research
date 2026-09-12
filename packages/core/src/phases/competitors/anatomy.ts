import { stripWww, type PageLink, type ParsedPage } from '@seo/dfs-client';

import type { Market } from '../../config/market.js';

export interface Anatomy {
    title: string | null;
    wordCount: number;
    headingsCount: number;
    questionsCount: number;
    phoneCount: number;
    hasPrices: boolean;
    ratingValue: number | null;
    ratingCount: number | null;
    headings: string[];
    navLinks: PageLink[];
    bodyLinks: PageLink[];
}

// A phone number has between seven and fifteen digits, whatever the market writes around them.
function phoneCount(text: string, phone: RegExp): number {
    const digits = (text.match(phone) ?? [])
        .map((match) => match.replace(/\D/g, ''))
        .filter((number) => number.length >= 7 && number.length <= 15);
    return new Set(digits).size;
}

export function readAnatomy(page: ParsedPage, domain: string, market: Market): Anatomy {
    const sections = [...page.main, ...page.secondary];
    const headings = sections.map((section) => section.title).filter(Boolean);
    const paragraphs = sections.flatMap((section) => section.paragraphs);
    const allText = [
        ...headings,
        ...paragraphs,
        ...page.footerParagraphs,
        ...page.navLinks.map((l) => l.text),
    ].join('\n');
    const internal = (link: PageLink): boolean => {
        try {
            return stripWww(new URL(link.url).hostname) === stripWww(domain);
        } catch {
            return false;
        }
    };
    const unique = (links: PageLink[]): PageLink[] => {
        const seen = new Set<string>();
        return links.filter((link) => {
            const key = link.url.replace(/\/$/, '');
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    };
    return {
        title: page.main[0]?.title ?? headings[0] ?? null,
        wordCount: paragraphs.join(' ').split(/\s+/).filter(Boolean).length,
        headingsCount: headings.length,
        questionsCount: [...headings, ...paragraphs].filter((text) => text.trim().endsWith('?'))
            .length,
        phoneCount: phoneCount(allText, market.phone),
        hasPrices: market.price?.test(allText) ?? false,
        ratingValue: page.ratings[0]?.value ?? null,
        ratingCount: page.ratings[0]?.count ?? null,
        headings,
        navLinks: unique(page.navLinks.filter(internal)),
        bodyLinks: unique(sections.flatMap((section) => section.links).filter(internal)),
    };
}
