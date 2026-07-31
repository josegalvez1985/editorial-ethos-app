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
| `npm run build` | Build de producción (SSR, con proxy) |
| `npm run build:static` | Build estático para GitHub Pages — ver [`DESPLIEGUE.md`](DESPLIEGUE.md) |
| `npm run preview` | Sirve el build |
| `npm run lint` | ESLint |
| `npm run apk` | APK de Android con esta misma web dentro — ver [`APK.md`](APK.md) |

**En producción el sitio se sirve en <https://www.ethospy.online/> desde GitHub Pages** (el
`github.io` responde un `301` hacia el dominio), que es hosting estático: el proxy **no** corre y
el navegador le pega directo a ORDS. Ver [`DESPLIEGUE.md`](DESPLIEGUE.md).

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

- **El módulo de evaluaciones está solo en la web.** `mobile/` tiene login, inicio y cuenta.
- **Biometría en el APK y en `mobile/`, nunca en la web ni en la PWA.** El APK usa
  `@capgo/capacitor-native-biometric` contra el Keystore de Android; `mobile/` usa
  `expo-local-authentication`. En el navegador **no se ofrece**: sin Keystore, guardar la
  contraseña sería `localStorage` en texto plano. Ver [`APK.md`](APK.md) → *Acceso biométrico*.
- **El token nunca persiste**, en ningún frontend: vive en memoria y cada arranque pasa por
  el login. Lo único que puede quedar guardado es **la contraseña, cifrada en el Keystore y
  solo si el usuario activó la huella** — con ella se rehace el login, no se revive la sesión.
- La web pasa por proxy; la app va directo.

## Pendientes

**Ver [`PENDIENTES.md`](PENDIENTES.md).** Ahí está todo lo que quedó abierto, con el motivo
de cada cosa y qué costaría resolverla.

Lo único que bloquea hoy:

1. **Correr [`backend/ethos_evaluaciones_facilitadores.sql`](backend/ethos_evaluaciones_facilitadores.sql)
   en APEX.** El API de evaluaciones está caído hasta que se aplique.

El APK ya compila: `npm run apk` (ver [`APK.md`](APK.md)).
