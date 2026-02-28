import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function CustomerPaymentMethodSuccessPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="page" style={{ maxWidth: 720 }}>
      <div className="card cardPad" style={{ display: "grid", gap: 12, justifyItems: "center", textAlign: "center" }}>
        <img src="/brand/logo_vertical.png" alt="Logo" style={{ height: 56 }} />
        <h2 style={{ margin: 0 }}>¡Gracias!</h2>
        <div>El método de pago se guardó correctamente.</div>
        <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
          <Link className="btn" href={`/customers/${id}/payment-method`}>Volver al contacto</Link>
          <Link className="ghost" href="/customers">Ir a contactos</Link>
        </div>
      </div>
    </main>
  );
}
