# 🚀 Deploy en Producción con PM2

## ✅ Pre-Deploy Checklist

- [x] Código en rama `main`
- [x] Todos los commits subidos
- [x] Variables de entorno configuradas
- [x] Database URL configurada
- [x] Secrets generados

---

## 📋 Paso 1: Instalar Dependencias Globales

```bash
# Instalar PM2 globalmente
npm install -g pm2

# Verificar instalación
pm2 --version
```

---

## 📋 Paso 2: Configurar Variables de Entorno

### Crear archivo `.env` en la raíz

```bash
# Variables compartidas
export NODE_ENV=production
export DATABASE_URL="postgresql://user:password@host:5432/wompi_subs"
export ADMIN_API_TOKEN="generar-token-seguro-aqui"
export ADMIN_SESSION_SECRET="generar-secreto-largo-aqui"

# Encriptación de credenciales (32 bytes en base64)
export CREDENTIALS_ENCRYPTION_KEY_B64="$(openssl rand -base64 32)"

# Super Admin
export SUPER_ADMIN_EMAIL="admin@tuempresa.com"
export SUPER_ADMIN_PASSWORD="Password-Seguro-123!"
export SUPER_ADMIN_RESET_PASSWORD=0

# Wompi
export WOMPI_ACTIVE_ENV=PRODUCTION
export WOMPI_PUBLIC_KEY="tu-public-key"
export WOMPI_PRIVATE_KEY="tu-private-key"
export WOMPI_EVENTS_SECRET="tu-events-secret"
export WOMPI_API_BASE_URL="https://production.wompi.co/v1"

# Chatwoot (opcional)
export CHATWOOT_ACTIVE_ENV=PRODUCTION
export CHATWOOT_BASE_URL="https://tu-chatwoot.com"
export CHATWOOT_ACCOUNT_ID="1"
export CHATWOOT_INBOX_ID="1"
export CHATWOOT_API_ACCESS_TOKEN="tu-token"

# Jobs
export JOBS_HEARTBEAT_KEY="wompi-subs-jobs"
export JOBS_HEARTBEAT_SECONDS=60
export GAMIFICATION_RECALC_MINUTES=60
```

### Copiar a archivos específicos

```bash
# API
cp .env apps/api/.env

# Admin
cat > apps/admin/.env.local << EOF
NEXT_PUBLIC_API_BASE_URL=https://tudominio.com
ADMIN_API_TOKEN=$ADMIN_API_TOKEN
ADMIN_SESSION_SECRET=$ADMIN_SESSION_SECRET
EOF
```

---

## 📋 Paso 3: Build de Producción

```bash
# Instalar dependencias
npm ci --production

# Build de API
cd apps/api
npm ci --production
npm run build
cd ../..

# Build de Admin
cd apps/admin
npm ci --production
npm run build
cd ../..
```

---

## 📋 Paso 4: Migraciones de Base de Datos

```bash
cd apps/api

# Generar Prisma Client
npx prisma generate

# Aplicar migraciones
npx prisma migrate deploy

# (Opcional) Seed de datos iniciales
npx prisma db seed

cd ../..
```

---

## 📋 Paso 5: Configurar PM2

### Crear `ecosystem.config.js` (ya existe, verificar)

```javascript
module.exports = {
  apps: [
    {
      name: 'wompi-subs-api',
      cwd: './apps/api',
      script: 'npm',
      args: 'run start',
      env: {
        NODE_ENV: 'production',
        PORT: 3001
      },
      instances: 2,
      exec_mode: 'cluster',
      error_file: './logs/api-error.log',
      out_file: './logs/api-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss'
    },
    {
      name: 'wompi-subs-admin',
      cwd: './apps/admin',
      script: 'npm',
      args: 'run start',
      env: {
        NODE_ENV: 'production',
        PORT: 3002,
        HOST: '0.0.0.0'
      },
      instances: 1,
      exec_mode: 'fork',
      error_file: './logs/admin-error.log',
      out_file: './logs/admin-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss'
    }
  ]
};
```

---

## 📋 Paso 6: Iniciar con PM2

```bash
# Iniciar todos los servicios
pm2 start ecosystem.config.js

# Guardar configuración (para restart automático)
pm2 save

# Configurar PM2 para inicio automático
pm2 startup
# (Copiar y ejecutar el comando que muestra)
```

---

## 📋 Paso 7: Verificar Servicios

```bash
# Ver estado
pm2 status

# Ver logs en tiempo real
pm2 logs

# Ver logs específicos
pm2 logs wompi-subs-api
pm2 logs wompi-subs-admin

# Ver detalles
pm2 show wompi-subs-api
pm2 show wompi-subs-admin
```

