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
| **Roles de páginas** | `/permisos` | quien tenga la página 2 en `ROLES_PAGINAS` | Dar y quitar permisos a cada usuario (`ROLES_PAGINAS`), y copiarle los de otro. Buscador de usuarios y, desde el 12/10/2026, de las páginas de cada usuario (por nombre o número). Es la página 2 de APEX; sus modales 3 (Crear Rol) y 19 (Copiar Roles) son diálogos de esta misma pantalla, con los permisos de la 2 |
| **Crear páginas** | `/paginas` | solo JOSEG | Alta, modificación y baja de las páginas del menú (`MENU_PAGINAS`), con un buscador por nombre, ruta, menú principal o número |

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
   - botones según los permisos de la página: sin insertar no hay "Nuevo", y así;
   - **todo reporte con detalle lleva el botón Excel** (desde el 12/10/2026): ver *Reportes:
     siempre con Excel*;
   - **y su tabla de detalle se ordena y se filtra por columna**, como el menú de columna de
     APEX (desde el 12/10/2026): ver *Reportes: orden y filtro por columna*;
   - **con marcos verticales entre columnas** (desde el 12/10/2026): ver *Reportes: marcos
     verticales en el detalle*.
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
| — | **Inicio**: filtros Año → Mes → **Semana** (o todas) → Desarrollo del índice, y los gráficos en este orden: **Actividad** (por día, tres barras: todas, desarrollados y no desarrollados, con una franja de fondo por día y una alerta en ámbar cuando los no desarrollados superan a los desarrollados; tocar una barra abre el día con sus facilitadores e instituciones), **Ubicación** y **Puntualidad** | `/home` | `intervenciones.sql` |
| Administrador | **Roles de páginas** (página 2 + modales 3 y 19) | `/permisos` | `roles_paginas.sql` |
| Administrador (fija) | **Crear páginas**, con un buscador por nombre, ruta, menú o número (12/10/2026) | `/paginas` | `menu_paginas.sql`, `roles_paginas.sql` |
| Núcleo de Datos | **Países**: alta, modificación y baja (solo si nada lo usa). Páginas 4 y 5 (modal) de APEX | `/paises` | `paises.sql` |
| Núcleo de Datos | **Nacionalidades**: alta, modificación y baja (solo si nada la usa). Páginas 12 y 13 (modal) de APEX | `/nacionalidades` | `nacionalidades.sql` |
| Núcleo de Datos | **Facilitadores**: listado con filtro activos/inactivos y la ficha completa (personales, ubicación, iglesia, herramientas, banco, nominado por, referencias, estudios y situación laboral) en una pantalla con un solo Guardar. Páginas 14, 15 y 63 a 66 (modales) de APEX | `/facilitadores` | `facilitadores.sql` |
| Núcleo de Datos | **Departamentos**: los de cada país, filtrados y agrupados por país; alta, modificación y baja (solo si nada lo usa). Páginas 6 y 7 (modal) de APEX | `/departamentos` | `departamentos.sql` |
| Núcleo de Datos | **Ciudades**: las de cada departamento, filtradas y agrupadas por departamento; el país sale del departamento. Alta, modificación y baja (solo si nada la usa). Páginas 8 y 9 (modal) de APEX | `/ciudades` | `ciudades.sql` |
| Núcleo de Datos | **Barrios**: los de cada ciudad, filtrados y agrupados por ciudad; departamento y país salen de la ciudad. Alta, modificación y baja (solo si nada lo usa). Páginas 10 y 11 (modal) de APEX | `/barrios` | `barrios.sql` |
| Núcleo de Datos | **Instituciones**: listado con cómo va el año lectivo en cada una (horario, pre-horarios confirmados, postulaciones) y "Limpiar filtros", y la ficha con pestañas: **Datos** (con "asignar el facilitador a los pre-horarios"), **Autoridades** (directores y coordinadores, con alta de persona ahí mismo), **Horario** (por año, con "copiar el del año anterior"), **Pre-horarios** y **Postulaciones** (grillas editables iguales a los IG de la 43 y la 38, con la lupa, todas las filas a la vista, los manuales en su color, los días agrupados en Desde/Hasta y las horas escritas con un clic, con "horarios de otro año", postulaciones por año y el Formulario N° 1 en **PDF e imagen**). Páginas 16, 21, 33, 35, 38, 43, 46 y 60 de APEX | `/instituciones` | `instituciones.sql`, `instituciones_directores.sql`, `instituciones_coordinadores.sql`, `horario_instituciones.sql`, `pre_horarios.sql`, `postulaciones.sql`, `directores.sql`, `coordinadores.sql` |
| Núcleo de Datos | **Docentes**: activos e inactivos en pastillas, buscador por nombre, CI o teléfono, aviso de CI o nombre repetido; uno en uso no se borra, se marca inactivo. Páginas 41 y 42 (modal) de APEX | `/docentes` | `docentes.sql` |
| Núcleo de Datos | **Materias** y **Énfasis**: alta, modificación y baja (solo si nada los usa, contando pre-horarios y postulaciones). Páginas 17/18 y 26/27 (modales) de APEX | `/materias`, `/enfasis` | `materias.sql`, `enfasis.sql` |
| Núcleo de Datos | **Índices**: los de cada manual, agrupados y en orden, con pastillas por manual y buscador; el alta propone el número siguiente y "Agregar y seguir" carga un índice entero de corrido. No repite un número dentro del manual; uno en uso no se borra ni cambia de manual. Páginas 28 y 29 (modal) de APEX | `/indices` | `indices.sql` |
| Núcleo de Datos | **Horarios de Instituciones**: una tarjeta por institución con cada turno (rango, bloques y total), por año, con filtro por turno, buscador y **"Sin horario"** (las activas que faltan, avisando si tienen el de otro año para copiar). Tocar una abre su horario completo, el mismo de la ficha. Páginas 31 y 32 (modal) de APEX | `/horarios-instituciones` | `horario_instituciones.sql`, `instituciones.sql` |
| Núcleo de Datos | **Directores**: las personas, con qué institución dirige hoy cada una; pastillas Todos / Activos / Sin institución, buscador por nombre, CI, teléfono o institución, y en el diálogo dónde figura (lleva a la pestaña Autoridades). CI repetida se frena; uno que figura en alguna institución no se borra. Páginas 34 y 35 (modal) de APEX | `/directores` | `directores.sql`, `instituciones_directores.sql` |
| Núcleo de Datos | **Instituciones y Directores**: una tarjeta por institución con sus directores (cargo, nivel, turno, período y teléfono para llamar); pastillas Vigentes / **Sin director** (las activas que hoy no tienen, con el último que tuvieron) / Todas, por período y por nivel, y buscador. Alta y edición en el mismo diálogo de la ficha, eligiendo la institución. Páginas 36 y 37 (modal) de APEX | `/instituciones-directores` | `instituciones_directores.sql`, `directores.sql`, `instituciones.sql` |
| Núcleo de Datos | **Instituciones y Coordinadores**: la misma pantalla que Instituciones y Directores, para `INSTITUCIONES_COORDNADORES` (tipo en lugar de cargo; pastilla **Sin coordinador**). Páginas 47 y 48 (modal) de APEX | `/instituciones-coordinadores` | `instituciones_coordinadores.sql`, `coordinadores.sql`, `instituciones.sql` |
| Núcleo de Datos | **Coordinadores**: la misma pantalla que Directores, para las personas de `COORDINADORES`. Páginas 45 y 46 (modal) de APEX | `/coordinadores` | `coordinadores.sql`, `instituciones_coordinadores.sql` |
| Núcleo de Datos | **Años Lectivos**: el vigente arriba, con su período, cuánto va del año y qué datos tiene; los demás en tarjetas con **"Hacer vigente"** (desactiva el anterior en la misma operación). El alta propone el año siguiente con las fechas un año después y avisa si se pisan. Con datos no se borra ni cambia de número; el vigente no se borra. Páginas 57 y 59 (modal) de APEX | `/anios-lectivos` | `anios_lectivos.sql` |
| Núcleo de Datos | **Feriados Nacionales**: el próximo feriado arriba con cuánto falta; por año en pastillas y agrupados por mes, con día de la semana y fin de semana; **"Copiar los de {año anterior}"** (mismo día y mes, saltea los que ya están). Un día no se carga dos veces. Páginas 70 y 71 (modal) de APEX | `/feriados` | `feriados.sql` |
| Núcleo de Datos | **Etapas**: numeradas por año ("2ª etapa 2026"), la en curso arriba con cuánto falta, una **línea de tiempo del año** con cada etapa y el día de hoy, y aviso de las que se pisan. El alta propone la siguiente con el mismo largo; en uso no se borra. Páginas 79 y 80 (modal) de APEX | `/etapas` | `etapas.sql` |
| Núcleo de Datos | **Áreas de Evaluación**: alta, modificación y baja (solo si ningún ítem ni evaluación la usa), con `<CatalogoNombre>`. Páginas 81 y 82 (modal) de APEX | `/areas-evaluacion` | `areas_evaluaciones.sql` |
| Núcleo de Datos | **Evaluaciones** (los ítems): agrupados por área con pastillas y buscador; cada uno dice en cuántas evaluaciones se usó (en uso no se borra ni cambia de área). "Agregar y seguir" para cargar varios de corrido. Páginas 83 y 84 (modal) de APEX | `/items-evaluacion` | `evaluaciones.sql` |
| Núcleo de Datos | **Escalas de Evaluaciones**: la escala por **tramos** (Deficiente, Aceptable…) sobre una barra de 0 al máximo; "Editar tramos" cambia topes y textos de todos a la vez; avisa si faltan números. Las filas sueltas, a mano como en APEX (una usada no se borra ni cambia de número). Páginas 85 y 86 (modal) de APEX | `/escalas-evaluacion` | `escalas_evaluaciones.sql` |
| Operaciones | **Postulaciones** (con el formato de APEX, a pedido): filtros Año / Departamento / Ciudades / Barrios / Institución / Turno encadenados, botones **Generar** (8 filas), **Eliminar** (solo el año elegido; saltea las que tienen intervenciones o evaluaciones), **Imprimir** (el PDF oficio apaisado de la 20) y Limpiar Filtros; la grilla con las columnas y colores del IG y el lápiz que abre el modal 22 con sus campos y colores. La grilla **carga recién con una institución elegida** (antes de eso solo se piden los años) y tiene la lupa y todas las filas a la vista, como las de la ficha. Páginas 20 y 22 (modal) de APEX | `/postulaciones` | `postulaciones.sql` |
| Reportes y Consultas | **Cantidad de Alumnos por Grado**: la suma de alumnos de cada grado (2° a 3M) de las postulaciones activas, por institución + facilitador + año. Filtros Año (el actual de entrada, o "Todos los años") / Facilitador (con "Sin facilitador") / Departamento / Ciudad / Barrio / Institución, cada opción con cuántas filas y alumnos quedan, buscador y Restablecer. Arriba el total de alumnos; abajo **el reporte de APEX** con sus columnas en orden, el total de cada grado al pie, la paginación arriba, orden y filtro por columna y **Excel**. Página 49 de APEX | `/consulta-alumnos-grado` | `postulaciones.sql` (sin SQL propio: usa `postulaciones/todas`) |
| Reportes y Consultas | **Cantidad de Manuales**: la suma de cada manual (Ser a Liderazgo) de las postulaciones activas, por institución + facilitador + año. Filtros Año (el actual de entrada, o "Todos los años"; APEX lo tenía fijo en 2026) / Institución / Facilitador (con "Sin facilitador"), con cuántas filas y manuales quedan, buscador y Restablecer. Arriba el total de manuales; abajo **el reporte de APEX** con el total de cada manual al pie, la paginación arriba, orden y filtro por columna y **Excel**. Página 50 de APEX | `/consulta-cantidad-manuales` | `postulaciones.sql` (sin SQL propio: usa `postulaciones/todas`) |
| Reportes y Consultas | **Intervenciones no realizadas**: las marcaciones con el índice no desarrollado. Facetas Año (el actual de entrada, o "Todos los años"), Mes, Fecha, Motivo Desarrollo, Institución y Facilitador, con cuántas quedan; buscador y Restablecer; un resumen (no realizadas, facilitadores, instituciones, motivo más frecuente); el reporte de APEX con sus 10 columnas (Facilitador, Institución, Fecha, Motivo, Observación, Manual, Índice, Turno, Grado, Sección), la última primero, 50 por página, orden y filtro por columna y **Excel**. Página 69 de APEX | `/intervenciones-no-realizadas` | `intervenciones.sql` (`intervenciones/no-realizadas`) |
| Reportes y Consultas | **Consulta de Facilitadores**: de solo lectura (para editar está Facilitadores). La faceta Activo (Sí/No con cuántos; sin dato cuenta como No, como en APEX), el buscador sobre sus datos y Restablecer; un resumen (facilitadores, activos, inactivos, edad promedio); el reporte de APEX con sus 10 columnas visibles (Nombre Completo, que abre la ficha, Nro CI, Nacionalidad, Fecha Nacimiento, Edad, Estado Civil, Con Quién Vive, Hijos, Teléfono, Observación), por nombre, orden y filtro por columna y **Excel**. Página 62 de APEX | `/consulta-facilitadores` | `facilitadores.sql` (sin SQL propio: usa `GET facilitadores`, que desde el 12/10/2026 trae esas columnas) |
| Reportes y Consultas | **Consulta de Instituciones**: de solo lectura (para editar está Instituciones). La faceta Estado (con cuántas; **sin estado cuenta como Inactiva**, como en APEX), el buscador y Restablecer; un resumen (instituciones, activas, inactivas, sin facilitador); el reporte de APEX con sus 8 columnas visibles (Institución, que abre la ficha, Departamento, Ciudad, Barrio, Dirección, Zona, Facilitador, Comentario), por nombre, orden y filtro por columna y **Excel**. Página 61 de APEX | `/consulta-instituciones` | `instituciones.sql` (sin SQL propio: usa `GET instituciones`, que desde el 12/10/2026 trae el comentario) |
| Reportes y Consultas | **Auditoría de Intervenciones**: la bitácora `INTERVENCIONES_JN`, quién insertó, modificó o borró cada intervención. Período con atajos (este mes de entrada), Usuario (con el nombre del facilitador) y Operación (Todos / Insertó / Actualizó / Borró, con cuántos), Limpiar Filtros, sin Consultar. El reporte con las 22 columnas de APEX en su orden, la operación en pastilla verde/azul/roja, los ids con su nombre, la **fecha de auditoría en hora de Paraguay** (APEX mostraba UTC), el mapa, la lupa, orden y filtro por columna y **Excel**. Página 58 de APEX | `/auditoria-intervenciones` | `auditoria_intervenciones.sql` |
| Reportes y Consultas | **Totales por Facilitador**: cuántas intervenciones hizo cada facilitador en cada institución en un período, y su total a razón del sueldo por intervención. Período con atajos, Facilitadores (con "Todos", que en APEX no andaba), Desarrollo Sí/No, Sueldo y Limpiar, sin Consultar; los tres totales con los colores de APEX; el reporte Facilitador / Institución / Cantidad / Total / Detalle (la 78, un diálogo con las marcaciones) con la suma al pie, orden y filtro por columna y **Excel**. Página 55 de APEX | `/totales-facilitador` | `intervenciones.sql` (`intervenciones/realizadas` por período) |
| Reportes y Consultas | **Resumen de Intervenciones**: lo que se le paga a cada facilitador. Período con atajos (Este mes, Mes anterior, semanas, otro), Institución, Facilitadores (recortados por la institución), Desarrollo Sí/No, **Sueldo por intervención** (30.000 de entrada) y Limpiar, sin botón Consultar. **Total Intervenciones** y **Total Salario** con los colores de APEX. El reporte: una intervención por clase y día (la regla de APEX), las horas en sus colores, Dif. Min. azul/rojo, las postulaciones de la clase, la lupa que las abre (la 54) y el Historial del día (la 56) como diálogos, el mapa, orden y filtro por columna y **Excel**. Página 53 de APEX | `/resumen-intervenciones` | `intervenciones.sql` (`intervenciones/resumen-periodo`) |
| Reportes y Consultas | **Intervenciones Realizadas**: lo más parecida a APEX. Filtros Año, Mes (pastillas con su cuenta; entra con el mes en curso), Fecha, Facilitador, Institución y ¿Desarrollo?, cada uno con cuántas quedan, buscador, los botones verdes **"Todos los meses"** y **"Todas las fechas"** y Restablecer. El reporte con las columnas de APEX en su orden: el lápiz que abre la intervención (`/intervenciones/$id`, la 51 de APEX), Hora en amarillo, Hora Desde en verde, Hora Hasta en naranja, **Dif. Min.** en rojo (llegó tarde), azul (antes) o gris, con su total al pie, el link al mapa, 50 filas por página con la paginación arriba, la lupa, orden y filtro por columna y **Excel**. Página 52 de APEX | `/consulta-intervenciones` | `intervenciones.sql` (`intervenciones/realizadas`) |
| Operaciones | **Intervenciones en el Mapa**: período con atajos (Hoy, Esta semana…), facilitador (con cuántas marcaciones tiene) e institución, sin botón "Ver"; resumen con las marcaciones **lejos** de la institución (más de 1 km del punto que se deduce de sus marcaciones); mapa grande (Leaflet + OpenStreetMap) con pines numerados por hora, el recorrido de cada día y cada institución; línea de tiempo por día que vuela el mapa a cada marcación. Página 25 de APEX | `/mapa-intervenciones` | `intervenciones.sql` |
| Núcleo de Datos | **Sucursales**: alta, modificación y baja (solo si nada la usa) | `/sucursales` | `sucursales.sql` |
| Operaciones | **Evaluaciones** de facilitadores, con su calificación y su cierre | `/evaluaciones` | `evaluaciones_facilitadores.sql` |
| Operaciones | **Intervenciones**: carga manual de las que quedaron sin registrar | `/intervenciones` | `intervenciones_crud.sql` |
| Operaciones | **Inventario de manuales**: conteo físico por manual y sucursal; al cerrar, actualiza las existencias. El conteo en curso se descarta y el último cierre se revierte | `/inventario` | `inventarios.sql` |
| Operaciones | **Transferencias de manuales**: envío entre sucursales (cabecera y detalle); al recibir, mueve las existencias. Una recibida se revierte (vuelve a pendiente) o se elimina, devolviendo las existencias | `/transferencias` | `transferencias.sql` |
| Reportes y Consultas | **Agendas**: el horario semanal, con **Excel** de todo lo filtrado (junta las páginas del backend) | `/agendas` | `agendas.sql` |
| Reportes y Consultas | **Consulta de inventarios**: dos vistas en pastillas (12/10/2026). **Último conteo** (la que abre, la página 76 de APEX): el último conteo de cada manual en cada sucursal, con las facetas Sucursal y Manual, buscador, Sucursal / Manual / Fecha / Cantidad Física con el total al pie, orden y filtro por columna y **Excel**; sin la columna Título de APEX, que repetía cada conteo una vez por índice del manual. **Historial**: los conteos pendientes y cerrados de un período por sucursal, gráfico comparativo entre inventarios, PDF con el logo y **Excel** | `/consulta-inventarios` | `inventarios.sql` (sin cambios: las dos vistas leen `inventarios/historial`) |
| Reportes y Consultas | **Monitoreo de Facilitadores**: las evaluaciones de los facilitadores ítem por ítem (una fila de `EVALUACIONES_FACILITADORES` por ítem). Año (el en curso de entrada, o "Todos los años"), las facetas Facilitador e Institución con cuántas filas, buscador y Restablecer; un resumen (filas, facilitadores, instituciones, sin cerrar); el reporte de APEX con sus 14 columnas (Nombre Apellido, que abre la evaluación, Institución, Ciudad, fechas, Evaluado Por, Área, Evaluación, Calificación y Escala Descripción de `ESCALAS_EVALUACIONES`, aspectos, Observación Admin, Cerrado), por fecha, 50 por página, orden y filtro por columna y **Excel**. Página 87 de APEX | `/monitoreo-facilitadores` | `evaluaciones_facilitadores.sql` y `escalas_evaluaciones.sql` (sin SQL propio) |
| Reportes y Consultas | **Historial de Inventarios de Manuales**: todos los conteos de cada sucursal (la página 77 de APEX), con las facetas Sucursal y Manual, buscador, Sucursal / Manual / Fecha / Cantidad Física con el total al pie, 50 por página, orden y filtro por columna y **Excel**; sin la columna Título de APEX (el mismo error que la 76). Es el mismo componente que el Último conteo de la 76 (`reporte-conteos.tsx`), en modo `todos`; un aviso lleva al Historial con gráfico y PDF de Consulta de inventarios | `/historial-inventarios` | `inventarios.sql` (sin cambios: `inventarios/historial`) |
| Reportes y Consultas | **Consulta de transferencias**: envíos entre sucursales por ruta y por manual, con el detalle de cada una, PDF y **Excel** (una fila por manual de cada transferencia) | `/consulta-transferencias` | `transferencias.sql` |
| Reportes y Consultas | **Consulta de postulaciones**: las activas de un año, combinables por ciudad, institución, facilitador y "¿tiene facilitador?" (cada opción dice cuántas quedan con los otros filtros), con buscador, Restablecer y la descarga para **Excel** (CSV con `;`). Arriba el resumen (postulaciones, instituciones, con y sin facilitador, con el % cubierto); abajo **el reporte de APEX** (a pedido, 12/10/2026): sus columnas en su orden, los manuales en sus colores, ordenado por turno y días, orden y filtro por columna, 50 filas por página y con la lupa. El nombre de la institución abre el modal 22 (el mismo de `/postulaciones`, en [`editor-postulacion.tsx`](src/components/editor-postulacion.tsx)). Página 24 de APEX | `/consulta-postulaciones` | `postulaciones.sql` (sin SQL propio: usa `postulaciones/todas`) |
| Reportes y Consultas | **Instituciones y Facilitadores**: qué facilitadores van a cada institución. Filtros Año (el actual de entrada, o "Todos los años") / Departamento / Ciudad / Barrio / Institución / Facilitador (con "Sin facilitador"), cada opción con cuántas instituciones quedan con los otros, buscador y Restablecer. Arriba un resumen; abajo **el reporte de APEX** (a pedido, 12/10/2026): los pares sin repetir institución + facilitador + año con sus seis columnas en el mismo orden, ordenado por institución y facilitador, orden y filtro por columna, 50 filas por página y **Excel**. Página 44 de APEX | `/consulta-instituciones-facilitadores` | `postulaciones.sql` (sin SQL propio: usa `postulaciones/todas`) |
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

