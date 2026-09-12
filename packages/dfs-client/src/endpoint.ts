import type { DfsTask } from './types.js';

export type Family = 'ads' | 'serp' | 'labs' | 'backlinks' | 'onpage' | 'free';

export interface PairRequest {
    locationCode: number;
    languageCode: string;
}

export interface EndpointDef<Request, Row> {
    name: string;
    path: string;
    method: 'GET' | 'POST';
    family: Family;
    defaults: Partial<Request>;
    unorderedArrays: readonly string[];
    price: (request: Request) => number;
    gate: (request: Request) => PairRequest | null;
    parse: (task: DfsTask) => Row[];
}

export function defineEndpoint<Request, Row>(
    def: EndpointDef<Request, Row>,
): EndpointDef<Request, Row> {
    return def;
}
