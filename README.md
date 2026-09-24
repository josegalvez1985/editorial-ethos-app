# Juventud con Valores

> El repositorio, el `applicationId` del APK (`com.editorialethos.app`) y varias rutas
> internas todavía dicen **editorial-ethos**: es el nombre con el que nació el proyecto. La
> marca cambió el 04/08/2026; el identificador de la app **no se puede cambiar** sin que
> Android la trate como una app distinta y deje de instalarse encima de la que ya está en
> los teléfonos. Ver [`APK.md`](APK.md).

Sistema de gestión sobre Oracle APEX/ORDS: un sitio web que también se instala en Android.

| Carpeta | Qué es | Dónde termina |
| --- | --- | --- |
| [`backend/`](backend/) | Oracle: un script por módulo, con su paquete PL/SQL y sus endpoints ORDS | se corre a mano en APEX |
| raíz (`src/`) | Sitio web — TanStack Start + Vite + React Query | <https://www.ethospy.online/>, en GitHub Pages |
| [`android/`](android/) | APK de Capacitor: una cáscara que abre el sitio publicado | APK que se reparte a mano |
| [`mobile/`](mobile/) | App Expo / React Native de una etapa anterior | **ya no se compila** |

**Hay un solo frontend vivo: el sitio.** El APK no tiene pantallas propias —su WebView carga el
sitio— y `mobile/` quedó con login, inicio y cuenta. Un cambio de UI se hace una sola vez, en
`src/`.

## 1. Backend (obligatorio, primero)

Nada funciona sin esto. Hay un script por módulo, todos idempotentes; el orden y el detalle de
cada uno están en [`backend/README.md`](backend/README.md).

1. APEX → SQL Workshop → SQL Scripts → sube y corre [`backend/auth.sql`](backend/auth.sql):
   login, token y el módulo ORDS `ethos`. Después, el script de cada módulo.
2. Copia la **URL base** que imprime `auth.sql` al final.
3. Ponla en `.env` (desarrollo) y en el `VITE_API_URL` de
   [`deploy.yml`](.github/workflows/deploy.yml) (producción).

Login: `POST auth/login`, `POST auth/logout`, `GET auth/me`. Token opaco de **6 horas** que
viaja en `Authorization: Bearer`.

> **Un `.sql` no se aplica solo, y un push publica enseguida.** Si un cambio toca el backend y
> el front, primero se corre el script en APEX y después se pushea: al revés, la pantalla nueva
> queda llamando a un endpoint que todavía no existe.

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
| `npm run apk` | APK de Android — una cáscara que carga este sitio, ver [`APK.md`](APK.md) |

**En producción el sitio se sirve en <https://www.ethospy.online/> desde GitHub Pages** (el
`github.io` responde un `301` hacia el dominio). Cada push a `main` lo publica en unos dos
minutos: ver [`DESPLIEGUE.md`](DESPLIEGUE.md).

Cómo llega el navegador a Oracle depende de dónde corre el sitio:

| Dónde | Cómo llega a ORDS |
| --- | --- |
| `npm run dev` (y el build SSR) | Por el proxy [`src/routes/api/ords.$.ts`](src/routes/api/ords.$.ts): el navegador va a `/api/ords/...`, mismo origen, sin CORS |
| Producción (Pages) y el APK | **Directo a ORDS.** Pages es estático y el proxy no corre, así que depende del CORS abierto de ORDS |

## Módulos

El menú sale de `MENU`, en [`src/lib/navegacion.ts`](src/lib/navegacion.ts). Sumar un módulo es
una entrada ahí y su archivo en `src/routes/`, y aparece solo en la sidebar, en la barra del
celular y en la hoja "Menú".