### Reportes: siempre con Excel

**Desde el 12/10/2026, todo reporte que tenga un detalle lleva un botón Excel**, como el link
"Excel" de los reportes de APEX. Vale para los de hoy y para cada página nueva:

| Reporte | Dónde va el botón | Qué baja |
| --- | --- | --- |
| Consulta de postulaciones | cabecera | el reporte de la 24, con sus columnas |
| Instituciones y Facilitadores | cabecera | los pares institución + facilitador + año |
| Agendas | cabecera | todas las agendas de los filtros (junta las páginas del backend) |
| Consulta de inventarios | cabecera (en Historial, al lado del PDF) | Último conteo: una fila por sucursal y manual; Historial: un conteo por fila |
| Historial de Inventarios de Manuales | cabecera | todos los conteos filtrados, con la cantidad del sistema y el estado |
| Monitoreo de Facilitadores | cabecera | los ítems evaluados filtrados, con las 14 columnas del reporte |
| Consulta de transferencias | cabecera, al lado del PDF | un manual de cada transferencia por fila |
| Intervenciones Realizadas | cabecera | las marcaciones del período, con el link al mapa |
| Cantidad de Alumnos por Grado | cabecera | la suma por grado de cada institución + facilitador + año |
| Cantidad de Manuales | cabecera | la suma de cada manual por institución + facilitador + año |
| Resumen de Intervenciones | cabecera | las intervenciones que cuentan para el pago, con el link al mapa |
| Totales por Facilitador | cabecera | facilitador + institución con su cantidad y su total |
| Auditoría de Intervenciones | cabecera | los movimientos de la bitácora, con el link al mapa |
| Consulta de Instituciones | cabecera | las columnas del reporte y el estado |
| Consulta de Facilitadores | cabecera | las columnas del reporte y si está activo |
| Intervenciones no realizadas | cabecera | las no desarrolladas filtradas, con el motivo |

