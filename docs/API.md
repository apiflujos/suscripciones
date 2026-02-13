# API Docs (Minimal)

Base URL: `http://<host>:3001`

## Auth

Admin endpoints require:
- `Authorization: Bearer <ADMIN_API_TOKEN>`
- `x-admin-token: <ADMIN_API_TOKEN>`

## Health
- `GET /health`
- `GET /healthz`

## Webhooks
- `POST /webhooks/wompi`
- `POST /webhooks/chatwoot` (`CHATWOOT_WEBHOOK_TOKEN` requerido en producción)

## Admin: Customers
- `GET /admin/customers?take=50&skip=0&q=...`
- `GET /admin/customers/:id`
- `POST /admin/customers`
- `PUT /admin/customers/:id`
- `DELETE /admin/customers/:id`
- `POST /admin/customers/:id/wompi/payment-source`

## Admin: Products / Catalog
- `GET /admin/products?take=200&skip=0&q=...`
- `GET /admin/products/:id`
- `POST /admin/products`
- `PUT /admin/products/:id`

## Admin: Plans / Subscriptions
- `GET /admin/plans?take=200&q=...&collectionMode=MANUAL_LINK|AUTO_LINK|AUTO_DEBIT`
- `GET /admin/subscriptions?take=50&skip=0&q=...&estado=si|no|mora&collectionMode=MANUAL_LINK|AUTO_DEBIT`
- `POST /admin/subscriptions`
- `POST /admin/subscriptions/:id/payment-link`

## Admin: Orders (Payment Links)
- `GET /admin/orders?take=50&skip=0&q=...`
- `POST /admin/orders`

## Admin: Logs
- `GET /admin/logs/system?take=100&skip=0`
- `GET /admin/logs/system/:id`
- `GET /admin/logs/payments?take=50&skip=0`
- `GET /admin/logs/jobs?take=50&skip=0`
- `GET /admin/logs/messages?take=100&skip=0`
- `POST /admin/logs/jobs/retry-failed`
- `GET /admin/webhook-events`

## Admin: Comms (Smart Lists / Campaigns)
- `GET /admin/comms/smart-lists?take=100&skip=0`
- `POST /admin/comms/smart-lists`
- `GET /admin/comms/smart-lists/:id`
- `PUT /admin/comms/smart-lists/:id`
- `DELETE /admin/comms/smart-lists/:id`
- `POST /admin/comms/smart-lists/:id/preview`
- `GET /admin/comms/smart-lists/:id/members?active=1&take=200&skip=0`
- `POST /admin/comms/smart-lists/:id/sync`
- `GET /admin/comms/campaigns?take=100&skip=0`
- `POST /admin/comms/campaigns`
- `GET /admin/comms/campaigns/:id`
- `PUT /admin/comms/campaigns/:id`
- `POST /admin/comms/campaigns/:id/run`
- `GET /admin/comms/campaigns/:id/sends?take=200&skip=0`

## Admin: Settings / Notifications / Metrics
- `GET /admin/settings`
- `PUT /admin/settings/wompi`
- `PUT /admin/settings/chatwoot`
- `DELETE /admin/settings/chatwoot`
- `POST /admin/comms/test-connection`
- `POST /admin/comms/bootstrap-attributes`
- `POST /admin/comms/sync-attributes`
- `GET /admin/notifications/config?environment=PRODUCTION|SANDBOX`
- `PUT /admin/notifications/config`
- `GET /admin/metrics`

## Auth
- `POST /admin/auth/login`
