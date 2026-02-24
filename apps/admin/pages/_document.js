const Document = require("next/document").default;
const { Head, Html, Main, NextScript } = require("next/document");

class MyDocument extends Document {
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