Las reglas, para no repetir lo que ya se resolvió:

- **Una sola pieza:** el botón es `<BotonExcel>`
  ([`boton-excel.tsx`](src/components/boton-excel.tsx)) y el archivo lo arma `descargarExcel`
  ([`src/lib/excel.ts`](src/lib/excel.ts)). La pantalla solo dice qué columnas lleva y qué filas.
  Ninguna pantalla arma su propio CSV.
- **Baja todo lo filtrado**, no solo la página ni lo que entra en pantalla. Si el reporte pagina
  en el backend, la pantalla junta las páginas antes, como `todasLasAgendas`
  ([`agendas.ts`](src/lib/agendas.ts)).
- **Las columnas del reporte, en su orden**, y con los títulos que se ven en pantalla. Si la
  pantalla agrupa (tarjetas por sucursal, por institución), el Excel va igual una fila por
  registro: es para filtrar y sumar en Excel.
- **Dónde va:** siempre en la cabecera, al lado del título, con borde y al lado del PDF si hay
  (el PDF sigue siendo el botón lleno). También en los reportes con el formato de APEX, aunque
  APEX lo ponía como link al pie (pedido el 12/10/2026).
- **Es un CSV con `;` y BOM**, no un `.xlsx`: Excel en español lo abre directo en columnas y con
  tildes, y no suma ninguna librería. Como los PDF, en el APK la descarga puede no andar.
