export const MESSAGE_VARIABLES = [
  { label: "Nombre completo", value: "{{customer.name}}" },
  { label: "Correo electrónico", value: "{{customer.email}}" },
  { label: "Teléfono", value: "{{customer.phone}}" },
  { label: "Nombre del producto", value: "{{plan.name}}" },
  { label: "Precio del producto (pesos)", value: "{{plan.priceInPesos}}" },
  { label: "Moneda del producto", value: "{{plan.currency}}" },
  { label: "Monto del pago (pesos)", value: "{{payment.amountInPesos}}" },
  { label: "Moneda del pago", value: "{{payment.currency}}" },
  { label: "Estado del pago", value: "{{payment.status}}" },
  { label: "Referencia", value: "{{payment.reference}}" },
  { label: "Estado de la suscripción", value: "{{subscription.status}}" },
  { label: "Ciclo activo", value: "{{subscription.activeCycleNumber}}" },
  { label: "Inicio del ciclo activo", value: "{{subscription.activeCycleStartAt}}" },
  { label: "Fin del ciclo activo", value: "{{subscription.activeCycleEndAt}}" },
  { label: "Ciclo de cobro", value: "{{subscription.collectionCycleNumber}}" },
  { label: "Próximo cobro", value: "{{subscription.nextBillingDate}}" },
  { label: "Fecha de pago", value: "{{payment.paidAt}}" },
  { label: "Fecha de creación del pago", value: "{{payment.createdAt}}" },
  { label: "Fecha de fallo del pago", value: "{{payment.failedAt}}" },
  { label: "Recurrencia · cada (cantidad)", value: "{{plan.intervalCount}}" },
  { label: "Recurrencia · unidad", value: "{{plan.intervalUnit}}" },
  { label: "Tipo de pago", value: "{{paymentType}}" },
  { label: "Link público (Automático · Plan)", value: "{{checkoutPublicUrl.AUTO_PLAN}}" },
  { label: "Link público (Automático · Suscripción)", value: "{{checkoutPublicUrl.AUTO_SUBSCRIPTION}}" },
  { label: "Link público (Automático · Catálogo)", value: "{{checkoutPublicUrl.AUTO_CART}}" }
].sort((a, b) => a.label.localeCompare(b.label, "es"));

export const CAMPAIGN_BUTTON_VARIABLES = [{ label: "Checkout público (Automático)", value: "{{checkoutPublicToken.AUTO}}" }];
