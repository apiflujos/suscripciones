const NextError = require("next/error").default;

function ErrorPage({ statusCode }) {
  return <NextError statusCode={statusCode} />;
}

ErrorPage.getInitialProps = ({ res, err }) => {
  const statusCode = (res && res.statusCode) || (err && err.statusCode) || 404;
  return { statusCode };
};

module.exports = ErrorPage;
