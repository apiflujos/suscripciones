export default function Custom404() {
  return (
    <main
      style={{
        padding: 24,
        fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif"
      }}
    >
      <h1 style={{ margin: 0 }}>Página no encontrada</h1>
      <p style={{ marginTop: 8 }}>La ruta solicitada no existe.</p>
    </main>
  );
}

export async function getServerSideProps({ res }) {
  if (res) res.statusCode = 404;
  return { props: {} };
}
