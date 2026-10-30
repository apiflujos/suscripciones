import { PageShell } from "../ui/PageShell";
import { getAdminSettings } from "../admin/_services/settings";
import { listCheckoutTemplates } from "../admin/_services/checkoutTemplates";
import { CheckoutTemplatesPanel } from "./CheckoutTemplatesPanel";
import {
  createCheckoutTemplate,
  deleteCheckoutTemplate,
  duplicateCheckoutTemplate,
  saveCheckoutTemplateDefaults,
  updateCheckoutTemplate
} from "./actions";
import { loadTemplateFormData } from "./loadTemplateForm";
import "./checkout-templates.css";

export const dynamic = "force-dynamic";

const RETURN_TO = "/checkout-templates";

/** Lista de plantillas de checkout. Crear y editar son páginas propias. */
export default async function CheckoutTemplatesPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = (await searchParams) ?? {};
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const [templates, settings, { products, tenants, csrfToken }] = await Promise.all([
    listCheckoutTemplates({ wantsAll: true }),
    getAdminSettings(),
    loadTemplateFormData()
  ]);
  const checkoutConfig = ((settings as any)?.checkoutConfig || {}) as Record<string, any>;

  return (
    <PageShell
      title="Plantillas de checkout"
      subtitle="Configura el checkout público de links de pago, débito automático y catálogos."
      width="wide"
    >
      <CheckoutTemplatesPanel
        templates={(templates as any[]).map((t) => ({
          id: String(t.id),
          name: String(t.name || ""),
          kind: t.kind,
          active: Boolean(t.active),
          productIds: t.productIds ?? [],
          expiryHours: t.expiryHours ?? null,
          logoUrl: t.logoUrl ?? null
        }))}
        products={products}
        tenants={tenants}
        csrfToken={csrfToken}
        returnTo={RETURN_TO}
        inlineState={{ action: str(sp.a), status: str(sp.status), errorText: str(sp.error) }}
        checkoutDefaults={{
          defaultPlanTemplateId: String(checkoutConfig.defaultPlanTemplateId || ""),
          defaultSubscriptionTemplateId: String(checkoutConfig.defaultSubscriptionTemplateId || ""),
          defaultCartTemplateId: String(checkoutConfig.defaultCartTemplateId || "")
        }}
        actions={{
          create: createCheckoutTemplate,
          update: updateCheckoutTemplate,
          remove: deleteCheckoutTemplate,
          duplicate: duplicateCheckoutTemplate,
          saveDefaults: saveCheckoutTemplateDefaults
        }}
      />
    </PageShell>
  );
}
