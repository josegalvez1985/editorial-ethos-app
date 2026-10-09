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

## Módulos y menú

**El menú sale de la base** desde el 08/10/2026, salvo tres partes fijas que van en el código.
Así queda, de arriba abajo:

| Parte | Quién la ve | De dónde sale |
| --- | --- | --- |
| **Inicio** | cualquiera con sesión | fijo, en el código |
| Núcleo de Datos, Operaciones, Reportes y Consultas, Administrador | quien tenga `PUEDE_CONSULTAR = 'S'` en `ROLES_PAGINAS` | la tabla `MENU_PAGINAS` |
| **Roles de páginas**, al principio de **Administrador** | quien tenga su página (la 2) con `PUEDE_CONSULTAR = 'S'` en `ROLES_PAGINAS` | el ítem, en el código; el permiso, de la base |
| **Crear páginas**, después de Roles de páginas | **solo JOSEG** | fija, en el código y en el paquete (`administra`) |
| **Mi cuenta** | cualquiera con sesión | fijo, en el código |

Hasta el 08/10/2026 las dos de administración tenían su propio grupo, **Administración**, justo
después de Inicio. Se juntaron con **Administrador**, el de la base: eran dos menús con casi el
mismo nombre y para lo mismo. El grupo se encuentra por nombre (sin importar tildes ni
mayúsculas); si algún día la base no tiene ningún menú Administrador, el sitio lo crea igual para
las dos fijas.

- **`MENU_PAGINAS`** dice qué pantallas hay, en qué menú principal van y con qué nombre.
- **`ROLES_PAGINAS`**, la misma tabla de permisos de APEX (`APP_ID` 40587), dice quién ve
  cada una.
- **Cada pantalla es una página** con su número, el mismo en las dos tablas. Una página nueva
  toma **el último número de `MENU_PAGINAS` más 1**, lo pone el sistema y no cambia nunca.
- **Crear una página no da permisos**, ni a quien la crea: se guarda solo en el menú y no le
  aparece a nadie hasta que el administrador se los da en **Roles de páginas** (desde el
  08/10/2026; antes quien la creaba quedaba con todos).
- **Roles de páginas se controla como en APEX** (desde el 08/10/2026; antes era fija para JOSEG y
  EDGARO): es la página 2 y la ve quien la tiene habilitada en `ROLES_PAGINAS`. Cada botón
  sigue su bandera —insertar, actualizar, borrar—, y el backend lo controla igual. El menú no
  la repite con el nombre de APEX (Roles de Usuarios): la muestra como Roles de páginas.
- **Crear páginas no depende de ningún rol**: quién la ve está en el paquete.

| Pantalla | Ruta | Quién | Para qué |
| --- | --- | --- | --- |
| **Roles de páginas** | `/permisos` | quien tenga la página 2 en `ROLES_PAGINAS` | Dar y quitar permisos a cada usuario (`ROLES_PAGINAS`), y copiarle los de otro. Es la página 2 de APEX; sus modales 3 (Crear Rol) y 19 (Copiar Roles) son diálogos de esta misma pantalla, con los permisos de la 2 |
| **Crear páginas** | `/paginas` | solo JOSEG | Alta, modificación y baja de las páginas del menú (`MENU_PAGINAS`) |

**Si nadie tiene la página 2 habilitada, nadie puede dar permisos desde el sitio**: hay que
cargarlo en APEX. `roles_paginas.sql` lista al final quién la tiene y avisa si no hay nadie.
Cambiar quién usa Crear páginas es cambiar la función `administra` en
[`backend/roles_paginas.sql`](backend/roles_paginas.sql) y volver a correr el script.

### Sumar un módulo

1. Su pantalla en `src/routes/`.
2. Su descripción en `PANTALLAS`, en [`src/lib/navegacion.ts`](src/lib/navegacion.ts). **El
   ícono no se toca**: ya está en `ICONOS_MENU` y la pantalla usa ese mismo (ver *Cómo se ve el
   menú*).
