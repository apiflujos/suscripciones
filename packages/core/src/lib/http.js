"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.postJson = postJson;
async function postJson(url, body, headers) {
    const res = await fetch(url, {
        method: "POST",
        headers: {
            "content-type": "application/json",
            ...headers
        },
        body: JSON.stringify(body)
    });
    const text = await res.text().catch(() => "");
    return { ok: res.ok, status: res.status, text };
}
