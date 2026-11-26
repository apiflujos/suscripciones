import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ createConversation: vi.fn(), updateMessage: vi.fn(), sendMessage: vi.fn() }));

vi.mock("../../../db/prisma", () => ({
  prisma: {
    chatwootMessage: {
      findUnique: vi.fn().mockResolvedValue({
        id: "m-1",
        status: "PENDING",
        type: "PAYMENT_LINK",
        content: "hola",
        customerId: "cus-1",
        subscriptionId: null,
        subscription: null,
        providerResp: {},
        // Chatwoot devuelve un source_id con formato de otro canal
        customer: { name: "A", email: "a@b.co", phone: "3000000001", metadata: { chatwoot: { contactId: 7, sourceId: "573000000000" } } }
      }),
      update: h.updateMessage
    },
    customer: { update: vi.fn().mockResolvedValue({}) }
  }
}));
vi.mock("../../../providers/chatwoot/client", () => ({
  ChatwootClient: class {
    listContactableInboxes = vi.fn().mockResolvedValue({ raw: { payload: [] } });
    createContactInbox = vi.fn().mockResolvedValue({ sourceId: "573000000001" });
    createConversation = h.createConversation;
    sendMessage = h.sendMessage;
  }
}));
vi.mock("../../../services/runtimeConfig", () => ({
  getChatwootConfig: vi.fn().mockResolvedValue({ configured: true, baseUrl: "https://c.example", accountId: 1, apiAccessToken: "x", inboxId: 3 })
}));
vi.mock("../../../services/chatwootSync", () => ({
  isValidWhatsappSourceId: (v: unknown) => typeof v === "string" && /^\d{1,15}$/.test(v),
  normalizeWhatsappSourceId: () => "573000000001",
  ensureChatwootContactForCustomer: vi.fn(),
  syncChatwootAttributesForCustomer: vi.fn().mockResolvedValue(undefined)
}));
vi.mock("../../../services/chatwootDelivery", () => ({ reconcileChatwootMessageDelivery: vi.fn().mockResolvedValue({ ok: true, state: "pending" }) }));
vi.mock("../../../services/systemLog", () => ({ systemLog: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../../services/superAdminConsume", () => ({ consumeApp: vi.fn() }));
vi.mock("../../../services/superAdminApp", () => ({ consumeApp: vi.fn() }));

import { sendChatwootMessage } from "../sendChatwootMessage";

const rejected = new Error('Chatwoot create conversation failed: 422 {"message":"Source invalid source id for whatsapp inbox."}');
const statuses = () => h.updateMessage.mock.calls.map((c) => c[0].data.status);

describe("source_id rechazado por Chatwoot", () => {
  beforeEach(() => {
    h.createConversation.mockReset();
    h.updateMessage.mockReset().mockResolvedValue({});
    h.sendMessage.mockReset().mockResolvedValue({ raw: {} });
  });

  it("reintenta con el número del cliente y envía", async () => {
    h.createConversation.mockRejectedValueOnce(rejected).mockResolvedValueOnce({ conversationId: 99 });
    await sendChatwootMessage("m-1");
    expect(h.createConversation.mock.calls[1][0].sourceId).toBe("573000000001");
    expect(h.sendMessage).toHaveBeenCalledOnce();
    expect(statuses()).not.toContain("FAILED");
  });

  it("si vuelve a rechazarlo, el mensaje queda FAILED", async () => {
    h.createConversation.mockRejectedValue(rejected);
    await sendChatwootMessage("m-1");
    expect(h.sendMessage).not.toHaveBeenCalled();
    expect(statuses()).toContain("FAILED");
  });
});
