import { PageShell } from "../ui/PageShell";
import { renderNotificationTemplatePreview } from "../lib/notificationTemplate";
import { resolveReturnTo } from "../lib/returnTo";
import { loadCustomerSend } from "./loadCustomerSend";
import { SendMessageForm, type SendVariant } from "./SendMessageForm";
import { preferredCatalogMode, resolveActionBlockReason, resolveMessageTemplate, type SendKind } from "./sendRules";

const TITLES: Record<SendKind, string> = {
  link: "Enviar link de pago",
  catalog: "Enviar catálogo",
  token: "Enviar débito automático"
};

/**
 * Página de "Enviar link de pago / catálogo / débito automático" de un contacto.
 * Antes eran tres modales de la lista; las tres comparten estructura y cambian solo
 * la plantilla, el endpoint y los motivos de bloqueo.
 */
export async function SendPage({
  kind,
  params,
  searchParams
}: {
  kind: SendKind;
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const returnTo = resolveReturnTo(sp.returnTo, "/customers");
  const { customer, ctx, tenantId, productName, collectionMode } = await loadCustomerSend(id);

  const label = customer.name || customer.email || customer.phone || "Contacto";
  const preview = (trigger: Parameters<typeof resolveMessageTemplate>[1], paymentType?: "PLAN" | "SUBSCRIPTION" | "LINK") =>
    renderNotificationTemplatePreview(resolveMessageTemplate(ctx, trigger, paymentType));

  let variants: Record<"PLAN" | "SUBSCRIPTION", SendVariant>;
  if (kind === "link") {
    const v = { preview: preview("PAYMENT_LINK_CREATED", "LINK"), blockReason: resolveActionBlockReason(ctx, "PAYMENT") };
    variants = { PLAN: v, SUBSCRIPTION: v };
  } else if (kind === "token") {
    const v = { preview: preview("TOKENIZATION_LINK_CREATED"), blockReason: resolveActionBlockReason(ctx, "TOKEN") };
    variants = { PLAN: v, SUBSCRIPTION: v };
  } else {
    variants = {
      PLAN: { preview: preview("CATALOG_LINK_CREATED", "PLAN"), blockReason: resolveActionBlockReason(ctx, "CATALOG_PLAN") },
      SUBSCRIPTION: {
        preview: preview("CATALOG_LINK_CREATED", "SUBSCRIPTION"),
        blockReason: resolveActionBlockReason(ctx, "CATALOG_SUBSCRIPTION")
      }
    };
  }

  return (
    <PageShell
      title={TITLES[kind]}
      subtitle={`${label}${productName ? ` · ${productName}` : ""}`}
      crumbs={[
        { label: "Contactos", href: returnTo },
        { label, href: `/customers/${customer.id}` },
        { label: TITLES[kind] }
      ]}
      backHref={returnTo}
    >
      <SendMessageForm
        kind={kind}
        customerId={customer.id}
        customerName={customer.name || ""}
        tenantId={tenantId}
        productId={ctx.productId}
        productName={productName}
        returnTo={returnTo}
        variants={variants}
        initialMode={kind === "catalog" ? preferredCatalogMode(ctx, collectionMode) : "PLAN"}
      />
    </PageShell>
  );
}
