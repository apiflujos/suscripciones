import net from "node:net";
import tls from "node:tls";

type SmtpOpts = {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  from: string;
  to: string[];
  subject: string;
  text: string;
};

function b64(s: string) {
  return Buffer.from(s, "utf8").toString("base64");
}

function sanitizeHeaderValue(v: string) {
  return String(v || "").replace(/[\r\n]+/g, " ").trim();
}

function buildMessage(opts: Pick<SmtpOpts, "from" | "to" | "subject" | "text">) {
  const from = sanitizeHeaderValue(opts.from);
  const to = opts.to.map(sanitizeHeaderValue).join(", ");
  const subject = sanitizeHeaderValue(opts.subject);
  const lines = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    String(opts.text || "").replace(/\r\n/g, "\n")
  ];
  return lines.join("\r\n");
}

type SocketLike = net.Socket;

function connectSocket(opts: { host: string; port: number; secure: boolean }) {
  return new Promise<SocketLike>((resolve, reject) => {
    const s = opts.secure ? tls.connect(opts.port, opts.host) : net.connect(opts.port, opts.host);
    s.setTimeout(30_000);
    s.once("error", reject);
    s.once("timeout", () => reject(new Error("smtp_timeout")));
    s.once("connect", () => resolve(s));
  });
}

function readResponse(sock: SocketLike) {
  return new Promise<{ code: number; message: string }>((resolve, reject) => {
    let buf = "";
    const onData = (chunk: Buffer) => {
      buf += chunk.toString("utf8");
      // SMTP replies end with \r\n, and multi-line replies use "xyz-" then final "xyz ".
      const lines = buf.split("\r\n");
      if (lines.length < 2) return;
      const complete: string[] = [];
      for (let i = 0; i < lines.length - 1; i++) complete.push(lines[i]);

      if (!complete.length) return;
      const last = complete[complete.length - 1];
      const m = /^(\d{3})([ -])/.exec(last);
      if (!m) return;
      const code = Number(m[1]);
      const sep = m[2];
      if (sep === "-") return;

      sock.off("data", onData);
      resolve({ code, message: complete.join("\n") });
    };
    const onErr = (err: any) => {
      sock.off("data", onData);
      reject(err);
    };
    sock.on("data", onData);
    sock.once("error", onErr);
  });
}

async function sendCommand(sock: SocketLike, cmd: string, expect: number[] = [250, 235, 354, 220, 221]) {
  sock.write(`${cmd}\r\n`);
  const res = await readResponse(sock);
  if (!expect.includes(res.code)) throw new Error(`smtp_unexpected:${res.code}:${res.message}`);
  return res;
}

export async function sendEmailViaSmtp(opts: SmtpOpts) {
  if (!opts.host) throw new Error("smtp_host_missing");
  if (!opts.port) throw new Error("smtp_port_missing");
  if (!opts.from) throw new Error("smtp_from_missing");
  if (!opts.to?.length) throw new Error("smtp_to_missing");

  const sock = await connectSocket({ host: opts.host, port: opts.port, secure: opts.secure });
  try {
    const hello = await readResponse(sock);
    if (hello.code !== 220) throw new Error(`smtp_greeting_failed:${hello.code}`);

    await sendCommand(sock, `EHLO localhost`, [250]);

    if (opts.user && opts.pass) {
      const auth = b64(`\u0000${opts.user}\u0000${opts.pass}`);
      await sendCommand(sock, `AUTH PLAIN ${auth}`, [235]);
    }

    await sendCommand(sock, `MAIL FROM:<${sanitizeHeaderValue(opts.from)}>`, [250]);
    for (const r of opts.to) {
      await sendCommand(sock, `RCPT TO:<${sanitizeHeaderValue(r)}>`, [250, 251]);
    }
    await sendCommand(sock, `DATA`, [354]);

    const msg = buildMessage(opts);
    // Dot-stuffing.
    const body = msg
      .split("\n")
      .map((l) => (l.startsWith(".") ? `.${l}` : l))
      .join("\r\n");
    sock.write(`${body}\r\n.\r\n`);
    const dataRes = await readResponse(sock);
    if (dataRes.code !== 250) throw new Error(`smtp_data_failed:${dataRes.code}`);

    await sendCommand(sock, `QUIT`, [221]);
  } finally {
    sock.end();
    sock.destroy();
  }
}

