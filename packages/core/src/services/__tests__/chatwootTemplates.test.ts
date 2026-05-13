import { describe, expect, it } from "vitest";
import { normalizeProcessedTemplateParams } from "../chatwootTemplates";

describe("normalizeProcessedTemplateParams", () => {
  it("reduces full URL button params to the dynamic segment expected by WhatsApp", () => {
    const processed = normalizeProcessedTemplateParams(
      {
        buttons: [
          {
            type: "url",
            parameter: "https://mdv.sus.apiflujos.com/public/suscripcion/eyJhbGciOiJIUzI1NiJ9.token"
          }
        ]
      },
      [
        {
          type: "BUTTONS",
          buttons: [
            {
              type: "URL",
              url: "https://mdv.sus.apiflujos.com/public/suscripcion/{{1}}"
            }
          ]
        }
      ]
    );

    expect(processed).toEqual({
      buttons: [
        {
          type: "url",
          parameter: "eyJhbGciOiJIUzI1NiJ9.token"
        }
      ]
    });
  });
});
