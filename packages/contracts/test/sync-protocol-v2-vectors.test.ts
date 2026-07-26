import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { syncEventV2Schema } from '../src/sync/event-v2.js';
import { syncEventSchema, syncEventTypeSchema } from '../src/sync/event.js';
import { snapshotRecordV2Schema } from '../src/sync/snapshot-record.js';
import {
  snapshotRecordSchema,
  snapshotRecordTypeSchema,
} from '../src/sync/snapshot.js';

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
}

function objectValue(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Protocol vector must be a JSON object.');
  }
  return value as Record<string, unknown>;
}

describe('sync protocol v2 language-neutral vectors', () => {
  it('covers every snapshot record type with strict JSON examples', () => {
    const vector = objectValue(
      readJson('../vectors/snapshot-records-v2.json'),
    );
    expect(vector.protocol_version).toBe(2);
    const rawRecords = vector.records;
    if (!Array.isArray(rawRecords)) throw new Error('Snapshot records are missing.');

    const records = rawRecords.map((record) => snapshotRecordSchema.parse(record));
    const registryTypes = snapshotRecordV2Schema.options.map(
      (schema) => schema.shape.record_type.value,
    );
    expect(records).toHaveLength(registryTypes.length);
    expect(new Set(records.map(({ record_type }) => record_type))).toEqual(
      new Set(snapshotRecordTypeSchema.options),
    );
    expect(new Set(registryTypes)).toEqual(
      new Set(snapshotRecordTypeSchema.options),
    );
  });

  it('covers every sync event type with strict JSON examples', () => {
    const vector = objectValue(readJson('../vectors/sync-events-v2.json'));
    expect(vector.protocol_version).toBe(2);
    const rawEvents = vector.events;
    if (!Array.isArray(rawEvents)) throw new Error('Sync events are missing.');

    const events = rawEvents.map((event) => syncEventSchema.parse(event));
    const registryTypes = syncEventV2Schema.options.map(
      (schema) => schema.shape.type.value,
    );
    expect(events).toHaveLength(registryTypes.length);
    expect(new Set(events.map(({ type }) => type))).toEqual(
      new Set(syncEventTypeSchema.options),
    );
    expect(new Set(registryTypes)).toEqual(new Set(syncEventTypeSchema.options));
  });
});
