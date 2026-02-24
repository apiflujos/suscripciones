export default function ErrorPage({ statusCode }) {
  return (
    <main
      style={{
        padding: 24,
        fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif"
      }}
    >
      <h1 style={{ margin: 0 }}>
        {statusCode ? `Error ${statusCode}` : "Error"}
      </h1>
      <p style={{ marginTop: 8 }}>
        Ocurrió un error inesperado.
      </p>
    </main>
  );
}

ErrorPage.getInitialProps = ({ res, err }) => ({
  statusCode: res?.statusCode ?? err?.statusCode ?? 404
});
