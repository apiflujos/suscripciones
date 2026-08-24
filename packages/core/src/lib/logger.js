"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
const pino_1 = require("pino");
exports.logger = (0, pino_1.default)({
    level: process.env.NODE_ENV === "production" ? "info" : "debug",
    redact: {
        paths: [
            "req.headers.authorization",
            "req.headers[\"x-admin-token\"]",
            "req.headers[\"x-auth-token\"]",
            "req.headers.cookie"
        ],
        remove: true
    }
});