- **Baja lo que se ve, en el orden en que se ve:** con el orden y los filtros por columna puestos
  (ver abajo). Las columnas del Excel salen de las mismas `ColumnaReporte` de la tabla.

### Reportes: orden y filtro por columna

**Desde el 12/10/2026, toda tabla de detalle de un reporte se ordena y se filtra por columna**,
como el menú de columna de los reportes de APEX. Tocar un encabezado abre su menú:

- **Ascendente / Descendente.** Tocar el orden que ya está lo saca y vuelve al orden del
  reporte. Los vacíos van al final en los dos sentidos (el `sort_null` L de APEX).
- **Los valores de la columna**, cada uno con cuántas filas tiene contando los otros filtros de
  columna (como las facetas), con buscador: se marcan los que se quieren ver y "Aplicar".

El encabezado ordenado lleva su flecha y el filtrado su embudo; sobre la tabla, chips con lo
puesto ("Orden: Fecha ↓", "Institución: X +2") que se quitan de a uno o con "Quitar todo".
Restablecer de la pantalla también los limpia.

| Reporte | Columnas |
| --- | --- |
| Consulta de postulaciones | las 34 del reporte de la 24 |
| Instituciones y Facilitadores | las 6 del reporte de la 44 |
| Intervenciones Realizadas | todas menos el lápiz y el mapa (el id ordena pero no filtra) |
| Cantidad de Alumnos por Grado | las 17 del reporte de la 49 (los grados ordenan como número) |
| Cantidad de Manuales | las 10 del reporte de la 50 (los manuales ordenan como número) |
| Resumen de Intervenciones | todas menos la lupa de postulaciones y el mapa; los totales y el salario cuentan lo que queda |
| Totales por Facilitador | las 4 del reporte (Detalle es un botón); los totales cuentan lo que queda |
| Auditoría de Intervenciones | las 21 de datos (ids y coordenadas ordenan pero no filtran) |
| Consulta de Instituciones | las 8 del reporte de la 61 |
| Consulta de Facilitadores | las 10 del reporte de la 62 (la edad ordena como número, la fecha como fecha) |
| Intervenciones no realizadas | las 10 del reporte de la 69 |
| Consulta de inventarios (Último conteo) | las 4 del reporte de la 76 |
| Historial de Inventarios de Manuales | las 4 del reporte de la 77 |
| Monitoreo de Facilitadores | las 14 del reporte de la 87 (las fechas ordenan como fecha) |

