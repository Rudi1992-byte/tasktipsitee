# TASKTIP Marketplace

Sitio y marketplace task-to-earn para TASKTIP (TASK) en OOGChain.

## Stack Gratis Recomendado

- Cloudflare Pages para el sitio.
- Cloudflare Pages Functions para `/api/*`.
- Cloudflare D1 para base de datos.
- Dominio conectado a Cloudflare.

## Archivos Importantes

- `index.html`: interfaz principal.
- `assets/`: imagen oficial y visuales de TASKTIP.
- `functions/api/[[path]].js`: API del marketplace con pagos manuales.
- `schema.sql`: tablas limpias para D1, sin tareas de prueba.
- `wrangler.example.toml`: ejemplo opcional de configuracion. En Cloudflare Pages con GitHub, configura D1 y variables desde el dashboard.

## Deploy En Cloudflare

1. Instalar Wrangler localmente:
   ```bash
   npm install -g wrangler
   ```

2. Iniciar sesion:
   ```bash
   wrangler login
   ```

3. Crear la base D1:
   ```bash
   wrangler d1 create tasktip_marketplace
   ```

4. Copiar el `database_id` que devuelve Cloudflare si luego quieres usar Wrangler localmente. Para Pages con GitHub no hace falta subir `wrangler.toml`.

5. Crear tablas:
   ```bash
   wrangler d1 execute tasktip_marketplace --file=schema.sql
   ```

6. Crear proyecto Pages desde el dashboard de Cloudflare o con Wrangler.

7. Configurar binding D1 en Pages:
   - Binding name: `DB`
   - Database: `tasktip_marketplace`

8. Crear variable de entorno para administracion:
   ```text
   ADMIN_TOKEN=un_codigo_privado_largo
   ```

9. Subir el proyecto a Cloudflare Pages.

## Endpoints

- `GET /api/tasks`: lista tareas.
- `POST /api/tasks`: crea tarea.
- `POST /api/tasks/:id/claim`: envia prueba para una tarea.
- `GET /api/claims?wallet=0x...`: lista pruebas de una wallet.
- `GET /api/balance?wallet=0x...`: muestra balance, pruebas pendientes, pagadas y disponible.
- `GET /api/admin/tasks`: lista tareas y depositos de anunciantes. Requiere header `x-admin-token`.
- `POST /api/admin/tasks/:id/approve`: aprueba el deposito y abre la tarea. Requiere header `x-admin-token`.
- `POST /api/admin/tasks/:id/delete`: elimina una tarea del marketplace. Requiere header `x-admin-token`.
- `GET /api/admin/claims`: lista todas las pruebas para administracion. Requiere header `x-admin-token`.
- `POST /api/admin/claims/:id/verify`: aprueba una prueba. Requiere header `x-admin-token`.
- `POST /api/admin/claims/:id/reject`: rechaza una prueba. Requiere header `x-admin-token`.
- `POST /api/admin/claims/:id/delete`: elimina una prueba. Requiere header `x-admin-token`.
- `POST /api/admin/claims/:id/pay`: marca una prueba como pagada. Requiere header `x-admin-token`.

## Pagos Manuales

Esta version usa publicacion de tareas, revision de pruebas y pagos manuales. El flujo es:

1. El anunciante publica una tarea y deja alias/nombre, Telegram y wallet de referencia.
2. El sitio calcula `reward + 5 TASK` de fee.
3. El anunciante deposita el total en la wallet de cobro y pega el hash.
4. La tarea queda pendiente hasta que el admin verifica el deposito.
5. El usuario envia prueba y deja alias/nombre, Telegram y wallet de pago.
6. El usuario puede dejar tambien un enlace de captura de pantalla como evidencia adicional.
7. El admin revisa la prueba y puede aprobarla, rechazarla o eliminarla.
8. El admin paga TASK manualmente desde su wallet.
9. El admin registra monto pagado, hash/nota de pago y fecha en D1.
10. Si hay bot de Telegram configurado, Cloudflare envia la muestra de pago automaticamente.

## Reglas Operativas

- El minimo de reward/retiro por tarea es `10 TASK`.
- El anunciante paga `reward + 5 TASK` para crear una tarea.
- Wallet de cobro de tareas: `0xf3542c8A751f880ed6E046881cBF1E3D707d9492`.
- Las tareas no se abren al publico hasta que el admin aprueba el hash del deposito.
- Una misma wallet solo puede enviar una prueba por tarea.
- Los pagos pueden demorar hasta 24 horas, segun el tipo de tarea y la revision.
- La wallet de pago es el dato principal para evitar multicuentas.
- El Telegram se usa para coordinar dudas, correcciones y soporte.

## Admin Token

Para usar las rutas de administracion en Cloudflare Pages, crea una variable de entorno:

```text
ADMIN_TOKEN=un_codigo_privado_largo
```

Luego envia ese valor en el header:

```text
x-admin-token: un_codigo_privado_largo
```

El panel admin no aparece en el menu publico. Para abrirlo usa:

```text
https://tu-sitio.pages.dev/?admin=1#admin
```

Tambien puedes escribir manualmente `#admin` al final de la URL. Aunque este oculto, el panel sigue protegido por `ADMIN_TOKEN`.

## Bot De Telegram Sin VPS

El aviso de pago funciona con Cloudflare Pages Functions y Telegram Bot API. No necesitas VPS.

Variables opcionales en Cloudflare Pages:

```text
TELEGRAM_BOT_TOKEN=token_del_bot_creado_con_BotFather
TELEGRAM_PAYMENTS_CHAT_ID=chat_id_del_grupo_o_canal_de_pagos
```

Cuando el admin marca una prueba como pagada desde el panel, el worker intenta enviar:

- aviso directo al `claimant_chat_id`, si el usuario lo dejo;
- aviso publico al `TELEGRAM_PAYMENTS_CHAT_ID`, si esta configurado.

## Siguiente Etapa

El marketplace arranca limpio y guarda tareas reales en D1. Los pagos se hacen manualmente para lanzar mas rapido, con registro interno de pruebas, wallet, monto pagado y hash de pago.

## Migracion Si Ya Existian Tablas

Si ya habias creado `tasks` antes de agregar el deposito de anunciantes, ejecuta esto en la consola D1:

```sql
ALTER TABLE tasks ADD COLUMN deposit_wallet TEXT NOT NULL DEFAULT '0xf3542c8A751f880ed6E046881cBF1E3D707d9492';
ALTER TABLE tasks ADD COLUMN creation_fee INTEGER NOT NULL DEFAULT 5;
ALTER TABLE tasks ADD COLUMN total_deposit INTEGER;
ALTER TABLE tasks ADD COLUMN deposit_tx TEXT;
ALTER TABLE tasks ADD COLUMN deposit_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE claims ADD COLUMN screenshot_url TEXT;
```

Si alguna columna ya existe, Cloudflare puede mostrar error en esa linea; continua con las que falten.
