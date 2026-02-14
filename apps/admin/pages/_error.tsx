import type { NextPageContext } from "next";

function ErrorPage({ statusCode }: { statusCode?: number }) {
  return (
    <main style={{ padding: 32, fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif" }}>
      <h1 style={{ margin: 0 }}>Error</h1>
      <p style={{ marginTop: 8 }}>
        {statusCode ? `Ocurrió un error ${statusCode}.` : "Ocurrió un error inesperado."}
      </p>
    </main>
  );
}

ErrorPage.getInitialProps = ({ res, err }: NextPageContext) => {
  const statusCode = res?.statusCode || err?.statusCode || 500;
  return { statusCode };
};

export default ErrorPage;