Las reglas:

- **Una sola pieza:** la lógica es `useTablaReporte` ([`tabla-reporte.ts`](src/lib/tabla-reporte.ts))
  y lo visual `<EncabezadoReporte>` y `<FiltrosColumnas>`
  ([`columna-reporte.tsx`](src/components/columna-reporte.tsx)). La pantalla describe sus
  columnas como `ColumnaReporte` —título, valor, y `orden` si el texto no ordena bien (una fecha
  `DD/MM/YYYY` va con `ordenFecha`, un número formateado con el número)— y pinta las celdas.
- **Va después de los filtros de la pantalla:** la pantalla decide qué filas llegan (año,
  facetas, buscador) y la tabla las ordena y las recorta por columna. La paginación, el resumen
  y el Excel salen de `tabla.visibles`.
- **El orden de entrada es el del reporte de APEX** (su `ORDER BY` o su
  `default_sort_column_sequence`): la pantalla ordena antes de pasar las filas.
- **`columnas` estable:** una constante del módulo, o un `useMemo` si dependen de algo que llega
  después (los nombres de los turnos en la 24).
- **Los links y los íconos** (el lápiz, el mapa) no son columnas de la tabla. Un id o un link se
  ordena pero no se filtra (`filtrable: false`).
- **Es un diálogo y no un desplegable**: la tabla se desplaza de costado dentro de su caja y un
  desplegable quedaría cortado; en el celular un diálogo se toca mejor.
