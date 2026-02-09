import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().min(1),
  WOMPI_EVENTS_SECRET: z.string().optional().or(z.literal("")),
  WOMPI_PUBLIC_KEY: z.string().optional().or(z.literal("")),
  WOMPI_PRIVATE_KEY: z.string().optional().or(z.literal("")),
  WOMPI_INTEGRITY_SECRET: z.string().optional().or(z.literal("")),
  WOMPI_API_BASE_URL: z.string().url().default("https://production.wompi.co/v1"),
  WOMPI_CHECKOUT_LINK_BASE_URL: z.string().url().default("https://checkout.wompi.co/l/"),
  WOMPI_REDIRECT_URL: z.string().url().optional().or(z.literal("")),
  ADMIN_API_TOKEN: z.string().min(12),
  SHOPIFY_FORWARD_URL: z.string().url().optional().or(z.literal("")),
  SHOPIFY_FORWARD_SECRET: z.string().optional().or(z.literal("")),
  CREDENTIALS_ENCRYPTION_KEY_B64: z.string().optional().or(z.literal("")),
  CHATWOOT_BASE_URL: z.string().url().optional().or(z.literal("")),
  CHATWOOT_ACCOUNT_ID: z.coerce.number().int().positive().optional(),
  CHATWOOT_API_ACCESS_TOKEN: z.string().optional().or(z.literal("")),
  CHATWOOT_INBOX_ID: z.coerce.number().int().positive().optional()
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(processEnv: NodeJS.ProcessEnv): Env {
  const normalized = {
    ...processEnv,
    ADMIN_API_TOKEN: processEnv.ADMIN_API_TOKEN
  } as NodeJS.ProcessEnv;

  const parsed = envSchema.safeParse(normalized);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.error(parsed.error.flatten().fieldErrors);
    throw new Error("Invalid environment variables");
  }
  return parsed.data;
}
