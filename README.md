# Wompi Subs - Plataforma de Suscripciones

Plataforma de gestión de suscripciones y pagos con Wompi.

## 🏗️ Arquitectura

**2 Servicios Separados:**

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

## 📁 Estructura

```
wompi_subs/
├── apps/
│   ├── api/                  ← BACKEND (Express + TypeScript)
│   │   ├── src/
│   │   │   ├── routes/      ← Endpoints API REST
│   │   │   ├── services/    ← Lógica de negocio
│   │   │   ├── providers/   ← Wompi, Chatwoot
│   │   │   ├── jobs/        ← Background jobs
│   │   │   └── webhooks/    ← Webhooks handlers
│   │   ├── prisma/
│   │   └── package.json
│   │
│   └── admin/                ← FRONTEND (Next.js + React)
│       ├── app/
│       │   ├── api/         ← Server Actions
│       │   ├── lib/         ← Utilidades
│       │   ├── ui/          ← Componentes
│       │   └── ...          ← Páginas
│       ├── middleware.ts
│       └── package.json
│
├── packages/
│   └── shared/              ← Tipos compartidos
│       └── types.ts
│
├── docker-compose.yml
└── package.json
```

## 🚀 Inicio Rápido

### Con Docker (Recomendado)

```bash
# 1. Levantar todos los servicios
docker-compose up -d

# 2. Ver logs
docker-compose logs -f

# 3. Acceder
# API:   http://localhost:3001
# Admin: http://localhost:3002
```

### Local (Sin Docker)

```bash
# 1. Instalar dependencias
npm install

# 2. Levantar PostgreSQL (con Docker)
docker-compose up -d postgres

# 3. Iniciar API (terminal 1)
npm run dev:api

# 4. Iniciar Admin (terminal 2)
npm run dev:admin
```

## 📦 Comandos Disponibles

```bash
# Desarrollo
npm run dev          # Ambos servicios
npm run dev:api      # Solo API
npm run dev:admin    # Solo Admin

# Build
npm run build        # Ambos servicios
npm run build:api    # Solo API
npm run build:admin  # Solo Admin

# Base de datos
npm run db:generate  # Generar Prisma Client
npm run db:migrate   # Migraciones
npm run db:push      # Push directo (dev)
npm run db:studio    # Prisma Studio

# Docker
npm run docker:up    # Levantar todo
npm run docker:down  # Detener todo
npm run docker:logs  # Ver logs
```

## 🔐 Credenciales por Defecto

**Admin:**
- Email: `admin@localhost.com`
- Password: `Admin12345!`

## 📊 Servicios

| Servicio | Puerto | Función |
|----------|--------|---------|
| **PostgreSQL** | 5433 | Base de datos |
| **API** | 3001 | Backend (Express) |
| **Admin** | 3002 | Frontend (Next.js) |

## 🛠️ Stack Tecnológico

### Backend (API)
- Node.js + Express
- TypeScript 100%
- Prisma ORM
- PostgreSQL

### Frontend (Admin)
- Next.js 15
- React 19
- TypeScript
- CSS3

### Compartido
- Tipos TypeScript compartidos en `packages/core/` (unificados)

## 📝 API Endpoints

### Autenticación
```
POST /admin/auth/login
POST /admin/auth/logout
```

### Pagos
```
GET  /admin/payments
POST /admin/payments
GET  /admin/payments/:id
```

### Clientes
```
GET  /admin/customers
POST /admin/customers
GET  /admin/customers/:id
```

### Suscripciones
```
GET  /admin/subscriptions
POST /admin/subscriptions
PUT  /admin/subscriptions/:id
```

### Webhooks
```
POST /webhooks/wompi
POST /webhooks/chatwoot
```

### Health
```
GET /health
```

## 🔧 Variables de Entorno

### Backend (Next.js) (`apps/admin/.env.local`)
```env
DATABASE_URL=postgresql://...
PORT=3002
ADMIN_API_TOKEN=secret123
ADMIN_SESSION_SECRET=session-secret
SUPER_ADMIN_EMAIL=admin@example.com
SUPER_ADMIN_PASSWORD=secure-password
```

### Frontend (misma app)
```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:3002
ADMIN_API_TOKEN=secret123
ADMIN_SESSION_SECRET=session-secret
```

## 📄 Documentación

- [Estructura de Servicios](./ESTRUCTURA_SERVICIOS.md)
- [Migraciones](./MIGRACIONES.md)
- [Webhooks](./WEBHOOKS.md)

---

**Versión**: 2.0.0  
**Última actualización**: Marzo 2026
