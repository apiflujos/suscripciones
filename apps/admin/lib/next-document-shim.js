// Ensure Next's document guard is satisfied even when imported indirectly.
process.env.__NEXT_DOCUMENT__ = "true";

module.exports = require("next/document");
