import NextError from "next/error";
import type { NextPageContext } from "next";

function ErrorPage({ statusCode }: { statusCode?: number }) {
  return <NextError statusCode={statusCode} />;
}

ErrorPage.getInitialProps = ({ res, err }: NextPageContext) => ({
  statusCode: res?.statusCode ?? err?.statusCode ?? 404
});

export default ErrorPage;