3. Su fila en **Administrador → Crear páginas**: menú principal, nombre y ruta. El número lo
   pone el sistema (el último del menú más 1) y la página queda **sin permisos**.
4. Los permisos en **Administrador → Roles de páginas**, también los de quien la creó. Al
   crearla, el aviso trae un botón **Dar permisos** que lleva ahí.

### Pasar una página de APEX al sitio

Las reglas acordadas desde el 08/10/2026. Valen para cada página que se recrea:

1. **Un script y un paquete por tabla** (`backend/<tabla>.sql`, `PKG_<TABLA>_ETHOS`), con su
   `src/lib/<tabla>.ts`. Nada de backends genéricos para varias tablas.
2. **Los modales de APEX no son páginas ni entradas del menú.** Son diálogos o secciones de la
   pantalla principal y usan los permisos de esa página. Ejemplos: Roles de páginas (2, 3 y
   19), Usuarios (67 y 68), Facilitadores (14, 15 y 63 a 66), Instituciones (16, 21, 33, 35,
   38, 43, 46 y 60).
3. **La página ya existe en `MENU_PAGINAS`** con su número de APEX y su ruta (ver
   [`backend/menu_paginas.sql`](backend/menu_paginas.sql)). No se crea otra: la pantalla usa esa
   ruta, y los permisos que ya tenía en `ROLES_PAGINAS` valen al publicarla.
4. **El ícono no se toca.** Ya está en `ICONOS_MENU`; la pantalla usa ese mismo. Solo se agrega
   la descripción en `PANTALLAS` (ver *Cómo se ve el menú*).
5. **Diseño moderno, no copia de APEX:**
   - listados en tarjetas, con buscador sin tildes ni mayúsculas;
   - filtros en pastillas que **bajan de línea** (`flex-wrap`), nunca una fila con scroll
     horizontal;
   - tablas de un nombre (Países, Nacionalidades, Materias, Énfasis) o con un "padre" (Departamentos, Ciudades,
     Barrios): `<CatalogoNombre>`, alta y edición en un diálogo;
   - fichas grandes (Facilitadores): una pantalla con secciones, las listas hijas adentro y un
     solo **Guardar** fijo al pie;
   - fichas con listas que son tablas aparte y tienen su propia página en APEX
     (Instituciones: autoridades, horario): **pestañas**; Datos con su Guardar al pie y cada
     lista guardada fila por fila en un diálogo. Las piezas de las fichas están en
     `components/ficha-ui.tsx`;
   - las listas de valores cortas como pastillas de un toque; campos y botones `rounded-xl`;
   - botones según los permisos de la página: sin insertar no hay "Nuevo", y así.
6. **Ubicación en cascada:** se elige el nivel más bajo (ciudad, barrio) y el resto se deriva en
   el backend, para que país, departamento y ciudad no se contradigan.
7. **Documentar al terminar:** una fila en *Los módulos de hoy*, una en la tabla de scripts de
   [`backend/README.md`](backend/README.md) y una sección ahí con sus endpoints y decisiones.
   Las trampas de Oracle y ORDS que ya aparecieron están en
   [`backend/README.md`](backend/README.md) → *Pasar una página de APEX: el backend*.

### Cómo se ve el menú

Desde el 08/10/2026, en la sidebar de escritorio y en la hoja **Menú** del celular:

- **Cada página y cada menú principal tiene un ícono distinto.** Los de las páginas, las del sitio
  y las de APEX que todavía no tiene, están en una sola lista, `ICONOS_MENU`; los de los menús
  principales, en `ICONOS_GRUPO` (todo en
  [`src/lib/navegacion.ts`](src/lib/navegacion.ts)). Una página o un menú nuevos, sin ícono
  asignado, reciben uno por palabra clave del nombre o uno libre de reserva: nunca el de otra.
