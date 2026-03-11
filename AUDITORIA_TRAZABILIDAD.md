# Auditoría de Trazabilidad - Notificaciones y Pagos

## Estado Actual: Estandarizado

Se ha implementado un sistema de trazabilidad basado en `AsyncLocalStorage` que permite identificar el origen de cada acción (Actor) de forma consistente en todo el sistema.

### Actores Estandarizados

| Prefijo/Valor | Descripción | Ejemplo |
|-------|-------------|---------|
| `user:email` | Acción manual realizada por un administrador | `user:admin@empresa.com` |
| `job:name` | Acción automática disparada por un Job programado | `job:paymentRetry` |
| `webhook:provider` | Acción iniciada por una notificación externa | `webhook:wompi` |
| `sistema` | Acción interna genérica o de rutas públicas | `sistema` |

---

## Implementación Técnica

### 1. Captura de Contexto (ActorStore)
Se utiliza `AsyncLocalStorage` para mantener el actor durante todo el ciclo de vida de la solicitud o ejecución del job.

### 2. Middleware de API
Todas las solicitudes `/admin` extraen el email del usuario del encabezado `x-admin-user-email` o de la sesión de Super Admin, estableciendo el contexto automáticamente.

### 3. Job Runner
El procesador de tareas envuelve la ejecución de cada job con su actor correspondiente (`job:SUBSCRIPTION_REMINDER`, etc.).

---

## Flujo de Notificaciones y Logs

### Ejemplo: Cobro Automático Fallido
1. **Origen:** `jobs/runner.ts` (Job encolado)
2. **Actor automático:** `job:paymentRetry`
3. **Log generado:**
   - `LogLevel.ERROR`
   - `Source: jobs.payment_retry`
   - `Actor: job:paymentRetry`
   - `Mensaje: Fallo en cobro automático`

### Ejemplo: Envío Manual de Recordatorio
1. **Origen:** `routes/notifications.ts` (POST /schedule/subscription/:id)
2. **Actor extraído de req:** `user:pepito@empresa.com`
3. **Log generado:**
   - `LogLevel.INFO`
   - `Source: notifications.schedule`
   - `Actor: user:pepito@empresa.com`
   - `Mensaje: Notificaciones programadas`

---

## Guía de Uso para Desarrolladores

Para registrar un log con el actor del contexto actual, simplemente use `systemLog`:

```typescript
import { systemLog } from "./systemLog";

// El actor se tomará automáticamente del contexto (user o job)
await systemLog(LogLevel.INFO, "mi.modulo", "Acción realizada");
```

Si necesita forzar un actor específico (poco común):

```typescript
await systemLog(LogLevel.INFO, "mi.modulo", "Acción", {}, "actor:especifico");
```
