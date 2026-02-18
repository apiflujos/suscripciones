export default function PublicPlanLoading() {
  return (
    <main className="page publicCheckoutShell" style={{ maxWidth: 860 }}>
      <div className="card cardPad publicCheckoutCard">
        <div className="publicCheckoutLayout">
          <div className="publicCheckoutIntro">
            <div className="publicCheckoutLogo" style={{ background: "rgba(0,0,0,0.06)", height: 44, width: 160 }} />
            <div style={{ height: 22, width: 220, background: "rgba(0,0,0,0.08)", borderRadius: 6, marginTop: 12 }} />
            <div style={{ height: 12, width: 320, background: "rgba(0,0,0,0.06)", borderRadius: 6, marginTop: 10 }} />
          </div>
          <div className="publicCheckoutSide">
            <div style={{ height: 14, width: 140, background: "rgba(0,0,0,0.06)", borderRadius: 6 }} />
            <div style={{ height: 40, width: "100%", background: "rgba(0,0,0,0.06)", borderRadius: 8, marginTop: 8 }} />
            <div style={{ height: 14, width: 90, background: "rgba(0,0,0,0.06)", borderRadius: 6, marginTop: 16 }} />
            <div style={{ height: 40, width: "100%", background: "rgba(0,0,0,0.06)", borderRadius: 8, marginTop: 8 }} />
            <div style={{ height: 44, width: "100%", background: "rgba(0,0,0,0.08)", borderRadius: 10, marginTop: 16 }} />
          </div>
        </div>
      </div>
    </main>
  );
}
