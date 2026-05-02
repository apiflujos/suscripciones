import { describe, it } from "vitest";

describe("resolveAutoCheckoutTemplateId — template kind selection", () => {
  it.todo(
    "PAYMENT_LINK_CREATED con paymentType SUBSCRIPTION debe usar template PLAN, no SUBSCRIPTION — verificar vía integration test cuando se exponga un seam observable del handler"
  );

  it.todo(
    "TOKENIZATION_LINK_CREATED debe usar template SUBSCRIPTION — verificar vía integration test cuando se exponga un seam observable del handler"
  );
});