- **Los menús principales se pliegan.** Arrancan cerrados, salvo el de la pantalla actual, que
  se abre solo al navegar. Lo abierto se recuerda en `localStorage` (`ethos-menu-abiertos`) y
  es lo mismo en la sidebar y en el celular. Inicio va siempre a la vista.
- Con la sidebar angosta (76px) cada menú principal se ve como su ícono sobre un recuadro
  tenue, y se despliega igual.
- Cuando una página de APEX se programa en el sitio, solo se suma su descripción en
  `PANTALLAS`, que es también la lista de rutas que existen: Crear páginas avisa con ella si
  una ruta no la tiene el sitio.

> **Los íconos del menú NO se cambian** (pedido el 08/10/2026). `ICONOS_MENU` **no se edita al
> programar una pantalla**: la pantalla usa el ícono que ya tiene ahí (por ejemplo, el `icon` de `<CatalogoNombre>`). No se "mejora" ni se reemplaza por otro
> que parezca más acorde: los usuarios reconocen cada página por su ícono. Cambiar uno es
> solo a pedido explícito.

**El menú no es la seguridad.** Ocultar un módulo no impide llamar a su endpoint con el token.
Hoy solo los endpoints de menú, permisos y Usuarios controlan `ROLES_PAGINAS`; los demás piden solo
sesión. Ver [`backend/README.md`](backend/README.md) → *Menú y permisos*.

### Los módulos de hoy