- **Las tablas en tarjetas** (Agendas en el celular, Inventarios y Transferencias agrupados por
  sucursal o ruta) todavía no lo tienen: se suma a pedido.

### Reportes: marcos verticales en el detalle

**Desde el 12/10/2026, toda tabla de detalle de un reporte lleva marcos verticales entre
columnas**, además de las líneas entre filas: `border-r` en cada `<th>` y `<td>`, con
`last:border-r-0` en la última columna (la caja ya pone el borde de afuera), y también en la fila
de totales. Así se lee qué número es de qué columna en tablas anchas de números (grados,
manuales). Las planillas con lupa (24, 52 y las grillas de la ficha) ya los tenían.

### Reportes de pago: Resumen de Intervenciones (53) y Totales por Facilitador (55)

Comparten dos piezas: el período con atajos ([`selector-periodo.tsx`](src/components/selector-periodo.tsx),
con la lógica en [`periodos.ts`](src/lib/periodos.ts); también lo usa Auditoría de Intervenciones,
y cualquier reporte nuevo por fechas) y los tres totales con los colores de APEX
y el sueldo editable ([`totales-pago.tsx`](src/components/totales-pago.tsx), 30.000 de entrada).
Los dos consultan solos al cambiar un parámetro, sin el botón Consultar de APEX.

