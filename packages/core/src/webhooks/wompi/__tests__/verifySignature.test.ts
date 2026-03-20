import { test, expect } from "vitest";
import { computeWompiChecksum, verifyWompiSignature } from "../verifySignature";
import type { WompiEvent } from "../types";

const baseEvent = (): WompiEvent =>
  ({
    event: "transaction.updated",
    data: {
      transaction: {
        id: "tx_123",
        amount_in_cents: 1000,
        status: "APPROVED"
      }
    },
    signature: {
      checksum: "",
      properties: ["transaction.id", "transaction.amount_in_cents", "transaction.status"]
    },
    timestamp: 1700000000
  }) as WompiEvent;

test("computeWompiChecksum + verifyWompiSignature: valid checksum", () => {
  const event = baseEvent();
  const secret = "secret";
  const checksum = computeWompiChecksum(event, secret);
  event.signature = { ...event.signature, checksum };
  const res = verifyWompiSignature({ event, eventsSecret: secret });
  expect(res).toEqual({ ok: true });
});

test("verifyWompiSignature: missing checksum", () => {
  const event = baseEvent();
  event.signature = { ...event.signature, checksum: "" };
  const res = verifyWompiSignature({ event, eventsSecret: "secret" });
  expect(res).toEqual({ ok: false, reason: "missing checksum" });
});

test("verifyWompiSignature: checksum mismatch", () => {
  const event = baseEvent();
  event.signature = { ...event.signature, checksum: "bad" };
  const res = verifyWompiSignature({ event, eventsSecret: "secret" });
  expect(res).toEqual({ ok: false, reason: "checksum mismatch" });
});
