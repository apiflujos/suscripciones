# Product-First Migration Plan

## Goal

Move the admin experience to a product-first model where users only interact with:

- `Producto`
- `Suscripción`

while the current `SubscriptionPlan` layer remains internal until the data model can be simplified safely.

## Stage 1: Product-First UX on top of current model

Status: implemented.

Objectives:

- Keep `SubscriptionPlan` as an internal implementation detail.
- Make `/products` the visible source of truth for commercial items.
- Make product cards and product-driven flows speak in terms of `producto` and `suscripción`, not `plan`.
- Aggregate subscription counters for catalog products using linked operational plans via `metadata.catalog.itemId`.

Changes:

- `/products` continues to list only `CATALOG_ITEM`.
- Product cards now count subscriptions linked through operational plans.
- Product-driven creation modals are labeled as subscription creation from a product.

Remaining recommended UI changes in this stage:

- Review lower-priority user-facing text in billing and customers that still says `plan`.
- Keep hidden form fields and service names untouched for now.

## Stage 2: Service boundary moves from plan-first to product-first

Status: partially implemented.

Objectives:

- Introduce product-first service APIs while keeping the current schema.
- Resolve the operational plan internally from the selected product.

Recommended work:

- Keep expanding product-first service APIs while keeping the current schema.
- Keep legacy `planId` endpoints temporarily as adapters.

Implemented in this stage:

- Added internal operational-plan resolution from `productId`.
- Updated the subscription change flow so the UI submits `productId` and the backend resolves the active operational plan.
- Updated manual tokenization-link flows so the UI submits `productId` and the backend resolves the operational plan only as an internal compatibility detail.
- Updated duplicate-subscription merge flows so the UI can scope duplicates by `productId` instead of depending on a visible `planId`.
- Updated generic subscription-creation actions to accept `productId`, while still tolerating legacy `planId` callers.

Pending in this stage:

- product-first variants for payment-link creation where the visible flow still depends on `planId`
- product-first variants for any remaining direct plan selection flows
- cleanup of remaining user-facing wording that still says `plan` in lower-priority screens

Expected result:

- UI sends `productId`.
- Server resolves `planId`.
- Business logic still works without schema changes.

## Stage 3: Canonical product-to-plan mapping

Status: started.

Objectives:

- Stop relying on loosely managed `metadata.catalog.itemId`.
- Make the canonical relationship explicit and enforceable.

Recommended options:

1. Add a dedicated relation from `SubscriptionPlan` to the catalog product plan.
2. Or create a dedicated mapping table such as `CatalogProductPlan`.

Implemented in this stage:

- Introduced a shared `productPlanMapping` service so the admin stops duplicating raw `metadata.catalog.itemId` lookups in multiple flows.
- Migrated subscription/product admin services to use the shared mapping resolver for operational-plan resolution and related-plan expansion.
- Added an explicit `SubscriptionPlan.catalogProductId` relation in schema, with migration/backfill from legacy metadata.
- Updated the shared mapping resolver and key product-first flows to prefer `catalogProductId` over `metadata.catalog.itemId`, keeping metadata only as fallback compatibility.
- Expanded that preference to billing, logs, payments, webhooks, CSV export, duplicate detection, reminders, and AI so the explicit relation is now the primary mapping path across the main application flows.

Pending in this stage:

- Replace remaining ad-hoc `metadata.catalog.itemId` lookups with the shared mapping service.
- Decide whether the canonical mapping will remain service-level only or move to an explicit schema relation/table.
- Add integrity tooling/backfills around the canonical mapping before schema changes.

Expected result:

- One canonical product maps to one canonical operational subscription plan per tenant/context.
- Fewer metadata inconsistencies.

## Stage 4: Schema simplification

Status: started.

Objectives:

- Move `Subscription` conceptually from `planId` to `productId`.
- Keep pricing and billing parameters snapshotted on the subscription.

Recommended schema direction:

