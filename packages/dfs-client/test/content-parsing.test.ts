import { describe, expect, it } from 'vitest';

import { onPageContentParsingEndpoint, parsePageContent } from '../src/index.js';
import { loadFixture } from './helpers.js';

describe('parsePageContent', () => {
    it('separates the navigation, the body sections, the footer and the ratings', () => {
        const envelope = loadFixture('onpage-content-parsing-example-home');
        const result = onPageContentParsingEndpoint.parse(envelope.tasks[0]!)[0]!;
        const item = result.items![0]!;
        const page = parsePageContent(item.page_content, item.page_as_markdown ?? null);
        expect(page.navLinks.length).toBeGreaterThan(4);
        expect(page.navLinks[0]).toEqual({
            text: 'Boiler Repair',
            url: 'https://plumbers-r-us.example/services/boiler-repair/',
        });
        expect(page.main[0]?.title).toMatch(/^Plumbers R Us: Plumbers in Northbridge/);
        expect(page.main[0]?.level).toBe(1);
        expect(page.main[1]?.paragraphs.length).toBeGreaterThan(1);
        expect(page.secondary.some((section) => section.title === 'Services')).toBe(true);
        expect(page.footerParagraphs[0]).toMatch(/^Plumbers R Us, fixing pipes/);
        expect(page.footerLinks).toEqual([
            { text: 'Privacy', url: 'https://plumbers-r-us.example/privacy/' },
        ]);
        expect(page.ratings[0]).toEqual({ value: 4.8, count: 36 });
        expect(page.markdown === null || typeof page.markdown === 'string').toBe(true);
    });

    it('returns empty structures for a page with no content', () => {
        const page = parsePageContent(null);
        expect(page).toEqual({
            navLinks: [],
            main: [],
            secondary: [],
            footerParagraphs: [],
            footerLinks: [],
            ratings: [],
            markdown: null,
        });
    });
});
