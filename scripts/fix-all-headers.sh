#!/bin/bash

# Script para aplicar page-header-simple a todas las páginas principales

echo "Aplicando header compacto a todas las páginas..."

# Lista de páginas a verificar/arreglar
PAGES=(
  "apps/admin/app/empresas/page.tsx"
  "apps/admin/app/dashboard/empresas/page.tsx"
  "apps/admin/app/settings/page.tsx"
  "apps/admin/app/appearance/page.tsx"
  "apps/admin/app/campaigns/page.tsx"
  "apps/admin/app/notifications/page.tsx"
  "apps/admin/app/plans/page.tsx"
  "apps/admin/app/webhooks/page.tsx"
)

for page in "${PAGES[@]}"; do
  if [ -f "$page" ]; then
    echo "Verificando: $page"
    # Aquí iría la lógica de reemplazo
  else
    echo "❌ No existe: $page"
  fi
done

echo "✅ Verificación completa"
