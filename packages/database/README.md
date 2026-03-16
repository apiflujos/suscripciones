# Wompi Subs - Database Package

Este paquete contiene la configuración de Prisma ORM para la base de datos.

## Estructura

```
packages/database/
├── prisma/
│   ├── schema.prisma    ← Schema de base de datos
│   └── migrations/      ← Migraciones
└── client.ts           ← Cliente Prisma
```

## Comandos

```bash
# Generar cliente
npm run db:generate

# Crear migración
npm run db:migrate

# Aplicar migraciones en producción
npm run db:migrate:deploy

# Push directo (desarrollo)
npm run db:push

# Abrir Prisma Studio
npm run db:studio
```

## Uso

```typescript
import { prisma } from '@wompi/database';

const payments = await prisma.payment.findMany();
```