> **Cuentan distinto, como en APEX.** La 53 cuenta **una intervención por clase y día** sobre la
> tabla `INTERVENCIONES` (la última de la misma institución, facilitador, turno, manual e
> índice). La 55 cuenta **las marcaciones agrupadas** de `V_HISTORIAL_INTERVENCIONES`, como la 52.
> Para el mismo facilitador y período los totales pueden no coincidir: se copió la regla de cada
> página tal cual. Si se decide unificarla, es un cambio en `intervenciones.sql`.

### Reportes armados sobre `V_POSTULACIONES`

Instituciones y Facilitadores (44), Alumnos por Grado (49) y Cantidad de Manuales (50) agrupan
en el navegador lo que trae `postulaciones/todas`, con **`usePostulacionesPorAnio`**
([`postulaciones.ts`](src/lib/postulaciones.ts)): el año lectivo actual de entrada, uno elegido,
o "Todos los años" (pide uno por año), y las opciones del filtro Año ya armadas. Un reporte nuevo
sobre la misma vista usa ese hook en lugar de repetir las consultas.

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

**Las planillas con lupa** (09/10/2026): esa grilla y la de Postulaciones de Operaciones
([`postulaciones.index.tsx`](src/routes/postulaciones.index.tsx)) muestran todas las filas sin
barra propia (se baja con la página), con columnas compactas de ancho fijo (`table-fixed`) y una
lupa que achica columnas y letras juntas (CSS `zoom`; "Ajustar" la deja del ancho de la
pantalla). Si la planilla entra a lo ancho, el encabezado queda pegado bajo la cabecera de la
app; si no, solo se desplaza de costado. La lógica es una sola, en
[`src/lib/lupa.ts`](src/lib/lupa.ts) (`usePlanilla`, y las horas escritas a mano sin el reloj de
`<input type="time">`), y los botones en
[`lupa-planilla.tsx`](src/components/lupa-planilla.tsx). Las listas de la grilla son botones
hasta que se tocan: con un `<select>` por celda, Postulaciones tenía ~25.000 `<option>` y
tardaba 3 s en abrir.

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