| Menú principal | Módulo | Ruta | Backend |
| --- | --- | --- | --- |
| — | **Inicio**: gráficos de puntualidad, ubicación y actividad del mes | `/home` | `intervenciones.sql` |
| Administrador | **Roles de páginas** (página 2 + modales 3 y 19) | `/permisos` | `roles_paginas.sql` |
| Administrador (fija) | **Crear páginas** | `/paginas` | `menu_paginas.sql`, `roles_paginas.sql` |
| Núcleo de Datos | **Países**: alta, modificación y baja (solo si nada lo usa). Páginas 4 y 5 (modal) de APEX | `/paises` | `paises.sql` |
| Núcleo de Datos | **Nacionalidades**: alta, modificación y baja (solo si nada la usa). Páginas 12 y 13 (modal) de APEX | `/nacionalidades` | `nacionalidades.sql` |
| Núcleo de Datos | **Facilitadores**: listado con filtro activos/inactivos y la ficha completa (personales, ubicación, iglesia, herramientas, banco, nominado por, referencias, estudios y situación laboral) en una pantalla con un solo Guardar. Páginas 14, 15 y 63 a 66 (modales) de APEX | `/facilitadores` | `facilitadores.sql` |
| Núcleo de Datos | **Departamentos**: los de cada país, filtrados y agrupados por país; alta, modificación y baja (solo si nada lo usa). Páginas 6 y 7 (modal) de APEX | `/departamentos` | `departamentos.sql` |
| Núcleo de Datos | **Ciudades**: las de cada departamento, filtradas y agrupadas por departamento; el país sale del departamento. Alta, modificación y baja (solo si nada la usa). Páginas 8 y 9 (modal) de APEX | `/ciudades` | `ciudades.sql` |
| Núcleo de Datos | **Barrios**: los de cada ciudad, filtrados y agrupados por ciudad; departamento y país salen de la ciudad. Alta, modificación y baja (solo si nada lo usa). Páginas 10 y 11 (modal) de APEX | `/barrios` | `barrios.sql` |
| Núcleo de Datos | **Instituciones**: listado con cómo va el año lectivo en cada una (horario, pre-horarios confirmados, postulaciones) y "Limpiar filtros", y la ficha con pestañas: **Datos** (con "asignar el facilitador a los pre-horarios"), **Autoridades** (directores y coordinadores, con alta de persona ahí mismo), **Horario** (por año, con "copiar el del año anterior"), **Pre-horarios** y **Postulaciones** (grillas editables iguales a los IG de la 43 y la 38, con "horarios de otro año", postulaciones por año y el Formulario N° 1 en **PDF e imagen**). Páginas 16, 21, 33, 35, 38, 43, 46 y 60 de APEX | `/instituciones` | `instituciones.sql`, `instituciones_directores.sql`, `instituciones_coordinadores.sql`, `horario_instituciones.sql`, `pre_horarios.sql`, `postulaciones.sql`, `directores.sql`, `coordinadores.sql` |
| Núcleo de Datos | **Docentes**: activos e inactivos en pastillas, buscador por nombre, CI o teléfono, aviso de CI o nombre repetido; uno en uso no se borra, se marca inactivo. Páginas 41 y 42 (modal) de APEX | `/docentes` | `docentes.sql` |
| Núcleo de Datos | **Materias** y **Énfasis**: alta, modificación y baja (solo si nada los usa, contando pre-horarios y postulaciones). Páginas 17/18 y 26/27 (modales) de APEX | `/materias`, `/enfasis` | `materias.sql`, `enfasis.sql` |
| Núcleo de Datos | **Sucursales**: alta, modificación y baja (solo si nada la usa) | `/sucursales` | `sucursales.sql` |
| Operaciones | **Evaluaciones** de facilitadores, con su calificación y su cierre | `/evaluaciones` | `evaluaciones_facilitadores.sql` |
| Operaciones | **Intervenciones**: carga manual de las que quedaron sin registrar | `/intervenciones` | `intervenciones_crud.sql` |
| Operaciones | **Inventario de manuales**: conteo físico por manual y sucursal; al cerrar, actualiza las existencias. El conteo en curso se descarta y el último cierre se revierte | `/inventario` | `inventarios.sql` |
| Operaciones | **Transferencias de manuales**: envío entre sucursales (cabecera y detalle); al recibir, mueve las existencias. Una recibida se revierte (vuelve a pendiente) o se elimina, devolviendo las existencias | `/transferencias` | `transferencias.sql` |
| Reportes y Consultas | **Agendas**: el horario semanal | `/agendas` | `agendas.sql` |
| Reportes y Consultas | **Consulta de inventarios**: conteos pendientes y cerrados por sucursal, gráfico comparativo entre inventarios y PDF con el logo | `/consulta-inventarios` | `inventarios.sql` |
| Reportes y Consultas | **Consulta de transferencias**: envíos entre sucursales por ruta y por manual, con el detalle de cada una y PDF | `/consulta-transferencias` | `transferencias.sql` |
| Administrador | **Usuarios**: las cuentas del workspace, con su estado y cuántas páginas tienen; activar y bloquear. Páginas 67 y 68 (modal) de APEX | `/usuarios` | `usuarios.sql`, `auth.sql` |
| Administrador | **Auditoría**: qué tablas tienen bitácora y quién cambió qué | `/auditoria` | `auditoria.sql` |
| Sistema | **Mi cuenta**: tema, color y cierre de sesión | `/account` | — |

Los menús principales y los nombres de esta tabla son los que cargó `menu_paginas.sql`. Si se
cambian desde **Crear páginas**, manda la base.

**Calificación de una evaluación:** no se guarda. Sale de contar los ítems marcados y buscar
ese número en `ESCALAS_EVALUACIONES` (0–15 Deficiente, 16–20 Aceptable, 21–24 Bueno, 25–28 Muy
Bueno, 29–32 Excelente). Los tramos están copiados en `src/lib/evaluaciones.ts` (`ESCALA`): **si
se cambia la tabla, hay que tocar ese archivo**. Ver [`backend/README.md`](backend/README.md) →
*`ESCALA` y la calificación*.

