import { z } from 'zod';

export const healthResponseSchema = z
  .object({
    status: z.enum(['live', 'ready']),
  })
  .strict();

export type HealthResponse = z.infer<typeof healthResponseSchema>;
