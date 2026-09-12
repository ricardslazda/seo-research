import { z } from 'zod';

import { defineEndpoint } from '../endpoint.js';

export const ContentParsingResult = z.looseObject({
    crawl_progress: z.string().nullable().optional(),
    items: z
        .array(
            z.looseObject({
                type: z.string().nullable().optional(),
                status_code: z.number().nullable().optional(),
                fetch_time: z.string().nullable().optional(),
                page_content: z.record(z.string(), z.unknown()).nullable().optional(),
                page_as_markdown: z.string().nullable().optional(),
            }),
        )
        .nullable()
        .optional(),
});
export type ContentParsingResult = z.infer<typeof ContentParsingResult>;

export interface ContentParsingRequest {
    url: string;
    enable_javascript?: boolean;
    custom_user_agent?: string;
}

export const onPageContentParsingEndpoint = defineEndpoint<
    ContentParsingRequest,
    ContentParsingResult
>({
    name: 'onpage.content_parsing',
    path: '/v3/on_page/content_parsing/live',
    method: 'POST',
    family: 'onpage',
    defaults: {},
    unorderedArrays: [],
    price: () => 0.000125,
    gate: () => null,
    parse: (task) => z.array(ContentParsingResult).parse(task.result ?? []),
});

export interface PageLink {
    text: string;
    url: string;
}

export interface PageSection {
    title: string;
    level: number | null;
    paragraphs: string[];
    links: PageLink[];
}

export interface ParsedPage {
    navLinks: PageLink[];
    main: PageSection[];
    secondary: PageSection[];
    footerParagraphs: string[];
    footerLinks: PageLink[];
    ratings: { value: number | null; count: number | null }[];
    markdown: string | null;
}

interface Entry {
    text: string;
    url: string | null;
    urls: { url: string; anchor: string }[];
}

function entries(list: unknown): Entry[] {
    if (!Array.isArray(list)) return [];
    const out: Entry[] = [];
    for (const node of list) {
        if (!node || typeof node !== 'object') continue;
        const record = node as Record<string, unknown>;
        const text = typeof record['text'] === 'string' ? record['text'].trim() : '';
        const url = typeof record['url'] === 'string' ? record['url'] : null;
        const urls: { url: string; anchor: string }[] = [];
        if (Array.isArray(record['urls'])) {
            for (const item of record['urls']) {
                if (!item || typeof item !== 'object') continue;
                const link = item as Record<string, unknown>;
                if (typeof link['url'] === 'string') {
                    urls.push({
                        url: link['url'],
                        anchor:
                            typeof link['anchor_text'] === 'string'
                                ? link['anchor_text'].trim()
                                : text,
                    });
                }
            }
        }
        out.push({ text, url, urls });
    }
    return out;
}

function linksOf(list: Entry[]): PageLink[] {
    const links: PageLink[] = [];
    for (const entry of list) {
        if (entry.urls.length > 0) {
            for (const link of entry.urls)
                links.push({ text: link.anchor || entry.text, url: link.url });
        } else if (entry.url) {
            links.push({ text: entry.text, url: entry.url });
        }
    }
    return links;
}

function paragraphsOf(list: Entry[]): string[] {
    return list
        .filter((entry) => entry.text && entry.urls.length === 0 && !entry.url)
        .map((entry) => entry.text);
}

function sectionsOf(list: unknown): PageSection[] {
    if (!Array.isArray(list)) return [];
    const out: PageSection[] = [];
    for (const node of list) {
        if (!node || typeof node !== 'object') continue;
        const record = node as Record<string, unknown>;
        const primary = entries(record['primary_content']);
        const secondary = entries(record['secondary_content']);
        const levelRaw = record['level'];
        const level =
            typeof levelRaw === 'number'
                ? levelRaw
                : typeof levelRaw === 'string'
                  ? Number.parseInt(levelRaw, 10)
                  : null;
        out.push({
            title:
                typeof record['h_title'] === 'string'
                    ? record['h_title'].replace(/\s+/g, ' ').trim()
                    : '',
            level: level !== null && Number.isFinite(level) ? level : null,
            paragraphs: [...paragraphsOf(primary), ...paragraphsOf(secondary)],
            links: [...linksOf(primary), ...linksOf(secondary)],
        });
    }
    return out;
}

export function parsePageContent(
    pageContent: Record<string, unknown> | null | undefined,
    markdown: string | null = null,
): ParsedPage {
    const content = pageContent ?? {};
    const header = content['header'] as Record<string, unknown> | null | undefined;
    const footer = content['footer'] as Record<string, unknown> | null | undefined;
    const headerEntries = [
        ...entries(header?.['primary_content']),
        ...entries(header?.['secondary_content']),
    ];
    const footerEntries = [
        ...entries(footer?.['primary_content']),
        ...entries(footer?.['secondary_content']),
    ];
    const ratings: ParsedPage['ratings'] = [];
    if (Array.isArray(content['ratings'])) {
        for (const node of content['ratings']) {
            if (!node || typeof node !== 'object') continue;
            const record = node as Record<string, unknown>;
            const value = Number(record['rating_value']);
            const count = Number(record['rating_count']);
            ratings.push({
                value: Number.isFinite(value) ? value : null,
                count: Number.isFinite(count) ? count : null,
            });
        }
    }
    return {
        navLinks: linksOf(headerEntries),
        main: sectionsOf(content['main_topic']),
        secondary: sectionsOf(content['secondary_topic']),
        footerParagraphs: paragraphsOf(footerEntries),
        footerLinks: linksOf(footerEntries),
        ratings,
        markdown,
    };
}
