# Deploy Checklist - Billing Cycles Modal + CSV Import/Export

## Commit Realizado
```
commit ad1be06
Author: API Flujos
Date: Fri Mar 27 2026

feat: Billing cycles modal redesign + CSV import/export + UI standardization

- New BillingCyclesModal component with expandable rows
- Billing cycles: IDs hidden in main view, shown in expanded details
- All table content left-aligned (not centered)
- Plan name and status prioritized over technical IDs
- Added CSV import/export endpoints
- Updated SubscriptionEditModal with improved layout
- Added PageHeaderStandard component for consistent headers
- UI/UX improvements (modal panels, sticky headers, status pills)
```

## Archivos Cambiados (24 archivos)
- 2,082 inserciones(+), 631 eliminaciones(-)

### Nuevos Archivos:
- `REVISION_MODALES_BILLING.md` - Documentación de cambios
- `apps/admin/app/billing/BillingCyclesModal.tsx` - Componente unificado (337 líneas)
- `apps/admin/app/billing/PaymentCyclesModal.tsx` - Re-export
- `apps/admin/app/billing/SubscriptionEditModal.tsx` - Modal mejorado
- `apps/admin/app/customers/CustomersModalTrigger.tsx` - Trigger modal
- `apps/admin/app/products/ProductsModalTrigger.tsx` - Trigger modal
- `apps/admin/app/ui/PageHeaderStandard.tsx` - Header estándar

### Archivos Modificados:
- `apps/admin/app/admin/_services/payments.ts` - Include subscription.id
- `apps/admin/app/api/import/csv/route.ts` - Importar CSV endpoint
- `apps/admin/app/api/import/template/route.ts` - Template CSV endpoint
- `apps/admin/app/api/list-csv/route.ts` - Listar CSV endpoint
- `apps/admin/app/billing/BillingCyclesButton.tsx` - Re-export
- `apps/admin/app/billing/page.tsx` - Actualizado para usar nuevos modales
- `apps/admin/app/styles.css` - Estilos mejorados
- Y más...

## Migraciones de Base de Datos

Las migraciones ya están creadas en el repositorio:

### Migración Principal - Billing Cycles
**`20260325103000_add_billing_cycles`**
- Crea tabla `SubscriptionBillingCycle`
- Añade enums `BillingCycleStatus` y `PaymentTiming`
- Añade campos a `Subscription`: `cycleStartDay`, `paymentDay`, `paymentTiming`, `graceDays`
- Añade campo a `Payment`: `subscriptionCycleKey`

### Migraciones Recientes Adicionales:
- `20260325090000_add_payment_traceability` - Trazabilidad de pagos
- `20260324090000_add_campaign_smart_views` - Smart views para campañas
- `20260322_add_api_tokens` - Tokens de API
- `20260322_add_webhook_endpoints` - Endpoints de webhooks

## Pasos para Deploy en Producción

### 1. Pull de cambios
```bash
cd /path/to/suscripciones
git pull origin main
```

### 2. Instalar dependencias
```bash
npm install
# o
pnpm install
```

### 3. Aplicar migraciones en producción
```bash
# Conectar a base de datos de producción
DATABASE_URL=postgresql://user:pass@prod-host:5432/wompi_subs

npx prisma migrate deploy --schema packages/database/prisma/schema.prisma
```

### 4. Generar Prisma Client
```bash
npx prisma generate --schema packages/database/prisma/schema.prisma
```

### 5. Build
```bash
npm run build
# o
pnpm build
```

### 6. Reiniciar aplicación
```bash
# Si usas PM2
pm2 restart all

# Si usas Docker
docker-compose restart

# Si usas systemd
systemctl restart suscripciones
```

## Verificación Post-Deploy

### 1. Verificar migraciones aplicadas
```bash
npx prisma migrate status --schema packages/database/prisma/schema.prisma
```

### 2. Probar endpoint de ciclos de cobro
```
GET /api/billing/billing-cycles?subscriptionId={id}
```

### 3. Probar modal de ciclos
- Navegar a `/billing`
- Click en ícono de calendario en una suscripción
- Verificar que el modal abre correctamente
- Click en una fila para expandir detalles
- Verificar que IDs se muestran al final

### 4. Probar CSV import/export
```
GET /api/list-csv?entity=customers
POST /api/import/csv
GET /api/import/template?entity=customers
```

## Features Desplegadas

### Billing Cycles Modal
✅ Diseño moderno con scroll independiente
✅ Cabecera sticky en tablas
✅ Filas expandibles con click
✅ IDs ocultos en vista principal
✅ IDs visibles en detalle expandido (al final)
✅ Todo el texto alineado a la izquierda
✅ Status pills con colores
✅ Spinner de carga
✅ Estado vacío con mensaje claro

### CSV Import/Export
✅ Endpoint para listar registros como CSV
✅ Endpoint para importar CSV
✅ Endpoint para descargar template
✅ Soporte para customers, empresas, products

### UI Standardization
✅ PageHeaderStandard component
✅ Modal triggers unificados
✅ Estilos consistentes en todas las páginas

## Rollback (si es necesario)

```bash
# Revertir último commit
git revert HEAD
git push origin main

# O volver a un commit anterior
git checkout <commit-hash>
git push origin main:production --force
```

## Notas Importantes

1. **No hay migraciones nuevas** - Las migraciones de billing cycles ya estaban creadas
2. **Solo cambios de frontend** - La mayoría de cambios son UI/UX
3. **Backward compatible** - Los modal anterior funcionaba, el nuevo es mejora
4. **API endpoints existentes** - `/api/billing/billing-cycles` ya existía

## Contacto

Para dudas o problemas post-deploy, revisar:
- `REVISION_MODALES_BILLING.md` - Documentación detallada
- Logs de la aplicación
- PM2 logs: `pm2 logs`
