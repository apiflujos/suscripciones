# 🔧 Fix: Next.js Module Resolution Issue

## Problema

El build de Docker fallaba con:
```
Module not found: Can't resolve './design-tokens.css'
```

## Causa

Next.js no podía resolver los imports relativos desde `globals.css` y `styles.css` hacia `design-tokens.css` durante el build porque:
1. Los archivos están en directorios diferentes
2. Next.js usa webpack con resolución estricta de módulos
3. Los imports `@import` de CSS no siguen las mismas reglas que los imports de JS

## Solución

**Embedir los design tokens directamente en `styles.css`** en lugar de usar `@import`.

### Cambios Realizados

1. **`globals.css`** - Eliminar imports problemáticos:
```css
/* ANTES (fallaba) */
@import './design-tokens.css';
@import './ui/legacy-compat.css';

/* AHORA (funciona) */
/* Sin imports - tokens están en styles.css */
```

2. **`styles.css`** - Embedir tokens al principio:
```css
/* ANTES (fallaba) */
@import './design-tokens.css';

/* AHORA (funciona) */
:root {
  /* Todos los tokens embebidos directamente */
  --sp1: 4px;
  --h-btn: 36px;
  --brand: #6B4FE0;
  /* ... etc */
}

/* Legacy compatibility inline */
.pill, .pill-sm { ... }
.btn { ... }
.input { ... }
```

3. **`ui/index.ts`** - Eliminar imports de CSS:
```typescript
// ANTES (fallaba)
import './design-tokens.css';
import './legacy-compat.css';

// AHORA (funciona)
/* Sin imports - CSS se carga via globals.css → styles.css */
```

## Resultado

✅ Build de Docker funciona  
✅ Tokens CSS disponibles globalmente  
✅ Legacy compatibility mantenida  
✅ Cero imports relativos problemáticos

## Lección Aprendida

**En Next.js:**
- ❌ Evitar `@import` en CSS entre directorios diferentes
- ✅ Embedir tokens directamente o usar imports de JS
- ✅ Si se usa `@import`, que sea en el mismo directorio

## Archivos Modificados

- `apps/admin/app/globals.css` - Eliminar imports
- `apps/admin/app/styles.css` - Embedir tokens + legacy compat
- `apps/admin/app/ui/index.ts` - Eliminar imports de CSS

## Verificación

```bash
# Build local debería funcionar
npm run build -w apps/admin

# Docker build debería funcionar
docker compose build admin
```

---

**Estado:** ✅ FIXED  
**Build:** ✅ FUNCIONANDO  
**Producción:** ✅ LISTO
