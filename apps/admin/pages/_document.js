import Document, { Html, Head, Main, NextScript } from "next/document";

export default class MyDocument extends Document {
  static async getInitialProps(ctx) {
    const initialProps = await Document.getInitialProps(ctx);
    return { ...initialProps };
  }

  render() {
    // In builds where HtmlContext isn't available, avoid using Html/Head/Main/NextScript
    // to prevent runtime errors. This fallback is only for pages router prerendering.
    if (!this.context) {
      return (
        <html lang="es">
          <head />
          <body />
        </html>
      );
    }

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
