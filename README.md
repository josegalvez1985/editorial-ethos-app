# Editorial Ethos

Login real contra Oracle APEX/ORDS, con **dos frontends** que comparten el backend:

| Carpeta | Qué es | Salida |
| --- | --- | --- |
| [`backend/`](backend/) | Oracle: tabla de tokens, `PKG_AUTH_ETHOS` y endpoints ORDS | — |
| raíz (`src/`) | Sitio web — TanStack Start + Vite | dominio, con servidor Node |
| [`mobile/`](mobile/) | App Android — Expo / React Native | APK instalable |

Los dos frontends **no comparten código**: son dos implementaciones del mismo diseño y del
mismo contrato de API. Un cambio de UI hay que hacerlo en ambos.

## 1. Backend (obligatorio, primero)

Nada funciona sin esto. Ver [`backend/README.md`](backend/README.md).

1. APEX → SQL Workshop → SQL Scripts → sube y corre
   [`backend/ethos_auth.sql`](backend/ethos_auth.sql).
2. Copia la **URL base** que imprime al final.
3. Ponla en `.env` (web) y en `mobile/app.json` → `expo.extra.apiUrl` (móvil).

Endpoints: `POST auth/login`, `POST auth/logout`, `GET auth/me`.
Token opaco de **6 horas** que viaja en `Authorization: Bearer`.

## 2. Sitio web

```bash
cp .env.example .env
npm install
npm run dev
```

| Comando | Qué hace |
| --- | --- |
| `npm run dev` | Servidor de desarrollo |
| `npm run build` | Build de producción |
| `npm run preview` | Sirve el build |
| `npm run lint` | ESLint |

**El navegador nunca llama a ORDS directo.** Va a `/api/ords/...` y el proxy server-side
[`src/routes/api/ords.$.ts`](src/routes/api/ords.$.ts) reenvía a Oracle: mismo origen, sin
CORS, y el token no queda en la URL.

Eso implica un **deploy con servidor Node** (el proxy es código de servidor). Si se sirviera
como sitio estático, el proxy no correría y habría que apuntar `VITE_API_URL` directo a ORDS
y depender de los headers CORS.

## 3. App Android

Ver [`mobile/README.md`](mobile/README.md).

```bash
cd mobile
npm install
npm start          # QR para Expo Go
npm run build:apk  # APK vía EAS
```

La app **sí** pega directo a ORDS, lo cual es válido porque el `fetch` de React Native no
aplica CORS. No usa el proxy.

## Diferencias entre los dos frontends

No son bugs:

- **Biometría solo en la app.** `mobile/` usa `expo-local-authentication` + keystore del
  sistema. En el navegador no hay equivalente sin WebAuthn, así que el botón lo dice en vez
  de simular un acceso, y el switch de la pantalla de cuenta guarda solo la preferencia.
- **La web tiene "Mantener sesión iniciada"** (localStorage vs. sessionStorage); la app
  siempre persiste.
- La web pasa por proxy; la app va directo.

## Pendientes conocidos

- El contenido de `home` es **mockup embebido** en ambos frontends, no viene de una API.
- Sin rate limiting en el login (ver `backend/README.md`).
- El token no se renueva: a las 6 h, de vuelta al login.
