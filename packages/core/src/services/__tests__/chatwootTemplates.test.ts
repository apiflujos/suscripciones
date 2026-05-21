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

  it("reduces full URL button params even when the approved template uses another domain", () => {
    const processed = normalizeProcessedTemplateParams(
      {
        buttons: [
          {
            type: "url",
            parameter: "https://nuevo.apiflujos.com/public/plan/eyJhbGciOiJIUzI1NiJ9.token"
          }
        ]
      },
      [
        {
          type: "BUTTONS",
          buttons: [
            {
              type: "URL",
              url: "https://viejo.apiflujos.com/public/plan/{{1}}"
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

  it("keeps public checkout paths when the approved template uses the domain root", () => {
    const processed = normalizeProcessedTemplateParams(
      {
        buttons: [
          {
            type: "url",
            parameter: "public/plan/eyJhbGciOiJIUzI1NiJ9.token?utm_source=apiflujos"
          }
        ]
      },
      [
        {
          type: "BUTTONS",
          buttons: [
            {
              type: "URL",
              url: "https://mdv.sus.apiflujos.com/{{1}}"
            }
          ]
        }
      ]
    );

    expect(processed).toEqual({
      buttons: [
        {
          type: "url",
          parameter: "public/plan/eyJhbGciOiJIUzI1NiJ9.token?utm_source=apiflujos"
        }
      ]
    });
  });

  it("reduces public checkout paths when the approved template already includes the public checkout path", () => {
    const processed = normalizeProcessedTemplateParams(
      {
        buttons: [
          {
            type: "url",
            parameter: "public/plan/eyJhbGciOiJIUzI1NiJ9.token?utm_source=apiflujos"
          }
        ]
      },
      [
        {
          type: "BUTTONS",
          buttons: [
            {
              type: "URL",
              url: "https://mdv.sus.apiflujos.com/public/plan/{{1}}"
            }
          ]
        }
      ]
    );

    expect(processed).toEqual({
      buttons: [
        {
          type: "url",
          parameter: "eyJhbGciOiJIUzI1NiJ9.token?utm_source=apiflujos"
        }
      ]
    });
  });

  it("reduces public payment, subscription, and catalog URLs to their dynamic token", () => {
    const cases = [
      {
        value: "https://nuevo.apiflujos.com/public/plan/pay-token-123",
        templateUrl: "https://viejo.apiflujos.com/public/plan/{{1}}",
        expected: "pay-token-123"
      },
      {
        value: "https://nuevo.apiflujos.com/public/suscripcion/sub-token-456",
        templateUrl: "https://viejo.apiflujos.com/public/suscripcion/{{1}}",
        expected: "sub-token-456"
      },
      {
        value: "https://nuevo.apiflujos.com/public/cart/cart-token-789",
        templateUrl: "https://viejo.apiflujos.com/public/cart/{{1}}",
        expected: "cart-token-789"
      }
    ];

    for (const testCase of cases) {
      const processed = normalizeProcessedTemplateParams(
        {
          buttons: [
            {
              type: "url",
              parameter: testCase.value
            }
          ]
        },
        [
          {
            type: "BUTTONS",
            buttons: [
              {
                type: "URL",
                url: testCase.templateUrl
              }
            ]
          }
        ]
      );

      expect(processed).toEqual({
        buttons: [
          {
            type: "url",
            parameter: testCase.expected
          }
        ]
      });
    }
  });
});