| Grupo | Módulo | Ruta | Backend |
| --- | --- | --- | --- |
| — | **Inicio**: gráficos de puntualidad, ubicación y actividad del mes | `/home` | `intervenciones.sql` |
| Operación | **Evaluaciones** de facilitadores | `/evaluaciones` | `evaluaciones_facilitadores.sql` |
| Operación | **Intervenciones**: carga manual de las que quedaron sin registrar | `/intervenciones` | `intervenciones_crud.sql` |
| Reportes | **Agendas**: el horario semanal | `/agendas` | `agendas.sql` |
| Administrador | **Auditoría**: qué tablas tienen bitácora y quién cambió qué | `/auditoria` | `auditoria.sql` |
| Sistema | **Mi cuenta**: tema, color y cierre de sesión | `/account` | — |

En **Auditoría**, la vista *Movimientos* tiene un buscador que mira en todos los campos de
cada tabla, y tocar un movimiento abre la historia del registro con **todos sus campos** y los
modificados resaltados, con su valor de antes y de después. Lo puede abrir cualquier usuario
con sesión (decidido el 24/09/2026). Los detalles están en
[`backend/README.md`](backend/README.md) → *Auditoría*.

## Pantallas: todo el ancho, en columnas

Desde el 24/09/2026 **no hay tope de ancho**: el contenido usa todo lo que deja la sidebar
([`src/components/app-shell.tsx`](src/components/app-shell.tsx)). Antes se centraba en 1152px
en escritorio —y en 480px en tablet— y en un monitor grande quedaban franjas vacías a los
costados.

Sin tope, cada pantalla reparte su contenido en columnas en lugar de estirar una sola:

| Pantalla | Columnas |
| --- | --- |
| Listados de Evaluaciones e Intervenciones | 1, 2 desde `md`, 3 desde `2xl` |
| Auditoría | hasta 4 tarjetas de tablas y los 6 filtros en una fila |
| Formularios de evaluación e intervención | 1, 2 desde `lg` |

**El celular y el APK se ven igual que antes**: todo está detrás de los breakpoints de tablet y
escritorio. Una pantalla nueva sigue el mismo criterio: grillas con `md:` / `lg:grid-cols-*`,
nunca un `max-w-*` que la encierre.

En escritorio, el botón **Guardar** del formulario de evaluación es *sticky* dentro del
contenido y no *fixed*: fixed ocupaba toda la ventana y tapaba el pie de la sidebar.

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

`mobile/src/theme/colors.ts` es **espejo** de la paleta de marca. Solo importa mantenerlo si
algún día se retoma `mobile/`, que hoy no se compila.

## 3. App Android

Es un APK de Capacitor que abre el sitio publicado. Cómo compilarlo, firmarlo y repartirlo está
en [`APK.md`](APK.md); casi nunca hace falta uno nuevo (ver más abajo).

`mobile/` (Expo) ya no se compila. Queda en el repo como referencia
—[`mobile/README.md`](mobile/README.md)—, pero "el APK" es el de Capacitor.

## Sesión y datos en el dispositivo

Vale igual en la web y en el APK, que es el mismo sitio:

- **El token nunca persiste**: vive en memoria y cada arranque pasa por el login.
- **La contraseña sí puede quedar guardada**, con el check "Recordar usuario y contraseña": en
  `localStorage` y **en texto plano** (sin Keystore no hay otro lugar donde ponerla). Es
  opt-in, el login lo advierte en pantalla, y con esa contraseña se rehace el login: nunca se
  revive la sesión.
- **La caché de consultas se guarda** en `localStorage` (`ethos-query-cache`, ver
  [`src/lib/query-persist.ts`](src/lib/query-persist.ts)) y se borra al cerrar sesión. **Las de
  Auditoría no**: llevan `meta: { persistir: false }`, porque la bitácora trae datos de todas
  las tablas.
- **No hay biometría.** Se implementó en el APK y se quitó el 31/07/2026; ver
  [`APK.md`](APK.md) → *No hay acceso biométrico*. La app Expo de `mobile/` la tenía, pero ya
  no se compila.

## ¿Hay que repartir un APK nuevo? Casi nunca

**El APK no contiene la app: es una cáscara que carga <https://www.ethospy.online/> en su
WebView.** Cada vez que se abre, pide esa URL. Así que lo que publica GitHub Pages es lo que el
usuario ve, y `git push` alcanza para actualizar todos los teléfonos.

