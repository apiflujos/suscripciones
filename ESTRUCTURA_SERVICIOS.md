# 🏗️ Estructura del Proyecto - 2 Servicios Claros

## ✅ Estructura Correcta

```
wompi_subs/
├── apps/
│   ├── api/                  ← BACKEND (Express + TypeScript)
│   │   ├── src/
│   │   │   ├── routes/      ← Endpoints API
│   │   │   ├── services/    ← Lógica de negocio
│   │   │   ├── providers/   ← Servicios externos (Wompi, Chatwoot)
│   │   │   ├── jobs/        ← Background jobs
│   │   │   ├── webhooks/    ← Webhooks handlers
│   │   │   └── db/          ← Prisma client
│   │   ├── prisma/
│   │   │   └── schema.prisma
│   │   └── package.json
│   │
│   └── admin/                ← FRONTEND (Next.js + React)
│       ├── app/
│       │   ├── api/         ← Solo Server Actions (llama a API)
│       │   ├── lib/         ← Utilidades frontend
│       │   ├── ui/          ← Componentes React
│       │   └── ...          ← Páginas
│       ├── middleware.ts
│       └── package.json
│
├── packages/
│   └── shared/              ← Tipos compartidos
│       └── types.ts
│
├── docker-compose.yml       ← 2 servicios + DB
└── package.json
```

---

## 📊 Servicios Separados

### **1. API (Backend)**

| Característica | Valor |
|----------------|-------|
| **Framework** | Express.js |
| **Lenguaje** | TypeScript 100% |
| **Puerto** | 3001 |
| **Función** | API REST + Webhooks |
| **Base de datos** | PostgreSQL + Prisma |

**Endpoints principales:**
```
GET  /admin/payments
POST /admin/payments
GET  /admin/customers
POST /admin/customers
POST /webhooks/wompi
GET  /health
```

### **2. Admin (Frontend)**

| Característica | Valor |
|----------------|-------|
| **Framework** | Next.js 15 |
| **Lenguaje** | TypeScript + TSX |
| **Puerto** | 3002 |
| **Función** | UI + Server Actions |
| **Comunicación** | HTTP a API (localhost:3001) |

**Páginas principales:**
```
/login
/payments
/customers
/billing
/settings
```

---

## 🔄 Comunicación Entre Servicios

```
┌─────────────┐         HTTP          ┌─────────────┐
│   Admin     │ ────────────────────> │    API      │
│  (Next.js)  │    localhost:3001     │  (Express)  │
│  :3002      │ <──────────────────── │  :3001      │
└─────────────┘         JSON          └─────────────┘
                              │
                              ▼
                       ┌─────────────┐
                       │  PostgreSQL │
                       │   :5432     │
                       └─────────────┘
```

---

## 📝 Flujo de Request

1. **Usuario** → `Admin (:3002)` → Server Action
2. **Server Action** → HTTP → `API (:3001)`
3. **API** → Prisma → `PostgreSQL (:5432)`
4. **PostgreSQL** → JSON → **API**
5. **API** → JSON → **Admin**
6. **Admin** → HTML → **Usuario**

---

## ✅ Ventajas de Esta Estructura

| Ventaja | Descripción |
|---------|-------------|
| **Separación clara** | Backend y frontend independientes |
| **Escalabilidad** | Podés escalar API y Admin por separado |
| **Deploy flexible** | Podés deployar solo la API o solo el Admin |
| **Testing** | Tests de API sin tocar frontend |
| **Equipos** | Diferentes personas en backend/frontend |
| **Homogeneidad** | TypeScript en ambos lados |

---

## 🚀 Comandos por Servicio

### API (Backend)
```bash
cd apps/api
npm install
npm run dev          # Desarrollo
npm run build        # Build
npm run start        # Producción
npm run db:migrate   # Migraciones
```

### Admin (Frontend)
```bash
cd apps/admin
npm install
npm run dev          # Desarrollo
npm run build        # Build
npm run start        # Producción
```

### Docker (Todo junto)
```bash
docker-compose up -d    # Levantar todo
docker-compose logs -f  # Ver logs
docker-compose down     # Detener todo
```

---

## 📦 Variables de Entorno

### API (.env)
```env
DATABASE_URL=postgresql://...
PORT=3001
ADMIN_API_TOKEN=secret123
```

### Admin (.env.local)
```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001
ADMIN_API_TOKEN=secret123
```

---

## 🎯 Tipos Compartidos

Para evitar duplicación, los tipos van en `packages/shared/types.ts`:

```typescript
// packages/shared/types.ts
export interface Payment {
  id: string;
  status: 'PENDING' | 'APPROVED' | 'DECLINED';
  amountInCents: number;
}

export interface Customer {
  id: string;
  name: string;
  email: string;
}
```

**Uso en API:**
```typescript
// apps/api/src/routes/payments.ts
import { Payment } from '@wompi/shared/types';
```

**Uso en Admin:**
```typescript
// apps/admin/app/payments/page.tsx
import { Payment } from '@wompi/shared/types';
```

---

## 📊 Resumen

| Servicio | Archivos | Líneas | Tecnologías |
|----------|----------|--------|-------------|
| **API** | ~120 | ~26,000 | Express + TypeScript + Prisma |
| **Admin** | ~240 | ~61,000 | Next.js + React + TypeScript |
| **Total** | ~360 | ~87,000 | TypeScript 100% |

---

**¿Esta estructura te parece correcta?** 🚀
