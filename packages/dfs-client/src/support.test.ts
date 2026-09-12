import { describe, expect, it } from 'vitest';

import {
    UnknownLocationError,
    UnsupportedPairError,
    createGate,
    type LanguageSupport,
    type LocationIndex,
} from './support.js';

const locations: LocationIndex = {
    '2999': {
        code: 2999,
        name: 'Testland',
        type: 'Country',
        parent: null,
        countryIso: 'ZZ',
        sources: ['serp', 'labs'],
    },
    '1001001': {
        code: 1001001,
        name: 'Northbridge,Testland',
        type: 'City',
        parent: 2999,
        countryIso: 'ZZ',
        sources: ['serp', 'ads'],
    },
};

const support: LanguageSupport = {
    global: { ads: ['en', 'es'], serp: ['en', 'es'] },
    countries: { ZZ: { labs: ['en'] } },
    intentLanguages: ['en'],
};

describe('createGate', () => {
    const gate = createGate(support, locations);

    it('lets a supported pair through for the country and its cities', () => {
        expect(() => gate('labs', { locationCode: 2999, languageCode: 'en' })).not.toThrow();
        expect(() => gate('ads', { locationCode: 1001001, languageCode: 'es' })).not.toThrow();
        expect(() => gate('serp', { locationCode: 1001001, languageCode: 'es' })).not.toThrow();
    });

    it('refuses a language the keyword database lacks in the country', () => {
        expect(() => gate('labs', { locationCode: 2999, languageCode: 'es' })).toThrow(
            UnsupportedPairError,
        );
        expect(() => gate('labs', { locationCode: 1001001, languageCode: 'es' })).toThrow(
            /do not support language "es" in ZZ/,
        );
    });

    it('does not gate a family with no recorded matrix', () => {
        expect(() => gate('backlinks', { locationCode: 2999, languageCode: 'xx' })).not.toThrow();
    });

    it('refuses a location it has never seen', () => {
        expect(() => gate('ads', { locationCode: 1, languageCode: 'en' })).toThrow(
            UnknownLocationError,
        );
    });
});