- `Subscription.productId`
- snapshot fields on `Subscription.metadata.pricing`
- billing settings on subscription
- historical payment/cycle data remains unchanged

Migration outline:

1. Add nullable `productId` to `Subscription`.
2. Backfill from `Subscription.plan.metadata.catalog.itemId`.
3. Update reads to prefer `productId`.
4. Update writes to create subscriptions from `productId`.
5. Remove direct dependency on `planId` from UI/services.
6. Retire `planId` only after all flows are migrated.

Implemented in this stage:

- Added nullable `Subscription.productId` and `PaymentLink.productId` in schema plus migration/backfill.
- Updated new subscription writes to persist `productId`.
- Updated payment-link writes to persist `productId`.
- Updated key reads to prefer `productId` and only fall back to `plan.metadata.catalog.itemId` for compatibility.
- Updated reminder/webhook checkout flows to persist and propagate `productId`.
- Updated product gamification events and score recomputation to aggregate by `Subscription.productId` first, with fallback only for legacy rows.
- Updated billing duplicate grouping and CSV exports to surface `productId` as the primary commercial identity.
- Updated AI assistant filtering/context so product-scoped analysis resolves payments and subscriptions by `productId` first.
- Updated payment history/product transaction services to resolve product scope by `Subscription.productId` first.
- Updated subscription payment history and public cart selection flows to propagate `productId` alongside legacy `planId`.
- Updated public cart subscription creation so newly created subscriptions from cart flows persist `productId`.
- Updated billing checkout-template resolution to use `Subscription.productId` first instead of re-deriving product identity from plan metadata.
- Updated billing cards so visible product-derived attributes such as shipping behavior and imagery resolve from the catalog product, not from operational-plan metadata.
- Updated admin duplicate-subscription guards so they prefer `productId` and the shared mapping service instead of ad-hoc plan metadata checks.
- Added a product-first commercial breakdown to metrics while keeping `planType`-based operational metrics intact.
- Expanded metrics with product-level payment and link activity so reporting can answer by product without replacing `planType` operational KPIs.
- Started surfacing the new product-level commercial breakdowns in the main dashboard so product-first reporting is visible, not just available in the API.
- Updated logs and webhook views so payment/webhook/system records expose and render `productName` first, keeping `planName` only as fallback compatibility.
- Updated customer list and customer-detail views so subscription summaries, cycle history, and payment history render `productName` first instead of exposing the operational plan as the visible commercial label.
- Updated public tokenization-link flows so they expose and consume `productId` first, keeping `planId` only as a compatibility fallback for auto-subscription creation.
- Updated the subscription detail modal so the visible commercial label renders `productName` first instead of the operational plan name.
- Updated the main billing board so cards, list rows, and kanban columns render `productName` first and use it in product navigation/search.
- Updated the subscription editing UI (`ChangePlanButton` and `SubscriptionEditModal`) so the visible language and search flow are product-first rather than plan-first.
- Updated the public cart selection flow so the visible request contract uses `productId`, while still accepting legacy `planId` inputs for backward compatibility.
- Cleaned the remaining TypeScript regressions introduced during the rollout so the admin typecheck passes again.

Pending in this stage:

- regenerate Prisma client and roll the migration in each environment
- expand remaining reporting/metrics paths to prefer `productId` where product identity matters
- move duplicate detection and reconciliation logic fully to `productId`
- only after that, consider de-emphasizing `planId` in core flows

## Stage 5: Remove the duplicated domain layer

Only after the earlier stages are complete.

Possible end state:

- catalog product remains the main commercial entity
- subscription points directly to product
- an optional internal billing template can survive only if still needed

If the business never needs multiple sellable plans per product, the operational plan layer can be removed entirely.

## Recommendation

Do not jump directly from the current model to schema deletion in production.

The safe path is:

1. product-first UX
2. product-first services
3. explicit mapping
4. schema migration
5. old plan retirement
