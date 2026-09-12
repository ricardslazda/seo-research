import { keywordKey, normalizeKeyword } from '@seo/dfs-client';

import type { SiteConfig } from '../../config/site-config.js';

export type KeywordRole = 'head' | 'variant' | 'control';

export interface ComposedKeyword {
    text: string;
    language: string;
    locationCode: number;
    serviceKey: string;
    placeSlug: string | null;
    role: KeywordRole;
    formIndex: number | null;
    variantKind: string | null;
    headText: string | null;
}

export function composeKeywords(config: SiteConfig, countryCode?: number): ComposedKeyword[] {
    const out: ComposedKeyword[] = [];
    for (const language of config.languages) {
        const forms = config.head_forms[language] ?? [];
        for (const place of config.places) {
            const volumeLocation =
                place.volume_scope === 'country' && countryCode ? countryCode : place.location_code;
            const seen = new Set<string>();
            const push = (keyword: ComposedKeyword): void => {
                const key = keywordKey(keyword.text);
                if (seen.has(key)) return;
                seen.add(key);
                out.push(keyword);
            };
            for (const service of config.services) {
                let headText: string | null = null;
                for (const [formIndex, form] of forms.entries()) {
                    const term = service.head[language]?.[form.term];
                    const placeForm = place.name[language]?.[form.place];
                    if (!term || !placeForm) continue;
                    const text = normalizeKeyword(`${term} ${placeForm}`).toLowerCase();
                    const role: KeywordRole = headText === null ? 'head' : 'variant';
                    push({
                        text,
                        language,
                        locationCode: volumeLocation,
                        serviceKey: service.key,
                        placeSlug: place.slug,
                        role,
                        formIndex,
                        variantKind: role === 'variant' ? `${form.term}+${form.place}` : null,
                        headText,
                    });
                    if (headText === null) headText = text;
                }
                const control = service.head[language]?.['term'];
                if (control) {
                    push({
                        text: normalizeKeyword(control).toLowerCase(),
                        language,
                        locationCode: volumeLocation,
                        serviceKey: service.key,
                        placeSlug: null,
                        role: 'control',
                        formIndex: null,
                        variantKind: null,
                        headText: null,
                    });
                }
            }
        }
    }
    return out;
}
