export interface RawRecord {
    id: number;
    runId: number | null;
    endpoint: string;
    requestHash: string;
    requestJson: string;
    responseJson: string;
    httpStatus: number;
    taskStatusCode: number;
    cost: number;
    fetchedAt: string;
}

export type NewRawRecord = Omit<RawRecord, 'id'>;

export interface CacheStore {
    findLatestOk(endpoint: string, requestHash: string): RawRecord | undefined;
    insert(record: NewRawRecord): number;
}

export class MemoryCacheStore implements CacheStore {
    readonly records: RawRecord[] = [];

    findLatestOk(endpoint: string, requestHash: string): RawRecord | undefined {
        for (let i = this.records.length - 1; i >= 0; i--) {
            const record = this.records[i];
            if (
                record &&
                record.endpoint === endpoint &&
                record.requestHash === requestHash &&
                record.taskStatusCode === 20000
            ) {
                return record;
            }
        }
        return undefined;
    }

    insert(record: NewRawRecord): number {
        const id = this.records.length + 1;
        this.records.push({ id, ...record });
        return id;
    }
}