```
Celular → APK (WebView) → https://www.ethospy.online/ → la app web
                                     ↑
                       git push → Actions → deploy a Pages
```

**La regla de oro para no romperlo:** el sitio de Pages es la fuente de verdad. Antes de
compilar cualquier APK, abrí esa URL en el navegador del celular. **Si ahí funciona, el APK va a
funcionar** — porque el APK no es más que ese mismo sitio dentro de una WebView. Y si ahí no
funciona, compilar un APK no lo va a arreglar.

Esta es la tabla que responde la pregunta:

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

### Las dos condiciones

1. **Hay que hacer `git push` a `main`, y el workflow tiene que TERMINAR.** Un commit local no
   publica nada. Tarda ~2 min y se mira en la pestaña **Actions** del repo: si está en amarillo,
   el sitio todavía es el anterior.
2. **El teléfono tiene que tener la 2.0 o superior.** Es la primera versión con `server.url`;
   las anteriores empaquetaban la web adentro y no se actualizan solas. Hay que instalarles un
   APK a mano **una vez** y listo. Se mira en Ajustes → Aplicaciones → Juventud con Valores.

Nada más. No hay bundle que descargar, ni segundo arranque, ni caché que esperar: la WebView
pide la URL cada vez que se abre la app.

### Si pusheaste y el teléfono no cambia

| Chequeo | Dónde | Qué esperar |
| --- | --- | --- |
| ¿Terminó el workflow? | pestaña **Actions** del repo | tilde verde, no amarillo |
| ¿El sitio tiene el cambio? | <https://www.ethospy.online/> en el navegador **del celular** | el cambio a la vista |
| ¿La app es 2.0+? | Ajustes → Aplicaciones → Juventud con Valores | 2.0 o superior |

El primero que falle es la causa. **El segundo es el que más informa:** si el sitio en el
navegador del celular no muestra el cambio, el problema no es el APK y compilar uno nuevo no
sirve de nada.

### Historia: por qué ya no hay OTA

Hasta el 05/08/2026 el APK empaquetaba la web adentro y se actualizaba con
[`@capgo/capacitor-updater`](https://github.com/Cap-go/capacitor-updater): el workflow publicaba
un `.zip` y un `updates.json`, el teléfono los descargaba y los aplicaba al pasar a segundo
plano.

**No funcionó en la práctica.** El bundle se publicaba bien —verificado— pero los cambios no
llegaban al teléfono, y cada intento de diagnóstico costaba compilar y repartir un APK. El
mecanismo tenía demasiados pasos que fallaban en silencio: descargar, verificar checksum,
aplicar al ir a background, y un `resetWhenUpdate` que descartaba el bundle en cada instalación
—así que instalar un APK para probar **retrocedía** el contenido web—.

`server.url` no tiene ninguno de esos pasos. Se fueron el plugin, `src/lib/ota.ts`,
`scripts/build-ota.mjs`, el paso del workflow y `OTA.md`.

**El costo, que es real:** la app **ya no abre sin internet**. Antes los assets viajaban dentro
del APK; ahora sin conexión aparece la pantalla de error del navegador. Se acepta porque la app
es 100% online igual —cada consulta va a Oracle—, así que sin red no se podía usar de todos
modos. Si algún día molesta, la salida es un service worker con **network-first para el HTML**
(nunca cache-first: eso congela la app en la versión cacheada y rompe justo lo que este cambio
vino a arreglar).

El mecanismo actual está explicado en [`capacitor.config.ts`](capacitor.config.ts), y cómo
compilar en [`APK.md`](APK.md).

### Cuando sí toca compilar

`npm run apk` (ver [`APK.md`](APK.md)). **Antes hay que subir `versionCode`** en
`android/app/build.gradle`, o Android se niega a instalar encima. Hoy va en `15` / `"2.0"`.

> **En la PC actual todavía no se puede compilar** (verificado el 24/09/2026): faltan el JDK
> 21, el SDK de Android y, lo más delicado, la clave de firma. Ver [`APK.md`](APK.md) →
> *Requisitos*.
