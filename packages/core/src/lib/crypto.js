"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sha256Hex = sha256Hex;
exports.timingSafeEqualHex = timingSafeEqualHex;
exports.encryptAes256Gcm = encryptAes256Gcm;
exports.decryptAes256Gcm = decryptAes256Gcm;
const node_crypto_1 = require("node:crypto");
function sha256Hex(input) {
    return node_crypto_1.default.createHash("sha256").update(input).digest("hex");
}
function timingSafeEqualHex(aHex, bHex) {
    try {
        const a = Buffer.from(aHex, "hex");
        const b = Buffer.from(bHex, "hex");
        if (a.length !== b.length)
            return false;
        return node_crypto_1.default.timingSafeEqual(a, b);
    }
    catch {
        return false;
    }
}
function encryptAes256Gcm(plaintext, key) {
    const iv = node_crypto_1.default.randomBytes(12);
    const cipher = node_crypto_1.default.createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([cipher.update(Buffer.from(plaintext, "utf8")), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, ciphertext]).toString("base64");
}
function decryptAes256Gcm(payloadB64, key) {
    const data = Buffer.from(payloadB64, "base64");
    const iv = data.subarray(0, 12);
    const tag = data.subarray(12, 28);
    const ciphertext = data.subarray(28);
    const decipher = node_crypto_1.default.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString("utf8");
}
