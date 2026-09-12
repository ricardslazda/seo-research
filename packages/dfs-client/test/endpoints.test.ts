import { describe, expect, it } from 'vitest';

import {
    DfsClient,
    MemoryCacheStore,
    adsSearchVolume,
    adsSearchVolumeEndpoint,
    bulkReferringDomains,
    bulkReferringDomainsEndpoint,
    labsLocationsAndLanguagesEndpoint,
    serpOrganicEndpoint,
} from '../src/index.js';
import { fixtureTransport, loadFixture } from './helpers.js';

const client = (byPath: Parameters<typeof fixtureTransport>[0]) => {
    const { sent, transport } = fixtureTransport(byPath);
    return { sent, client: new DfsClient({ transport, store: new MemoryCacheStore() }) };
};

describe('ads.search_volume', () => {
    it('parses measured, below-floor and spell-corrected rows and reconciles what was sent', async () => {
        const { client: c } = client({
            [adsSearchVolumeEndpoint.path]: loadFixture('ads-search-volume-en'),
        });
        const result = await adsSearchVolume(c, {
            keywords: [
                'plumber',
                'plumber northbridge',
                'plumbers northbridge',
                'plumbr',
                'plumber in northbridge',
            ],
            location_code: 1001001,
            language_code: 'en',
        });
        const byKeyword = new Map(result.rows.map((row) => [row.keyword, row]));
        expect(byKeyword.get('plumber northbridge')?.search_volume).toBe(210);
        expect(byKeyword.get('plumber northbridge')?.monthly_searches).toHaveLength(12);
        expect(byKeyword.get('plumbr')?.['spell']).toBe('plumber');
        expect(byKeyword.get('plumbr')?.search_volume).toBe(320);
        expect(byKeyword.get('plumbers northbridge')?.search_volume).toBeNull();
        expect(byKeyword.get('plumbers northbridge')?.monthly_searches).toBeNull();
        expect(result.missing).toEqual(['plumber in northbridge']);
        expect(result.cost).toBeCloseTo(0.09);
    });

    it('costs a flat request price whatever the keyword count', () => {
        expect(
            adsSearchVolumeEndpoint.price({
                keywords: ['a'],
                location_code: 1,
                language_code: 'en',
            }),
        ).toBe(0.09);
    });
});

describe('serp.google.organic', () => {
    it('parses a result page with its pack and questions', async () => {
        const { client: c, sent } = client({
            [serpOrganicEndpoint.path]: loadFixture('serp-organic-en'),
        });
        const call = await c.call(serpOrganicEndpoint, {
            keyword: 'plumber northbridge',
            location_code: 1001001,
            language_code: 'en',
        });
        expect(sent[0]?.body).toEqual([
            {
                device: 'mobile',
                os: 'android',
                depth: 20,
                keyword: 'plumber northbridge',
                location_code: 1001001,
                language_code: 'en',
            },
        ]);
        const serp = call.rows[0];
        expect(serp?.item_types).toContain('local_pack');
        const organic = serp?.items.filter((item) => item.type === 'organic') ?? [];
        expect(organic[0]?.rank_absolute).toBe(1);
        expect(organic[0]?.domain).toBe('directory-one.example');
        const pack = serp?.items.filter((item) => item.type === 'local_pack') ?? [];
        expect(pack.map((item) => item.rating?.votes_count)).toEqual([48, 21]);
    });

    it('prices two pages for the fixed depth of twenty', () => {
        expect(
            serpOrganicEndpoint.price({
                keyword: 'x',
                location_code: 1,
                language_code: 'en',
                depth: 20,
            }),
        ).toBeCloseTo(0.004);
        expect(
            serpOrganicEndpoint.price({
                keyword: 'x',
                location_code: 1,
                language_code: 'en',
                depth: 10,
            }),
        ).toBeCloseTo(0.002);
    });
});

describe('backlinks.bulk_referring_domains', () => {
    it('strips www, dedupes targets and reports the ones that came back empty', async () => {
        const fixture = loadFixture('ads-search-volume-en');
        const envelope = {
            ...fixture,
            tasks: [
                {
                    ...fixture.tasks[0]!,
                    cost: 0.02,
                    result: [
                        {
                            items: [
                                {
                                    target: 'directory-one.example',
                                    referring_domains: 410,
                                    backlinks: 900,
                                    referring_main_domains: 300,
                                },
                            ],
                        },
                    ],
                },
            ],
        };
        const { client: c, sent } = client({ [bulkReferringDomainsEndpoint.path]: envelope });
        const result = await bulkReferringDomains(c, [
            'www.directory-one.example',
            'directory-one.example',
            'classifieds-hub.example',
        ]);
        expect(sent[0]?.body).toEqual([
            { targets: ['directory-one.example', 'classifieds-hub.example'] },
        ]);
        expect(result.rows[0]?.referring_domains).toBe(410);
        expect(result.missing).toEqual(['classifieds-hub.example']);
    });
});

describe('labs.locations_and_languages', () => {
    it('lists the keyword database languages of each country', async () => {
        const { client: c } = client({
            [labsLocationsAndLanguagesEndpoint.path]: loadFixture('labs-locations-and-languages'),
        });
        const call = await c.call(labsLocationsAndLanguagesEndpoint, {});
        const testland = call.rows.find((row) => row.country_iso_code === 'ZZ');
        expect(testland?.location_code).toBe(2999);
        expect(testland?.available_languages.map((language) => language.language_code)).toEqual([
            'en',
        ]);
    });
});
