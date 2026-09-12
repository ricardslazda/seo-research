import { describe, expect, it } from 'vitest';

import { parseSiteConfig } from '../../config/site-config.js';
import {
    attributeServices,
    emptyVocabulary,
    exclusionFor,
    formKey,
    modifiersFor,
    placeStemsFor,
    serviceFormsByKey,
    vocabularyOf,
} from './rules.js';

const northbridge = {
    slug: 'northbridge',
    location_code: 1001001,
    name: { en: { nom: 'Northbridge' } },
};
const headForms = { en: [{ term: 'term', place: 'nom' }] };

const plumbing = parseSiteConfig({
    slug: 's',
    languages: ['en'],
    places: [northbridge],
    services: [
        { key: 'boiler-repair', head: { en: { term: 'boiler repair' } } },
        { key: 'boiler-installation', head: { en: { term: 'boiler installation' } } },
        { key: 'drain-unblocking', head: { en: { term: 'drain unblocking' } } },
    ],
    head_forms: headForms,
    vocabulary: {
        topic_stems: ['plumb', 'boil', 'drain', 'pipe', 'leak', 'radiator', 'tap', 'toilet'],
        non_distinctive: ['boil'],
        brands: ['Acme', 'Globex'],
        exclusions: {
            jobs: '(\\bjobs?\\b|vacanc|apprentice|\\bsalary\\b)',
            training: '(\\bcourses?\\b|training|certificat)',
            diy: '(\\bdiy\\b|how to fix|how to unblock|yourself)',
            retail: '(\\bbuy\\b|\\bshop\\b|\\bcheap\\b|supplies|\\bparts\\b)',
            construction: '(\\bbuilders?\\b|extension|decorat|flooring)',
        },
        out_of_area: '(westmoor|southdale|lakeview)',
        near: '(near me|nearby|\\blocal\\b)',
        modifiers: {
            price: '(\\bprices?\\b|\\bcosts?\\b|how much|\\bquotes?\\b)',
            urgency: '(emergency|urgent|same day)',
            question: '^(how|what|why|when|where|who|which|can|do|does|is|are|should)\\b',
            comparison: '(\\bor\\b|versus|compared|\\bbetter\\b)',
            material: '(copper|plastic|\\blead\\b|\\bpvc\\b|combi|\\bgas\\b)',
        },
    },
});
const stems = serviceFormsByKey(plumbing);
const places = placeStemsFor(plumbing);
const vocabulary = vocabularyOf(plumbing);

describe('attributeServices', () => {
    const attribute = (text: string) =>
        attributeServices(text, stems, vocabulary.nonDistinctive).primary;
    it('picks the service whose forms match most', () => {
        expect(attribute('combi boiler repair northbridge')).toBe('boiler-repair');
        expect(attribute('boiler installation cost')).toBe('boiler-installation');
        expect(attribute('boilers repaired')).toBe('boiler-repair');
        expect(attribute('blocked drain unblocking')).toBe('drain-unblocking');
        expect(attribute('weather tomorrow')).toBeNull();
        expect(attribute('boil')).toBeNull();
        expect(attribute('kettle repair')).toBeNull();
    });
});

