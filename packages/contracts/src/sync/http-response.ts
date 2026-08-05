import { z } from 'zod';

import { incrementalSyncResponseSchema } from './response.js';
import {
  accountSnapshotResponseSchema,
  classSectionSnapshotResponseSchema,
} from './snapshot.js';

export const syncResponseSchema = z.discriminatedUnion('mode', [
  incrementalSyncResponseSchema,
  accountSnapshotResponseSchema,
  classSectionSnapshotResponseSchema,
]);

export type SyncResponse = z.infer<typeof syncResponseSchema>;
