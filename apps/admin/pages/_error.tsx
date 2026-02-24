// @ts-nocheck
import NextError from "next/error";
import type { NextPageContext } from "next";

function ErrorPage({ statusCode }: { statusCode?: number }) {
  return <NextError statusCode={statusCode} />;
}

ErrorPage.getInitialProps = ({ res, err }: NextPageContext) => {
  const statusCode = (res && res.statusCode) || (err && err.statusCode) || 404;
  return { statusCode };
};

export default ErrorPage;