Los dos PDF comparten encabezado con logo, pie, tarjetas y estilo de tabla en
[`src/lib/pdf-base.ts`](src/lib/pdf-base.ts): un reporte nuevo arma solo su cuerpo. jsPDF se
descarga recién al tocar el botón, y el PDF se abre en una pestaña nueva (en el APK puede no
abrirse: la WebView no abre pestañas).

**El Formulario N° 1 de postulaciones es la excepción** (pestaña Postulaciones de una
institución): no usa ese encabezado, copia el formulario oficial que generaba APEX —bandas,
colores de los manuales, declaración y firma—. Se dibuja una sola vez en
[`src/lib/formulario-postulacion.ts`](src/lib/formulario-postulacion.ts) y sale en **PDF**
(oficio apaisado, paginado) y en **imagen PNG** del mismo dibujo, así no se desincronizan.

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
| Planilla de Inventario de manuales | 1, 2 desde `md`, 3 desde `2xl` |
| Auditoría | hasta 4 tarjetas de tablas y los 6 filtros en una fila |
| Formularios de evaluación e intervención | 1, 2 desde `lg` |

**El celular y el APK se ven igual que antes**: todo está detrás de los breakpoints de tablet y
escritorio. Una pantalla nueva sigue el mismo criterio: grillas con `md:` / `lg:grid-cols-*`,
nunca un `max-w-*` que la encierre.

**Toda grilla lleva `grid-cols-1` de base** (`grid grid-cols-1 gap-3 md:grid-cols-2`). Sin eso,
en celular la única columna es `auto` y crece hasta el texto más largo que no corta: el
`truncate` no actúa y la página entera se corre de costado. Pasó en las 16 grillas del cambio
del 24/09/2026 y se arregló el 06/10/2026.

**Pre-horarios y Postulaciones son la excepción al diseño de tarjetas** (pestañas de una
institución): Jose pidió el 09/10/2026 que se vieran y funcionaran igual que los Interactive
Grid de APEX (páginas 43 y 38). Las dos usan
[`src/components/grilla-editable.tsx`](src/components/grilla-editable.tsx): una tabla con las
columnas de APEX que se edita en la celda, con Agregar fila, Eliminar, Duplicar y Guardar. En
celular se desplaza de costado dentro de su caja (la página no se corre). No usarla en otras
pantallas sin que se pida.

En escritorio, el botón **Guardar** del formulario de evaluación es *sticky* dentro del
contenido y no *fixed*: fixed ocupaba toda la ventana y tapaba el pie de la sidebar.

**Un botón flotante (`fixed`) tapa el final de la lista** si la lista no le deja lugar. El de
**Nueva** en Evaluaciones tapaba "Cargar más" hasta el 08/10/2026: la lista ahora lleva
`pb-16 lg:pb-32`, la altura que ocupa el botón. Si se mueve o se agranda, hay que revisar esos
números ([`evaluaciones.index.tsx`](src/routes/evaluaciones.index.tsx)).

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

### Redondeo

Desde el 08/10/2026 `--radius` es **10px** (era 16px) y la escala sale de ahí, en
[`src/styles.css`](src/styles.css):

| Clase | Radio | Dónde |
| --- | --- | --- |
| `rounded-xl` | 12px | campos, selectores, buscadores y botones |
| `rounded-2xl` | 16px | tarjetas, diálogos y el botón flotante |
| `rounded-3xl` | 24px | la hoja inferior del celular |
| `rounded-lg` / `md` / `sm` | 10 / 8 / 6px | detalles chicos |
| `rounded-full` | redondo | **solo** pastillas de filtro, insignias, avatares y botones de ícono |

Con 16px, un campo de 48px de alto quedaba casi como una píldora (20px de radio). Un campo o un
botón nuevo va con `rounded-xl`, **nunca `rounded-full`**: eso es para pastillas y círculos.

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
  las tablas. **Tampoco el menú ni los permisos** (`META_PERMISOS`): un permiso quitado tiene
  que dejar de verse en el próximo arranque, no cuando venza la caché.
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
