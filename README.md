# Juventud con Valores

> El repositorio, el `applicationId` del APK (`com.editorialethos.app`) y varias rutas
> internas todavía dicen **editorial-ethos**: es el nombre con el que nació el proyecto. La
> marca cambió el 04/08/2026; el identificador de la app **no se puede cambiar** sin que
> Android la trate como una app distinta y deje de instalarse encima de la que ya está en
> los teléfonos. Ver [`APK.md`](APK.md).

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
| `npm run ota` | Bundle de actualización remota del APK — ver [`OTA.md`](OTA.md) |

**En producción el sitio se sirve en <https://www.ethospy.online/> desde GitHub Pages** (el
`github.io` responde un `301` hacia el dominio), que es hosting estático: el proxy **no** corre y
el navegador le pega directo a ORDS. Ver [`DESPLIEGUE.md`](DESPLIEGUE.md).

**El navegador nunca llama a ORDS directo.** Va a `/api/ords/...` y el proxy server-side
[`src/routes/api/ords.$.ts`](src/routes/api/ords.$.ts) reenvía a Oracle: mismo origen, sin
CORS, y el token no queda en la URL.

Eso implica un **deploy con servidor Node** (el proxy es código de servidor). Si se sirviera
como sitio estático, el proxy no correría y habría que apuntar `VITE_API_URL` directo a ORDS
y depender de los headers CORS.

## Marca y temas

Los colores salen del logo (`public/logo.png`), **muestreados del PNG**, no estimados:

| Hex | Qué es | Dónde se usa |
| --- | --- | --- |
| `#27306a` | Navy de "VALORES" | **El primario**: botones, links, ítem activo |
| `#e41420` | Rojo de la franja | Acentos y `--destructive` |
| `#7095cc` | Azul del fondo | Anillos de foco, bordes, fondo del ícono |
| `#ffffff` | Blanco de "Juventud" | Texto sobre superficies de marca |

**El primario es el navy y no el rojo**, aunque en el logo el rojo ocupe más superficie: un
botón "Guardar" en rojo compite con los mensajes de error.

### El usuario elige dos cosas, no una

En **Mi cuenta** hay dos controles independientes que se combinan:

| Eje | Valores | Dónde vive |
| --- | --- | --- |
| Modo | claro / oscuro | clase `.dark` en `<html>` |
| Paleta | marca + 10 más | atributo `data-palette` en `<html>` |

Son **22 combinaciones**. Las paletas están en [`src/styles.css`](src/styles.css) y la
lista válida en [`src/lib/theme.tsx`](src/lib/theme.tsx) (`PALETAS`). Las dos preferencias
se guardan en `localStorage` (`ethos-theme`, `ethos-palette`) y **sobreviven al logout**:
son preferencias de interfaz, no datos de sesión.

**Una paleta solo cambia COLOR.** Ninguna toca `--font-*` ni `--radius`: la tipografía es
la misma en las once.

### Dos trampas al tocar los colores

1. **`--on-brand` es blanco SIEMPRE**, en las once paletas y en los dos modos. Es el texto
   que va sobre `bg-hero-gradient` / `bg-navy-gradient`, que son oscuros en los dos temas.
   Usar `--primary-foreground` ahí es lo que dejaba el copyright del login ilegible en modo
   oscuro: en oscuro el primario es claro, así que su *foreground* es casi negro.
2. **Los colores de la barra de estado están duplicados** en `COLOR_BARRA`
   ([`src/lib/theme.tsx`](src/lib/theme.tsx)) porque `<meta name="theme-color">` no acepta
   `var(--background)`. Si cambiás un `--background` en el CSS, cambialo también ahí.

Para agregar una paleta: un bloque `[data-palette="x"]` y otro `.dark[data-palette="x"]` en
el CSS, el nombre en `PALETAS`, su fila en `COLOR_BARRA` y la muestra en
[`src/routes/account.tsx`](src/routes/account.tsx).

`mobile/src/theme/colors.ts` es **espejo** de la paleta de marca: si tocás uno, tocá el otro.

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
- **Biometría solo en `mobile/`** (`expo-local-authentication`), que es la app que ya no se
  compila. Se implementó en el APK de Capacitor y **se quitó** el 31/07/2026; ver
  [`APK.md`](APK.md) → *No hay acceso biométrico*.
- **El token nunca persiste**, en ningún frontend: vive en memoria y cada arranque pasa por
  el login. Lo que sí puede quedar guardado es **la contraseña**, con el check "Recordar
  usuario y contraseña", igual en la web que en el APK: en `localStorage` y **en texto plano**.
  Sin Keystore no hay otro lugar donde ponerla. Es opt-in, el login lo advierte en pantalla, y
  con esa contraseña se rehace el login — nunca se revive la sesión.
- La web pasa por proxy; la app va directo.

## ¿Hay que repartir un APK nuevo? Casi nunca

**Una página nueva NO necesita un APK nuevo.** Desde la versión **1.9** el APK trae el plugin
de actualización remota: `git push` a `main` y los teléfonos levantan el cambio solos. Esta es
la tabla que responde la pregunta, y es la única que hay que consultar:

| Lo que cambiaste | ¿APK nuevo? |
| --- | --- |
| Una pantalla, una ruta, un ítem del menú | **No** — `git push` |
| Un formulario, una validación, un texto, un color | **No** — `git push` |
| Lógica de `src/lib/*.ts`, los gráficos, cómo se consulta la API | **No** — `git push` |
| Un `.sql` de `backend/` | **No** — se corre en APEX y listo, ni pasa por el APK |
| Instalar un plugin nativo de Capacitor | **Sí** |
| Ícono, splash, nombre visible de la app | **Sí** |
| Permisos del `AndroidManifest.xml` | **Sí** |
| `minSdkVersion` / `targetSdkVersion` | **Sí** |

**Regla de bolsillo:** si tocaste `android/`, `capacitor.config.ts`, o instalaste un paquete con
código nativo → APK. Si no → `git push`.

### Las dos condiciones, y son las únicas

1. **El teléfono tiene que tener la 1.9 o superior.** Las versiones anteriores **no traen el
   plugin**, así que no se actualizan solas por más que se publique: hay que instalarles un APK
   a mano **una vez**, y de ahí en adelante ya entran al circuito. Se mira en Ajustes →
   Aplicaciones → Juventud con Valores.
2. **Se ve al SEGUNDO arranque.** El bundle se descarga cuando abrís la app con internet y se
   aplica **cuando pasa a segundo plano**. O sea: abrir → salir → volver a entrar. Si abrís una
   sola vez y no ves el cambio, no está roto — falta el segundo arranque. Es deliberado:
   aplicarlo en caliente recarga la WebView y le borraría lo tipeado a quien esté a mitad de una
   evaluación.

Todo el detalle —cómo se publica el bundle, qué pasa sin internet, cómo volver atrás una
actualización mala— está en [`OTA.md`](OTA.md).

### Cuando sí toca compilar

`npm run apk` (ver [`APK.md`](APK.md)). **Antes hay que subir `versionCode`** en
`android/app/build.gradle`, o Android se niega a instalar encima. Hoy va en `14` / `"1.9.2"`.
