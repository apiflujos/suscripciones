export default function PublicTokenizeLoading() {
  return (
    <main className="page publicCheckoutShell" style={{ maxWidth: 860 }}>
      <div className="card cardPad publicCheckoutCard">
        <div className="publicCheckoutLayout">
          <div className="publicCheckoutIntro">
            <div className="publicCheckoutLogo" style={{ background: "rgba(0,0,0,0.06)", height: 44, width: 160 }} />
            <div style={{ height: 22, width: 260, background: "rgba(0,0,0,0.08)", borderRadius: 6, marginTop: 12 }} />
            <div style={{ height: 12, width: 300, background: "rgba(0,0,0,0.06)", borderRadius: 6, marginTop: 10 }} />
            <div style={{ height: 12, width: 280, background: "rgba(0,0,0,0.06)", borderRadius: 6, marginTop: 6 }} />
          </div>
          <div className="publicCheckoutSide">
            <div style={{ height: 180, width: "100%", background: "rgba(0,0,0,0.06)", borderRadius: 10 }} />
            <div style={{ height: 44, width: "100%", background: "rgba(0,0,0,0.08)", borderRadius: 10, marginTop: 12 }} />
          </div>
        </div>
      </div>
    </main>
  );
}
