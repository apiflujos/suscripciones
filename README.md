# Wompi Subs - Plataforma Unificada Next.js

Plataforma de gestión de suscripciones y pagos con Wompi, unificada en un solo proyecto Next.js.

## 🚀 Stack Tecnológico

- **Frontend & Backend**: Next.js 15 (App Router + API Routes)
- **Lenguaje**: TypeScript 100%
- **Base de Datos**: PostgreSQL + Prisma ORM
- **UI**: React 19 + CSS3

## 📁 Estructura

```
wompi_subs/
├── apps/
│   └── web/                    ← Aplicación principal
│       ├── app/
│       │   ├── api/           ← API Routes (reemplaza Express)
│       │   ├── lib/           ← Lógica de negocio
│       │   ├── types/         ← Tipos TypeScript
│       │   └── ...            ← Páginas
│       ├── middleware.ts      ← Middleware de Next.js
│       ├── next.config.js
│       ├── package.json
│       └── tsconfig.json
├── packages/
│   └── database/              ← Prisma ORM
│       ├── prisma/
│       └── client.ts
├── docker-compose.yml
└── package.json
```

## 🛠️ Desarrollo

### Prerrequisitos

- Node.js 20+
- Docker (para PostgreSQL)

### Inicio Rápido

```bash
# 1. Instalar dependencias
npm install

# 2. Levantar PostgreSQL
docker-compose up -d postgres

# 3. Generar Prisma Client
npm run db:generate

# 4. Aplicar migraciones
npm run db:migrate

# 5. Iniciar servidor de desarrollo
npm run dev
```

La aplicación estará disponible en: http://localhost:3000

## 📦 Comandos Disponibles

```bash
# Desarrollo
npm run dev              # Iniciar servidor de desarrollo
npm run build            # Build de producción
npm run start            # Iniciar en producción

# Base de datos
npm run db:generate      # Generar Prisma Client
npm run db:migrate       # Crear/aplicar migraciones
npm run db:migrate:deploy  # Aplicar migraciones en prod
npm run db:push          # Push directo (dev)
npm run db:studio        # Abrir Prisma Studio

# Calidad
npm run lint             # ESLint
```

## 🔐 Variables de Entorno

Crear `.env` en la raíz:

```env
# Base de datos
DATABASE_URL=postgresql://wompi_subs:wompi_subs@localhost:5433/wompi_subs

# Seguridad
ADMIN_API_TOKEN=dev-token-123456-change-in-production
ADMIN_SESSION_SECRET=dev-session-secret-change-in-production-abc123xyz
CREDENTIALS_ENCRYPTION_KEY_B64=mGBsjs4eVVtlDZ7yhyUlgzsLmvMeHqqGwhQnNfmB8QM=

# Wompi
WOMPI_ACTIVE_ENV=PRODUCTION
WOMPI_PUBLIC_KEY=
WOMPI_PRIVATE_KEY=
WOMPI_EVENTS_SECRET=

# Chatwoot (opcional)
CHATWOOT_ACTIVE_ENV=PRODUCTION
CHATWOOT_BASE_URL=
CHATWOOT_ACCOUNT_ID=
CHATWOOT_INBOX_ID=
CHATWOOT_API_ACCESS_TOKEN=
```

## 📊 API Endpoints

### Payments
- `GET /api/payments` - Listar pagos
- `POST /api/payments` - Crear pago

### Customers
- `GET /api/customers` - Listar clientes
- `POST /api/customers` - Crear cliente

### Settings
- `GET /api/settings` - Obtener configuración
- `POST /api/settings` - Actualizar configuración

### Health
- `GET /api/health` - Health check

### Webhooks
- `POST /api/webhooks/wompi` - Webhook de Wompi

## 🐳 Docker

```bash
# Levantar todo
docker-compose up -d

# Ver logs
docker-compose logs -f web

# Reiniciar servicio
docker-compose restart web

# Detener todo
docker-compose down
```

## 📝 Migraciones

### Crear nueva migración

```bash
npx prisma migrate dev --name nombre_migracion
```

### Aplicar en producción

```bash
npx prisma migrate deploy
```

## 🧪 Testing

```bash
# Tests unitarios (pendiente de implementar)
npm test

# Tests E2E (pendiente de implementar)
npm run test:e2e
```

## 📄 Licencia

Propietario - Todos los derechos reservados.

---

**Versión**: 2.0.0  
**Última actualización**: Marzo 2026
