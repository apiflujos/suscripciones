export async function postJson(url: string, body: unknown, headers?: Record<string, string>) {
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