describe('exclusionFor', () => {
    const check = (text: string) =>
        exclusionFor(
            text,
            places,
            vocabulary,
            attributeServices(text, stems, vocabulary.nonDistinctive).fullMatch,
        );
    it('names the reason a keyword cannot be a page', () => {
        expect(check('acme boilers')).toBe('brand');
        expect(check('boiler service globex')).toBe('brand');
        expect(check('plumber jobs')).toBe('jobs');
        expect(check('plumbing courses')).toBe('training');
        expect(check('how to unblock a drain yourself')).toBe('diy');
        expect(check('cheap boiler parts shop')).toBe('retail');
        expect(check('house extension builders')).toBe('construction');
        expect(check('boiler repair westmoor')).toBe('out_of_area');
        expect(check('weather tomorrow')).toBe('off_topic');
        expect(check('kettle repair')).toBe('off_topic');
        expect(check('car radio')).toBe('off_topic');
        expect(check('leaking pipe repair cost')).toBeNull();
        expect(check('drain supplies buy')).toBe('retail');
        expect(check('boiler repair northbridge')).toBeNull();
        expect(check('boiler making a noise')).toBeNull();
        expect(check('drain unblocking price')).toBeNull();
    });
    it('excludes nothing when the config names no vocabulary, and only brands when it names brands', () => {
        const empty = emptyVocabulary();
        expect(exclusionFor('acme boilers', places, empty, false)).toBeNull();
        expect(exclusionFor('weather tomorrow', places, empty, false)).toBeNull();
        const brandsOnly = vocabularyOf(
            parseSiteConfig({ ...plumbing, vocabulary: { brands: ['Acme'] } }),
        );
        expect(exclusionFor('acme boilers', places, brandsOnly, false)).toBe('brand');
        expect(exclusionFor('weather tomorrow', places, brandsOnly, false)).toBeNull();
        expect(exclusionFor('boiler repair westmoor', places, brandsOnly, false)).toBeNull();
    });
});

describe('modifiersFor and formKey', () => {
    it('reads place, the configured modifiers and the defaults every site shares', () => {
        const read = (text: string) => modifiersFor(text, places, vocabulary);
        expect(read('boiler repair northbridge price')).toEqual(['place', 'price']);
        expect(read('emergency boiler repair')).toEqual(['urgency']);
        expect(read('how much does boiler repair cost')).toEqual(['price', 'question']);
        expect(read('how much is a plumber near me')).toEqual(['place', 'price', 'question']);
        expect(read('combi boiler repair')).toEqual(['material']);
        expect(read('24 hour plumber')).toEqual(['urgency']);
        expect(read('combi vs system boiler')).toEqual(['comparison', 'material']);
        expect(modifiersFor('combi boiler repair', places, emptyVocabulary())).toEqual([]);
        expect(modifiersFor('24 hour plumber vs handyman', places, emptyVocabulary())).toEqual([
            'urgency',
            'comparison',
        ]);
    });
    it('groups inflections, spellings and word orders', () => {
        expect(formKey('blocked drain')).toBe(formKey('blocked drains'));
        expect(formKey('blocked drain')).toBe(formKey('drain blocked'));
        expect(formKey('café plumbing')).toBe(formKey('cafe plumbing'));
        expect(formKey('blocked drain')).not.toBe(formKey('blocked drain price'));
    });
});

describe('a second trade', () => {
    const removals = parseSiteConfig({
        slug: 'r',
        languages: ['en'],
        places: [northbridge],
        services: [
            { key: 'house-removals', head: { en: { term: 'house removals' } } },
            { key: 'office-removals', head: { en: { term: 'office removals' } } },
        ],
        head_forms: headForms,
        vocabulary: {
            topic_stems: ['remova', 'movers', 'moving', 'relocat'],
            non_distinctive: ['remova'],
            exclusions: {
                storage: '(self storage|storage units?)',
                diy: '(van hire|hire a van)',
            },
            modifiers: { situation: '(short notice|last minute|overseas)' },
        },
    });
    const forms = serviceFormsByKey(removals);
    const words = vocabularyOf(removals);
    const attribute = (text: string) => attributeServices(text, forms, words.nonDistinctive);
    const check = (text: string) =>
        exclusionFor(text, placeStemsFor(removals), words, attribute(text).fullMatch);
    it('reads its own words without inheriting the first trade', () => {
        expect(attribute('house removals eastfield').primary).toBe('house-removals');
        expect(attribute('office removals').primary).toBe('office-removals');
        expect(attribute('removals').primary).toBeNull();
        expect(check('house removals northbridge')).toBeNull();
        expect(check('movers near me')).toBeNull();
        expect(check('self storage northbridge')).toBe('storage');
        expect(check('van hire northbridge')).toBe('diy');
        expect(check('weather tomorrow')).toBe('off_topic');
        expect(check('cheap removals')).toBeNull();
        expect(modifiersFor('house removals at short notice', [], words)).toEqual(['situation']);
        expect(modifiersFor('removals near me', [], words)).toEqual([]);
    });
});
