import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().min(1),
  WOMPI_EVENTS_SECRET: z.string().min(1),
  WOMPI_PUBLIC_KEY: z.string().min(1).optional().or(z.literal("")),
  WOMPI_CHECKOUT_BASE_URL: z.string().url().optional().or(z.literal("")),
  WOMPI_REDIRECT_URL: z.string().url().optional().or(z.literal("")),
  ADMIN_API_TOKEN: z.string().min(12),
  SHOPIFY_FORWARD_URL: z.string().url().optional().or(z.literal("")),
  SHOPIFY_FORWARD_SECRET: z.string().optional().or(z.literal("")),
  CREDENTIALS_ENCRYPTION_KEY_B64: z.string().optional().or(z.literal(""))
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(processEnv: NodeJS.ProcessEnv): Env {
  const parsed = envSchema.safeParse(processEnv);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.error(parsed.error.flatten().fieldErrors);
    throw new Error("Invalid environment variables");
  }
  return parsed.data;
}