---

## 📋 Paso 8: Configurar Nginx (Reverse Proxy)

### Instalar Nginx

```bash
sudo apt update
sudo apt install nginx -y
```

### Configurar Nginx

```bash
sudo nano /etc/nginx/sites-available/wompi-subs
```

### Contenido del config

```nginx
server {
    listen 80;
    server_name tudominio.com;

    # Redirect HTTP a HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name tudominio.com;

    # SSL (usar Let's Encrypt)
    ssl_certificate /etc/letsencrypt/live/tudominio.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/tudominio.com/privkey.pem;

    # Admin (Frontend)
    location / {
        proxy_pass http://localhost:3002;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    # API (Backend)
    location /api/ {
        proxy_pass http://localhost:3001/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    # Webhooks
    location /webhooks/ {
        proxy_pass http://localhost:3001/webhooks/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        
        # Aumentar timeout para webhooks
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
}
```

### Habilitar sitio

```bash
# Crear symlink
sudo ln -s /etc/nginx/sites-available/wompi-subs /etc/nginx/sites-enabled/

# Testear configuración
sudo nginx -t

# Recargar Nginx
sudo systemctl reload nginx
```

---

## 📋 Paso 9: SSL con Let's Encrypt

```bash
# Instalar Certbot
sudo apt install certbot python3-certbot-nginx -y

# Obtener certificado
sudo certbot --nginx -d tudominio.com

# Auto-renewal (ya viene configurado, verificar)
sudo certbot renew --dry-run
```

---

## 📋 Paso 10: Comandos Útiles de PM2

```bash
# Ver estado
pm2 status

# Reiniciar todo
pm2 restart all

# Reiniciar servicio específico
pm2 restart wompi-subs-api
pm2 restart wompi-subs-admin

# Detener todo
pm2 stop all

# Iniciar todo
pm2 start all

# Ver logs
pm2 logs

# Ver logs en tiempo real
pm2 logs --lines 100

# Monitoreo en tiempo real
pm2 monit

# Eliminar de PM2
pm2 delete all

# Guardar estado actual
pm2 save

# Listar procesos guardados
pm2 list
```

---

## 🔍 Verificación Post-Deploy

### 1. Health Check

```bash
# API
curl https://tudominio.com/api/health

# Debería responder:
# {"ok":true}
```

### 2. Login

```bash
# Acceder a
https://tudominio.com/login

# Credenciales
Email: admin@tuempresa.com
Password: Password-Seguro-123!
```

### 3. Webhooks

```bash
# Configurar en Wompi
URL: https://tudominio.com/webhooks/wompi
Secret: WOMPI_EVENTS_SECRET
```

### 4. Logs

```bash
# Ver logs de API
pm2 logs wompi-subs-api --lines 50

# Ver logs de Admin
pm2 logs wompi-subs-admin --lines 50
```

---

## ⚠️ Troubleshooting

### API no inicia

```bash
# Ver logs de error
pm2 logs wompi-subs-api --err

# Verificar variables de entorno
pm2 show wompi-subs-api

# Revisar .env
cat apps/api/.env | grep DATABASE_URL
```

### Admin no carga

```bash
# Rebuild de Admin
cd apps/admin
npm run build
pm2 restart wompi-subs-admin
```

### Errores de Base de Datos

```bash
# Verificar conexión
cd apps/api
npx prisma db pull

# Regenerar client
npx prisma generate
```

### Memoria Insuficiente

```bash
# Ver uso de memoria
pm2 monit

# Ajustar instancias en ecosystem.config.js
instances: 1  # Reducir si hay poca RAM
```

---

## 📊 Monitoreo

### PM2 Monitor

```bash
pm2 monit
```

### Logs en Tiempo Real

```bash
pm2 logs --lines 1000
```

### Métricas de API

```bash
curl https://tudominio.com/api/health
```

---

## ✅ Checklist Final

- [ ] PM2 instalado globalmente
- [ ] Variables de entorno configuradas
- [ ] Build de API exitoso
- [ ] Build de Admin exitoso
- [ ] Migraciones aplicadas
- [ ] PM2 configurado
- [ ] Servicios iniciados
- [ ] Nginx configurado
- [ ] SSL instalado
- [ ] Health check responde
- [ ] Login funciona
- [ ] Webhooks configurados
- [ ] Logs verificados

---

## 🎯 Estado: ✅ LISTO PARA PRODUCCIÓN

**Comando Final:**

```bash
pm2 start ecosystem.config.js && pm2 save && pm2 startup
```

---

**Fecha**: Marzo 2026  
**Versión**: 2.0.0  
**Deploy**: PM2 + Nginx + SSL
