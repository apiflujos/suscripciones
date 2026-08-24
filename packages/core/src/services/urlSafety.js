"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeRenderablePublicUrl = normalizeRenderablePublicUrl;
const publicBase_1 = require("./publicBase");
function normalizeRenderablePublicUrl(raw) {
    return (0, publicBase_1.normalizePublicUrl)(raw, { allowLocalhost: false });
}
