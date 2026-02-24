// Force-enable Document context to avoid Html import guard during prerender.
process.env.__NEXT_DOCUMENT__ = "true";

const Document = require("next/document").default;
const { Html, Head, Main, NextScript } = require("next/document");

class MyDocument extends Document {
  static async getInitialProps(ctx) {
    const initialProps = await Document.getInitialProps(ctx);
    return { ...initialProps };
  }

  render() {
    return (
      <Html lang="es">
        <Head />
        <body>
          <Main />
          <NextScript />
        </body>
      </Html>
    );
  }
}

module.exports = MyDocument;
