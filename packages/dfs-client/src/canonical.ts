import { createHash } from 'node:crypto';

export interface CanonicalOptions {
    unorderedArrays?: readonly string[];
}

export function codePointCompare(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
}

function walk(value: unknown, unordered: ReadonlySet<string>, key: string): unknown {
    if (value === null || value === undefined) return undefined;
    if (typeof value === 'string') return value.normalize('NFC').trim();
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw new TypeError(`non-finite number at "${key}"`);
        return value;
    }
    if (typeof value === 'boolean') return value;
    if (Array.isArray(value)) {
        const items = value
            .map((item) => walk(item, unordered, key))
            .filter((item) => item !== undefined);
        if (!unordered.has(key)) return items;
        const byJson = new Map<string, unknown>();
        for (const item of items) byJson.set(JSON.stringify(item), item);
        return [...byJson.keys()].sort(codePointCompare).map((json) => byJson.get(json));
    }
    if (typeof value === 'object') {
        const record = value as Record<string, unknown>;
        const out: Record<string, unknown> = {};
        for (const childKey of Object.keys(record).sort(codePointCompare)) {
            const child = walk(record[childKey], unordered, childKey);
            if (child !== undefined) out[childKey] = child;
        }
        return out;
    }
    throw new TypeError(`unsupported value at "${key}"`);
}

export function canonicalize(value: unknown, options: CanonicalOptions = {}): unknown {
    return walk(value, new Set(options.unorderedArrays ?? []), '');
}

export function canonicalJson(value: unknown, options: CanonicalOptions = {}): string {
    return JSON.stringify(canonicalize(value, options) ?? null);
}

export function requestHash(path: string, body: unknown, options: CanonicalOptions = {}): string {
    return createHash('sha256')
        .update(path + '\n' + canonicalJson(body, options))
        .digest('hex');
}
