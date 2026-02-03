import { z } from "zod";

export const wompiEventSchema = z.object({
  event: z.string().min(1),
  data: z.record(z.unknown()),
  signature: z.object({
    checksum: z.string().min(1),
    properties: z.array(z.string().min(1)).default([])
  }),
  timestamp: z.coerce.number().int()
});

export type WompiEvent = z.infer<typeof wompiEventSchema>;
