# Backend — Juventud con Valores (Oracle APEX / ORDS)

| Archivo | Qué trae | Orden |
| --- | --- | --- |
| **[`auth.sql`](auth.sql)** | Tokens, `PKG_AUTH_ETHOS`, módulo ORDS `ethos`, `auth/*` | 1º, obligatorio |
| **[`anios_lectivos.sql`](anios_lectivos.sql)** | `ANIOS_LECTIVOS` + `FN_ANIO_LECTIVO_ACTUAL()` | 2º |
| **[`evaluaciones_facilitadores.sql`](evaluaciones_facilitadores.sql)** | CRUD de `EVALUACIONES_FACILITADORES` + listas de valores de los combos y de la tarjeta de dirección (`PKG_EVAL_FACILITADORES_ETHOS`) | 3º |
| **[`intervenciones.sql`](intervenciones.sql)** | Puntualidad: atraso de los facilitadores sobre `V_HISTORIAL_INTERVENCIONES` (`PKG_INTERVENCIONES_ETHOS`) | independiente |
| **[`intervenciones_crud.sql`](intervenciones_crud.sql)** | Carga manual de intervenciones (`PKG_INTERV_CRUD_ETHOS`) | independiente |
| **[`agendas.sql`](agendas.sql)** | Horario semanal sobre `V_AGENDA` (`PKG_AGENDAS_ETHOS`) | independiente |
| **[`inventarios.sql`](inventarios.sql)** | Inventario de manuales por sucursal (`PKG_INVENTARIOS_ETHOS`) + corrige `INVENTARIOS_ACTUALIZAR_EXISTENCIAS` | independiente |
| **[`transferencias.sql`](transferencias.sql)** | Transferencias de manuales entre sucursales (`PKG_TRANSFERENCIAS_ETHOS`) | después de `inventarios.sql` |
| **[`sucursales.sql`](sucursales.sql)** | ABM de sucursales (`PKG_SUCURSALES_ETHOS`) + corrige `SUCURSALES_JNTRG` | independiente |
| **[`auditoria.sql`](auditoria.sql)** | Consulta de las bitácoras `_JN` (`PKG_AUDITORIA_ETHOS`) + `pr_crear_trigger_auditoria` | independiente |
| **[`menu_paginas.sql`](menu_paginas.sql)** | Tabla `MENU_PAGINAS`: el menú del sitio, con las páginas del menú de APEX (mismo número, ruta del sitio) y las pantallas nuevas | independiente |
| **[`roles_paginas.sql`](roles_paginas.sql)** | Menú del usuario, ABM de páginas y de permisos sobre `ROLES_PAGINAS` (`PKG_ROLES_PAGINAS_ETHOS`) | después de `menu_paginas.sql` |
| **[`usuarios.sql`](usuarios.sql)** | Usuarios del workspace: listado y activar / bloquear (`PKG_USUARIOS_ETHOS`, usa `PRC_TOGGLE_USUARIO`) | después de `roles_paginas.sql` |
| **[`paises.sql`](paises.sql)** | ABM de países (`PKG_PAISES_ETHOS`) | después de `roles_paginas.sql` |
| **[`nacionalidades.sql`](nacionalidades.sql)** | ABM de nacionalidades (`PKG_NACIONALIDADES_ETHOS`) | después de `roles_paginas.sql` |
| **[`facilitadores.sql`](facilitadores.sql)** | Facilitadores con su ficha completa y sus 4 listas (`PKG_FACILITADORES_ETHOS`) | después de `nacionalidades.sql`, `ciudades.sql` y `barrios.sql` |
| **[`departamentos.sql`](departamentos.sql)** | ABM de departamentos, cada uno de un país (`PKG_DEPARTAMENTOS_ETHOS`) | después de `paises.sql` |
| **[`ciudades.sql`](ciudades.sql)** | ABM de ciudades, cada una de un departamento; el país sale del departamento (`PKG_CIUDADES_ETHOS`) | después de `departamentos.sql` |
| **[`barrios.sql`](barrios.sql)** | ABM de barrios, cada uno de una ciudad; departamento y país salen de la ciudad (`PKG_BARRIOS_ETHOS`) | después de `ciudades.sql` |
| **[`directores.sql`](directores.sql)** | Directores: las personas (`PKG_DIRECTORES_ETHOS`) | después de `roles_paginas.sql` |
| **[`coordinadores.sql`](coordinadores.sql)** | Coordinadores: las personas (`PKG_COORDINADORES_ETHOS`) | después de `roles_paginas.sql` |
| **[`instituciones.sql`](instituciones.sql)** | Instituciones con su ficha (`PKG_INSTITUCIONES_ETHOS`) | después de `anios_lectivos.sql`, `ciudades.sql`, `barrios.sql` y `facilitadores.sql` |
| **[`instituciones_directores.sql`](instituciones_directores.sql)** | Quién dirige cada institución (`PKG_INST_DIRECTORES_ETHOS`) | después de `directores.sql` |
| **[`instituciones_coordinadores.sql`](instituciones_coordinadores.sql)** | Quién coordina en cada institución (`PKG_INST_COORDINADORES_ETHOS`) | después de `coordinadores.sql` |
| **[`horario_instituciones.sql`](horario_instituciones.sql)** | El horario de cada institución, por año (`PKG_HORARIO_INST_ETHOS`) | después de `anios_lectivos.sql` |
| **[`pre_horarios.sql`](pre_horarios.sql)** | Pre-horarios: la planificación del año; confirmarlos crea la postulación (`PKG_PRE_HORARIOS_ETHOS`) | después de `instituciones.sql` |
| **[`docentes.sql`](docentes.sql)** | ABM de docentes (`PKG_DOCENTES_ETHOS`) | después de `roles_paginas.sql` |
| **[`materias.sql`](materias.sql)** | ABM de materias (`PKG_MATERIAS_ETHOS`) | después de `roles_paginas.sql` |
| **[`enfasis.sql`](enfasis.sql)** | ABM de énfasis (`PKG_ENFASIS_ETHOS`) | después de `roles_paginas.sql` |
| **[`indices.sql`](indices.sql)** | ABM de los índices de los manuales (`PKG_INDICES_ETHOS`) | después de `roles_paginas.sql` |
| **[`postulaciones.sql`](postulaciones.sql)** | Postulaciones de una institución: la grilla de la 38 y el formulario PDF / imagen (`PKG_POSTULACIONES_ETHOS`) | después de `anios_lectivos.sql` |

Todos son idempotentes. Solo `auth.sql` define el módulo y habilita el esquema; los demás
agregan handlers al módulo `ethos` que creó él. Los "independiente" solo necesitan `auth.sql`.

> **`auth.sql` se puede volver a correr sin perder los demás endpoints** desde el 24/09/2026.
> Antes llamaba a `ORDS.DEFINE_MODULE` sin preguntar si el módulo existía, y sobre un
> módulo existente ORDS lo borra con todos sus templates: re-correrlo se llevaba puestos
> los endpoints de todos los otros scripts. Ahora lo define solo si no está.

**El orden importa entre el 2º y el 3º:** el paquete de evaluaciones llama a
`FN_ANIO_LECTIVO_ACTUAL()`. Si no existe, no compila.

> Los objetos y el prefijo ORDS se siguen llamando `ethos` aunque la marca haya cambiado a
> *Juventud con Valores* el 04/08/2026. Renombrarlos obliga a tocar la URL base, el `.env`,
> el workflow de deploy y el APK ya instalado: mucho riesgo para un cambio cosmético.

## `auth.sql`: qué contiene

| Sección | Objeto |
| --- | --- |
| 1 | Tabla `ETHOS_TOKENS` + índices `IX_ETHOS_TOKENS_ACT` / `_USR` |
| 2 | Job `JOB_PURGAR_ETHOS_TOKENS` (purga diaria, opcional) |
| 3 | Paquete `PKG_AUTH_ETHOS` — spec y body |
| 4 | Módulo ORDS `ethos` + handlers `auth/login`, `auth/logout`, `auth/me` (+ OPTIONS) |
| 5 | Verificación: imprime la URL base real y valida el workspace |

El script es **idempotente**: se puede volver a correr sin romper nada.

## Cómo correrlo

1. Entra a [oracleapex.com](https://oracleapex.com/) con el workspace **fundcarac**.
2. **SQL Workshop → SQL Scripts → Upload** → sube el script: `auth.sql` primero, después los
   demás en el orden de la tabla de arriba.
3. **Run**. Al terminar mira la salida: cada paso imprime `[OK]`, `[SKIP]`, `[WARN]` o
   `[ERROR]`, y el resumen tiene que decir **0 sentencias con errores**.
4. Solo con `auth.sql`: copia la **URL BASE** que imprime el bloque final. Es la que va en el
   frontend (`.env` y `deploy.yml`).

Tiene que correrlo el usuario **dueño del esquema** del workspace, no `SYS`.

**Si el front va a usar un endpoint nuevo, el script va antes del push**: el sitio se publica
apenas termina el workflow y, si el endpoint todavía no existe, esa pantalla falla.

**Recién corrido un script**, Oracle puede rechazar una vez la primera llamada de cada conexión
de ORDS que tenía cargada la versión anterior del paquete (`ORA-04068`). Si una pantalla falla
justo después de correrlo, salir y volver a entrar una vez antes de buscar otra causa.

## Los dos valores que quizá tengas que ajustar

**`c_workspace` en `PKG_AUTH_ETHOS`** (sección 3, primera línea del body).
Está en `'FUNDCARAC'`, deducido de la URL de tu app APEX. Si el nombre real del workspace
es otro, el bloque de verificación te lo dice con un `[ERROR]`. Para ver los válidos:

```sql
SELECT WORKSPACE_NAME FROM APEX_WORKSPACES;
```

**El base path de ORDS** (sección 4.1). Si el esquema **ya** estaba REST-enabled, el script
respeta el patrón que tenía y solo lo informa — re-habilitarlo cambiaría la URL de todo lo
demás que ya esté publicado. Para verlo:

```sql
SELECT PARSING_SCHEMA, PATTERN FROM USER_ORDS_SCHEMAS;
```

## Endpoints

Base: `https://oracleapex.com/ords/<pattern>/ethos/`

Esta tabla es la de `auth.sql` y `evaluaciones_facilitadores.sql`. Los de los demás scripts
están en la sección de cada uno, más abajo.

| Método | Ruta | Auth | Cuerpo / respuesta |
| --- | --- | --- | --- |
| POST | `auth/login` | — | `{usuario, password}` → `{success, data:{token, usuario, nombre, email, expira}}` |
| POST | `auth/logout` | Bearer | → `{success, message}` |
| GET | `auth/me` | Bearer | → `{success, data:{usuario, nombre, email, expira}}` o **401** |
| GET | `evaluaciones-facilitadores` | Bearer | filtros en query → `{success, total, pagina, limite, data:[...]}` |
| GET | `evaluaciones-facilitadores/:id` | Bearer | → `{success, data:{...}}` o **404** |
| POST | `evaluaciones-facilitadores` | Bearer | JSON plano → **201** `{success, id_evaluacion_facilitador}` |
| PUT | `evaluaciones-facilitadores/:id` | Bearer | JSON plano (registro completo, **sin** `ind_cerrado`) → `{success, message}`; **409** si está cerrada |
| DELETE | `evaluaciones-facilitadores/:id` | Bearer | → `{success, message}` o **409** si tiene dependencias o está cerrada |
| POST | `evaluaciones-facilitadores/cierre` | Bearer | `{ids: "12,13,14", ind_cerrado: "S"\|"N"}` → `{success, actualizadas}`. Cierra o reabre: **solo** `IND_CERRADO`, todas las filas en una transacción |
| GET | `listas/:nombre` | Bearer | combos → `{success, lista, limite, data:[...]}` |

Filtros de la lista (todos opcionales): `id_facilitador`, `id_institucion`,
`id_evaluacion`, `id_area`, `desde`, `hasta` (ISO `YYYY-MM-DD`), `buscar` (sobre
`evaluado_por`, nombre del facilitador y nombre de la institución), `limite`
(máx. 200, por defecto 50) y `pagina` (1-based). El listado ya trae resueltos
`facilitador`, `institucion`, `area`, `evaluacion` y `ciudad`, no solo los IDs.

Listas de valores (`limite` máx. 500, por defecto 100):

| `:nombre` | Parámetros | Devuelve |
| --- | --- | --- |
| `facilitadores` | `buscar` (nombre o CI), `activo`, `incluir_id`, `anio` | `id_facilitador`, `nombre_apellido`, `activo` |
| `instituciones` | `buscar`, `estado`, `incluir_id`, `id_facilitador`, `anio` | `id_institucion`, `nombre`, `estado`, `id_ciudad`, `ciudad` |
| `areas` | `buscar` | `id_area`, `descripcion` |
| `evaluaciones` | `id_area`, `buscar` | `id_evaluacion`, `id_area`, `descripcion` |
| `ciudades` | `buscar` | `id_ciudad`, `nombre` |
| `postulaciones` | **`id_facilitador` + `id_institucion` obligatorios**, `dia`, `anio` | `id_postulacion`, `grado`, `seccion`, `turno`, `docente`, `horario`… |
| `manuales` | `buscar` | `manual` (el texto es el id: no hay tabla de manuales) |
| `indices` | `manual`, `buscar` | `id_indice`, `nro_indice`, `titulo`, `manual` |
| `directores` | **`id_institucion` obligatorio**, `estado` | `id_periodo`, `periodo`, `id_director`, `nombre_apellido`, `cargo`, `nivel`, `turno`, `estado`, `nro_telefono` |
| `indice-siguiente` | **`id_postulacion` obligatorio** | **Un objeto, no un array**: `estado`, `manual`, `nro_ultimo`, `id_indice`, `nro_indice`, `titulo` |

### `indice-siguiente`: el índice se deduce, no se elige

Alimenta el campo de solo lectura del formulario. La regla, en dos pasos:

1. El último índice con `SI_NO = 'Si'` en las `INTERVENCIONES` de **esa
   postulación** — el último efectivamente desarrollado.
2. El inmediato siguiente **dentro del mismo manual**.

Tres decisiones que están en el código y conviene no revertir sin pensarlas:

- **Solo cuentan los `'Si'`.** Un índice marcado `'No'` no se desarrolló (por eso
  `TRG_INTERV_SINO_MOTIVO` le exige `MOTIVO_DESARROLLO`) y sigue pendiente:
  contarlo lo saltearía para siempre. Es el mismo criterio de
  `TRG_INTERV_FINALIZA_POST`, que exige `'Si'` para finalizar la postulación.
- **Se calcula por postulación, no por facilitador.** El manual avanza clase a
  clase; un facilitador con 7mo y 8vo en el mismo colegio lleva dos avances
  distintos y cruzarlos haría que una clase empuje a la otra.
- **El siguiente es "el menor mayor al último", no `último + 1`.** Los
  `NRO_INDICE` pueden tener huecos.

El campo `estado` distingue los tres casos:

| `estado` | Qué significa |
| --- | --- |
| `PENDIENTE` | Hay siguiente índice; `id_indice`, `nro_indice` y `titulo` vienen cargados |
| `SIN_INICIAR` | Esa postulación no tiene ninguna intervención con `'Si'`. **No se asume el índice 1**: sin intervenciones tampoco se sabe el manual |
| `FINALIZADO` | El último desarrollado ya era el más alto del manual |

El orden es por `NRO_INDICE` y **no** por `FECHA_HORA`: si las intervenciones se
cargaron fuera de orden, lo que manda es el orden del manual, no el de tipeo.

### `directores`: informativa, y devuelve varias filas

Alimenta la tarjeta que el formulario muestra al elegir institución, para que el
evaluador sepa con quién hablar al llegar. **No se guarda nada de esto en la
evaluación**: no hay `ID_DIRECTOR` en `EVALUACIONES_FACILITADORES` ni viaja en el
POST/PUT. Se lee fresco siempre, así que un cambio de director se refleja solo.

**Devuelve todas las filas activas, no una.** `INSTITUCIONES_DIRECTORES` tiene una
fila por `PERIODO` + `NIVEL` + `TURNO`, así que una institución puede tener a la
vez un director de la mañana en Escolar Básica y otro de la tarde en Media, los
dos con `ESTADO = 'A'`. Quedarse con uno escondía al que sí correspondía.

Dos cosas que conviene saber antes de tocarla:

- **No filtra por `PERIODO`.** Es un `VARCHAR2(50)` sin dominio: no es el año
  lectivo, no tiene FK a `ANIOS_LECTIVOS` y no hay forma segura de decir cuál es
  "el actual". El `ESTADO` es lo único confiable, y por eso es el filtro. El
  período viaja igual, para mostrarlo. Por defecto `'A'`; `?estado=TODOS` trae el
  histórico.
- **`TURNO` acá es texto libre**, no el `NUMBER` 1/2/3 de `POSTULACIONES.TURNO`.
  Dos dominios distintos con el mismo nombre: no se pueden cruzar ni traducir con
  la misma tabla.

El teléfono sale de `INSTITUCIONES_DIRECTORES.NRO_TELEFONO` —el de esa persona en
esa institución— y cae al de `DIRECTORES` cuando no está cargado.

## Menú y permisos (`menu_paginas.sql` + `roles_paginas.sql`)

Decidido el 08/10/2026. El menú del sitio sale de la base, salvo tres partes fijas.

| Parte del menú | De dónde sale | Quién la ve |
| --- | --- | --- |
| Inicio, Mi cuenta | fijas, en el código del sitio | cualquiera con sesión |
| **Roles de páginas**, dentro de Administrador | ítem en el código; permiso en `ROLES_PAGINAS` (página 2) | quien tenga la 2 con `PUEDE_CONSULTAR = 'S'` |
| **Crear páginas**, dentro de Administrador | fija: código del sitio + función `administra` del paquete | **solo JOSEG** |
| El resto | tabla `MENU_PAGINAS` | quien tenga `PUEDE_CONSULTAR = 'S'` en `ROLES_PAGINAS` |

### Las dos tablas

| Tabla | Qué tiene |
| --- | --- |
| `ROLES_PAGINAS` | Los permisos. **La misma tabla que usa APEX**, con `APP_ID` siempre `40587`. No se toca su estructura ni su trigger |
| `MENU_PAGINAS` | El menú del sitio: `APP_PAGE_ID` (PK), `MENU_PRINCIPAL`, `NOMBRE_PAGINA`, `RUTA` (única). Sin `ID_AUDITORIA` ni bitácora, a pedido. Comentada en la base, tabla y columnas |

- **Una pantalla del sitio es una página como las de APEX:** el mismo `APP_PAGE_ID` en las dos
  tablas.
- **El número de una página nueva es el último `APP_PAGE_ID` de `MENU_PAGINAS` más 1** y **no
  cambia nunca**. Lo calcula el alta (`POST menu-paginas`, función `siguiente_pagina`), nadie
  lo escribe a mano. Hasta el 08/10/2026 era el mayor entre `ROLES_PAGINAS`, `MENU_PAGINAS` y
  las páginas de APEX; se pasó a mirar solo el menú.
- **Única excepción:** si ese número ya tiene filas en `ROLES_PAGINAS` —una página de APEX que
  no está en el menú, por ejemplo una que se agregue después en el builder—, se saltea al
  siguiente libre. Si no, la página nueva nacería con los permisos de otra pantalla.
- **El orden del menú es el de los números:** los menús principales en el orden de su primera
  página y, dentro de cada uno, por número. No hay columna de orden ni de ícono: el ícono y la
  descripción de cada pantalla están en el código (`PANTALLAS`, en `src/lib/navegacion.ts`).
- **`RUTA` es la pantalla del sitio** (`/evaluaciones`) y tiene que existir en `src/routes/`.
  Una ruta que el sitio no tiene se deja guardar, pero el menú lleva a "no encontrado".
- **El alta guarda la página SOLO en `MENU_PAGINAS`: no crea permisos**, ni para quien la da
  de alta. Los da después el administrador en Roles de páginas; hasta entonces la página no
  le aparece a nadie en el menú (08/10/2026; antes el alta le daba todo en `'S'` a quien
  la creaba). El sitio, al crearla, ofrece un botón **Dar permisos** que lleva a esa pantalla.
- **Una página con permisos cargados no se puede borrar** (409): primero se le quitan.

`menu_paginas.sql` crea la tabla y carga **las páginas del menú de APEX con su mismo
número**: 44, todas menos la 1 (Inicio, fija en el sitio). Cada una lleva ya **la ruta que va
a tener en el sitio** (`/paises`, `/consulta-postulaciones`…: minúsculas, sin acentos, con
guiones, y `consulta-` cuando el mismo nombre está en dos menús). Así los permisos que ya
tienen en `ROLES_PAGINAS` valen apenas se programa la pantalla.

**Los 18 modales de APEX no van** (3, 5, 7, 9, 11, 13, 15, 18, 19, 21, 22, 27, 29, 32, 33, 35,
37, 42): en el sitio son parte de la pantalla de su listado y usan los permisos de esa. Sus
filas de `ROLES_PAGINAS` quedan, porque APEX las usa. Por eso `ROLES_PAGINAS` tiene 61
páginas distintas y `MENU_PAGINAS` menos.

Las pantallas que el sitio ya tenía y que reemplazan una de APEX **usan el número de APEX**:
Sucursales 72, Agendas 30, Inventario 74, Consulta de inventarios 76. Las que no existían en
APEX (Evaluaciones, Intervenciones, Transferencias, Consulta de transferencias, Auditoría)
llevan el último número más 1, y el script se las da con todo en `'S'` a JOSEG, EDGARO y
VALENTINAS (08/10/2026). A los demás, desde Roles de páginas.

Mientras una pantalla no esté programada, su ruta lleva a "no encontrado" (en Crear páginas
sale como "ruta desconocida"). Antes de esta tabla
se usaron por unas horas números "virtuales" 1000–1009; se borraron de `ROLES_PAGINAS` el
08/10/2026, y el script, si encuentra alguno, lo pasa al número definitivo.

### Las dos pantallas de administración

| Pantalla | Ruta | Qué administra | Endpoints | Quién | En `MENU_PAGINAS` |
| --- | --- | --- | --- | --- | --- |
| Roles de páginas | `/permisos` | los permisos de cada usuario (`ROLES_PAGINAS`) | `roles-paginas/*` | quien tenga la página 2 en `ROLES_PAGINAS` | sí, como la página 2 de APEX (Roles de Usuarios) |
| Crear páginas | `/paginas` | las páginas del menú (`MENU_PAGINAS`) | `menu-paginas/*` | solo JOSEG, fijo (`administra`) | no (no existe en APEX) |

- **Roles de páginas sale de `ROLES_PAGINAS`, como en APEX** (desde el 08/10/2026; antes era
  fija para JOSEG y EDGARO). Cada endpoint pide su acción sobre la página de `/permisos`:
  consultar para leer, insertar para agregar y copiar, actualizar para modificar, borrar para
  quitar (`exigir` → `puede_permisos`). Sus modales de APEX, 3 y 19, usan esos mismos permisos.
- **Si nadie tiene la 2 habilitada, nadie puede dar permisos desde el sitio.** El script lista
  al final quién la tiene y avisa con `[WARN]` si no hay nadie: se arregla en APEX, página 2.
- **Crear páginas sigue fija**: está escrita en `PKG_ROLES_PAGINAS_ETHOS.administra`. Cambiar
  quién la usa es cambiar esa función y volver a correr el script.
- `GET menu` devuelve `admin_permisos` (por `ROLES_PAGINAS`) y `admin_paginas` (por
  `administra`). El sitio arma las dos al principio del menú principal **Administrador** (hasta
  el 08/10/2026 iban en un grupo propio, "Administración"). La página 2 no se repite en el menú
  con el nombre de APEX.
- Sin permiso, los endpoints responden **403**, y las pantallas, "Sin acceso".
- **Las filas de `ROLES_PAGINAS` de la página 2 no se borran**: son las mismas que usa APEX.
  Una versión anterior de `roles_paginas.sql` (del mismo 08/10/2026) las borraba: se sacó antes
  de usarse con la página 2 cargada.

### Endpoints (`roles_paginas.sql`)

| Método | Ruta | Exige | Qué hace |
| --- | --- | --- | --- |
| GET | `menu` | sesión | Todas las páginas de `MENU_PAGINAS` con los permisos del usuario, más `admin_permisos` y `admin_paginas`. Todas, para que el sitio sepa qué rutas cerrar |
| GET | `menu-paginas` | Crear páginas | Las páginas, con cuántos permisos tiene cada una |
| POST | `menu-paginas` | Crear páginas | `{menu_principal, nombre_pagina, ruta}` → `{pagina}`. El número lo pone el backend: el último del menú más 1. **No crea permisos** |
| PUT | `menu-paginas/:id` | Crear páginas | Las mismas tres. El número no cambia |
| DELETE | `menu-paginas/:id` | Crear páginas | **409** si la página tiene permisos cargados |
| GET | `roles-paginas?usuario=X` | Roles de páginas | Todas las filas de la app 40587, o las de un usuario |
| GET | `roles-paginas/usuarios` | Roles de páginas | Usuarios del workspace + los que tienen filas, con cuántas páginas. Sin la cuenta dueña (`FUNDACIONCARACTER2024@GMAIL.COM`), como en APEX, salvo que tenga filas |
| GET | `roles-paginas/paginas` | Roles de páginas | Nombre de cada página: las de `MENU_PAGINAS` (`origen: app`) y las de APEX (`apex`). De APEX, sin la 0, la 1 ni la 9999 en adelante, como el LOV de la página 3 |
| POST | `roles-paginas` | Roles de páginas | `{usuario, pagina, insertar, actualizar, borrar, consultar, ver_campos}`; **409** si ya existe |
| PUT | `roles-paginas/:usuario/:pagina` | Roles de páginas | Las cinco banderas; `ESTADISTICA_USER` no se toca |
| DELETE | `roles-paginas/:usuario/:pagina` | Roles de páginas | Quita la fila |
| POST | `roles-paginas/copiar` | Roles de páginas | `{desde, hacia}` → `{copiadas}`. Le da a `hacia` las páginas de `desde` que todavía no tiene, con las mismas banderas; las que ya tiene no se tocan. Todo o nada |

Las banderas van y vuelven como `'S'`/`'N'`. Sin fila no hay acceso, y `'N'` o `NULL` es "no".

**Las páginas 3 (Crear Rol) y 19 (Copiar Roles) de APEX no son páginas en el sitio.** Allá son
modales de la 2; acá son diálogos de Roles de páginas (`/permisos`) y los usa quien puede usar
esa pantalla. No tienen ruta, ni fila en `MENU_PAGINAS`, ni se controlan aparte. Sus filas de
`ROLES_PAGINAS` quedan porque APEX las sigue usando.

### El menú no es la seguridad

Ocultar un módulo del menú no impide llamar a su endpoint con el token. **Hoy solo los
endpoints de este script, los de `usuarios.sql` y los de escritura de `paises.sql`, `nacionalidades.sql`, `facilitadores.sql`, `departamentos.sql`, `ciudades.sql`, `barrios.sql`, `docentes.sql`, `materias.sql`, `enfasis.sql` e `indices.sql` controlan
permisos; los de los demás módulos solo piden sesión.** Para cerrar un módulo de verdad, su paquete tiene que preguntar antes de
hacer nada (ver *Agregar un endpoint de negocio*; `usuarios.sql` es el ejemplo: busca su
página con `pagina_de_ruta('/usuarios')` y pregunta `puede(...)`).

## Países (`paises.sql`)

Reemplaza a la página 4 de APEX (Países, un IG sobre `PAISES`) y a su modal 5 (Crear País), que
en el sitio es el diálogo de `/paises`, con los permisos de la 4. Paquete `PKG_PAISES_ETHOS`.

**Un script por tabla** (decidido el 08/10/2026): se probó un paquete genérico para todos los
catálogos de un nombre y se descartó porque confundía. Lo que sí se comparte es la PANTALLA:
`<CatalogoNombre>` (`src/components/catalogo-nombre.tsx`) sirve para cualquier tabla (ID,
NOMBRE), y cada una le pasa sus funciones desde su `lib/` (`lib/paises.ts`).

| Método | Ruta | Exige | Qué hace |
| --- | --- | --- | --- |
| GET | `paises` | sesión | Todos por nombre, cada uno con `usos` (tabla y cantidad), más `tablas` y `largo` (200) |
| POST | `paises` | insertar en la página de `/paises` | `{nombre}` → `{id_pais}` |
| PUT | `paises/:id` | actualizar | `{nombre}` |
| DELETE | `paises/:id` | borrar | **409** si algo lo usa |

- **El GET pide solo sesión** a propósito: los combos de otras pantallas (el país de un
  departamento, por ejemplo) necesitan la lista aunque el usuario no administre países.
- **"En uso" lo dice la base**: el listado busca en `USER_CONSTRAINTS` las FK de una columna que
  apuntan a `PAISES` (salvo las `_JN`) y cuenta cuántas filas usan cada país. Es el único SQL
  dinámico del paquete, con los nombres del diccionario entre comillas. Una tabla que guarde
  `ID_PAIS` **sin FK** no se detecta.
- **Repetidos**: se rechaza un nombre igual sin distinguir mayúsculas (409). La pantalla avisa
  antes, y además sin distinguir tildes.
- **El id nuevo** lo pone la tabla (identity o trigger), como en APEX. Si no lo pone
  (ORA-01400 en `ID_PAIS`), cae al mayor más 1 con la tabla bloqueada.
- La verificación previa lista los triggers de `PAISES`: uno de bitácora escrito a mano puede
  tener el `ORA-04084` en DELETE que tenía `SUCURSALES_JNTRG`. Si pasa, el error lo dice.

## Nacionalidades (`nacionalidades.sql`)

Reemplaza a la página 12 de APEX (Nacionalidades, IG sobre `NACIONALIDADES`) y a su modal 13
(Crear Nacionalidad), que en el sitio es el diálogo de `/nacionalidades`, con los permisos de
la 12. Paquete `PKG_NACIONALIDADES_ETHOS`. La tabla, según APEX: `ID_NACIONALIDAD` (PK) y
`DESCRIPCION` (obligatoria, 200).

| Método | Ruta | Exige | Qué hace |
| --- | --- | --- | --- |
| GET | `nacionalidades` | sesión | Todas por descripción, con `usos`, `tablas` y `largo` |
| POST | `nacionalidades` | insertar en la página de `/nacionalidades` | `{descripcion}` → `{id_nacionalidad}` |
| PUT | `nacionalidades/:id` | actualizar | `{descripcion}` |
| DELETE | `nacionalidades/:id` | borrar | **409** si algo la usa |

Todo lo demás, igual que `paises.sql`. La pantalla es `<CatalogoNombre>` sin padre, como
Países.

## Materias y Énfasis (`materias.sql`, `enfasis.sql`)

Reemplazan a las páginas 17 (Materias) y 26 (Enfasis) de APEX y a sus modales 18 y 27, que en
el sitio son el diálogo de `/materias` y `/enfasis`. Paquetes `PKG_MATERIAS_ETHOS` y
`PKG_ENFASIS_ETHOS`. Son copias de `nacionalidades.sql` (mismos endpoints, `{descripcion}` →
`{id_materia}` / `{id_enfasis}`), con dos diferencias:

- **El largo**: `MATERIAS.DESCRIPCION` llega a 200 y `ENFASIS.DESCRIPCION` a 500.
- **Los usos cuentan `PRE_HORARIOS` y `POSTULACIONES` aunque no tengan FK** (se sabe que
  guardan `ID_MATERIA` e `ID_ENFASIS`), y el `DELETE` frena por ellos con **409**: sin FK,
  borrar los dejaría apuntando a nada.

La pantalla es `<CatalogoNombre>`; al guardar refresca también `pre-horarios/opciones` (la
lista de Pre-horarios y Postulaciones), con `relacionadas` de `ApiCatalogo`.

## Docentes (`docentes.sql`)

Reemplaza a la página 41 de APEX (Docentes, IG sobre `DOCENTES`) y a su modal 42 (Crear
Docente), que en el sitio es el diálogo de `/docentes`, con los permisos de la 41. Paquete
`PKG_DOCENTES_ETHOS`. La tabla: `ID_DOCENTE` (identity), `NOMBRE_APELLIDO` (obligatorio, 500),
`NRO_CI` y `NRO_TELEFONO` (100) y `ACTIVO` (obligatorio, SI / NO; la 42 proponía SI).

| Método | Ruta | Exige | Qué hace |
| --- | --- | --- | --- |
| GET | `docentes` | sesión | Todos por nombre, con `es_activo` (S / N: `ACTIVO` empieza con S), `usos` y `tablas` |
| POST | `docentes` | insertar en la página de `/docentes` | `{nombre_apellido, nro_ci, nro_telefono, activo}` → `{id_docente}` |
| PUT | `docentes/:id` | actualizar | Lo mismo |
| DELETE | `docentes/:id` | borrar | **409** si lo usa un pre-horario o una postulación (con o sin FK) |

- **Un docente en uso no se borra: se marca inactivo.** Deja de ofrecerse en las listas, pero
  lo cargado queda.
- **La CI repetida no se rechaza** (APEX no lo hacía y puede haber datos viejos así): la
  pantalla avisa antes de guardar, igual que con un nombre repetido.
- El teléfono del docente es el que Pre-horarios propone al elegirlo (la acción dinámica de
  la 43). Guardar refresca también `pre-horarios/opciones`.

## Índices (`indices.sql`)

Reemplaza a la página 28 de APEX (Índices, IG de solo lectura sobre `INDICES_MANUALES`) y a su
modal 29 (Crear Índice), que en el sitio es el diálogo de `/indices`, con los permisos de la 28.
Paquete `PKG_INDICES_ETHOS`. La tabla: `ID_INDICE` (identity), `MANUAL` (obligatorio, 100),
`NRO_INDICE` (obligatorio, número) y `TITULO` (obligatorio, 500).

| Método | Ruta | Exige | Qué hace |
| --- | --- | --- | --- |
| GET | `indices` | sesión | Todos por manual y número, con `usos` y `tablas` |
| POST | `indices` | insertar en la página de `/indices` | `{manual, nro_indice, titulo}` → `{id_indice, manual}` |
| PUT | `indices/:id` | actualizar | Lo mismo |
| DELETE | `indices/:id` | borrar | **409** si lo usa una intervención o una evaluación (con o sin FK) |

- **No hay tabla de manuales**: el `DISTINCT` de `MANUAL` es el catálogo de evaluaciones,
  intervenciones, inventario y transferencias. Un manual escrito con otras mayúsculas o
  espacios se guarda con la grafía del que ya existe (y `manual` vuelve con la que quedó).
- **El número no se repite dentro del manual (409)**, cosa que APEX no controlaba: el índice
  siguiente de evaluaciones y el último que finaliza una postulación ordenan por `NRO_INDICE`.
  Los repetidos que ya hubiera se pueden seguir editando mientras no cambien de manual ni de
  número; la verificación del script los lista.
- **Un índice en uso no cambia de manual (409)**: `INTERVENCIONES.MANUAL` guarda el del índice
  y `TRG_INTERV_FINALIZA_POST` los compara. El título y el número sí se corrigen.
- `NRO_INDICE` acepta decimales (un 3,5 para meter uno entre el 3 y el 4), con punto o coma.
- Guardar refresca también los combos Manual → Índice, el índice siguiente y las planillas de
  Inventario y Transferencias.

## Facilitadores (`facilitadores.sql`)

Reemplaza a la página 14 de APEX (el listado), a su modal 15 (la ficha) y a los modales 63 a 66
(Nominado por, Referencias personales, Niveles académicos, Situación laboral). En el sitio: el
listado es `/facilitadores`, la ficha es la pantalla `/facilitadores/$id` (`nuevo` para el
alta) y **las cuatro listas son secciones de la ficha**, que se guardan con ella en una sola
transacción. Todo con los permisos de la 14. Paquete `PKG_FACILITADORES_ETHOS`.

| Método | Ruta | Exige | Qué hace |
| --- | --- | --- | --- |
| GET | `facilitadores` | sesión | El listado: nombre, CI, teléfono, usuario, `es_activo`, ciudad, barrio, nacionalidad, `usos` |
| GET | `facilitadores/opciones` | sesión | Los valores de las listas de APEX: `si_no`, `estado_civil`, `con_quien_vive`, `nivel_academico`, `tipo_factura` |
| GET | `facilitadores/:id` | sesión | La ficha completa, con `nominados`, `referencias`, `estudios`, `laborales` y `usos` |
| POST | `facilitadores` | insertar en la página de `/facilitadores` | `{datos}` → `{id_facilitador}` |
| PUT | `facilitadores/:id` | actualizar | `{datos}` |
| DELETE | `facilitadores/:id` | borrar | **409** si algo lo usa; sus cuatro listas se borran con él |

- **La ficha viaja entera en un solo campo, `datos`, con el JSON como texto**: son ~45 campos y
  4 listas, y ORDS bindea solo campos escalares. El paquete lo lee con `APEX_JSON`.
- **Las listas**: las filas con id se actualizan, las sin id se insertan y las que ya no vienen se
  borran. En APEX eran modales que solo andaban con el facilitador ya guardado.
- **Ubicación**: se elige la ciudad y, si se quiere, un barrio de esa ciudad; departamento y
  país salen de la ciudad, como en `ciudades.sql` y `barrios.sql`.
- **Las listas de valores salen de APEX** (`APEX_APPLICATION_LOV_ENTRIES`); si una es dinámica,
  caen a los valores ya cargados en la tabla. "Activo" en el listado: `ACTIVO` empieza con S.
- **La columna `DENOMINACIÓN` tiene tilde**: se busca en `USER_TAB_COLUMNS` y se lee y escribe
  con SQL dinámico, porque un identificador con tilde en el archivo puede romperse al subirlo.
- **CI repetida**: se rechaza en un alta o al cambiarle la CI a uno.
- **`UNISTR` devuelve NVARCHAR2**: unirlo con un texto común en un `UNION` da ORA-12704; va con
  `TO_CHAR` (pasó con "Físico" en `tipo_factura`, 08/10/2026).

## Departamentos (`departamentos.sql`)

Reemplaza a la página 6 de APEX (Departamentos, IG sobre `DEPARTAMENTOS`) y a su modal 7 (Crear
Departamento), que en el sitio es el diálogo de `/departamentos`, con los permisos de la 6.
Paquete `PKG_DEPARTAMENTOS_ETHOS`. La tabla, según APEX: `ID_DEPARTAMENTO` (PK), `ID_PAIS`
(obligatorio) y `NOMBRE` (obligatorio, 200).

| Método | Ruta | Exige | Qué hace |
| --- | --- | --- | --- |
| GET | `departamentos` | sesión | Todos por país y nombre, con `id_pais`, `pais`, `usos`, `tablas` y `largo` |
| POST | `departamentos` | insertar en la página de `/departamentos` | `{id_pais, nombre}` → `{id_departamento}` |
| PUT | `departamentos/:id` | actualizar | `{id_pais, nombre}` |
| DELETE | `departamentos/:id` | borrar | **409** si algo lo usa |

Todo lo demás, como `paises.sql`: "en uso" por las FK, el id nuevo por identity o trigger con
la caída al mayor más 1, y la lista de triggers en la verificación. Dos diferencias:

- **El repetido se mide dentro del mismo país**: dos países pueden tener un departamento con el
  mismo nombre.
- **El país se valida antes de guardar** (400 si no existe). El listado hace LEFT JOIN con
  `PAISES`: un departamento con un `ID_PAIS` que ya no existe sale como "Sin país" en vez de
  perderse.

La pantalla es `<CatalogoNombre>` con el país como `padre`: filtro por país en pastillas, la
lista agrupada por país y el país elegido en el diálogo (arranca en el del filtro o en el que
más departamentos tiene). El selector lee `GET paises`, por eso conviene correr `paises.sql`
antes.

## Ciudades (`ciudades.sql`)

Reemplaza a la página 8 de APEX (Ciudades, IG sobre `CIUDADES`) y a su modal 9 (Crear Ciudad),
que en el sitio es el diálogo de `/ciudades`, con los permisos de la 8. Paquete
`PKG_CIUDADES_ETHOS`. La tabla, según APEX: `ID_CIUDAD` (PK), `ID_PAIS` y `ID_DEPARTAMENTO`
(obligatorios) y `NOMBRE` (obligatorio, 200).

| Método | Ruta | Exige | Qué hace |
| --- | --- | --- | --- |
| GET | `ciudades` | sesión | Todas por departamento y nombre, con `id_departamento`, `departamento`, `id_pais`, `pais`, `usos`, `tablas` y `largo` |
| POST | `ciudades` | insertar en la página de `/ciudades` | `{id_departamento, nombre}` → `{id_ciudad}` |
| PUT | `ciudades/:id` | actualizar | `{id_departamento, nombre}` |
| DELETE | `ciudades/:id` | borrar | **409** si algo la usa |

- **El país sale del departamento** (distinto de APEX). En APEX se elegían país y departamento
  por separado, sin cascada, y se podía guardar una ciudad de un país en un departamento de
  otro. Acá se elige solo el departamento y `ID_PAIS` se copia de él al guardar: la columna
  sigue llena para quien la lea, pero ya no puede contradecir al departamento. El listado
  devuelve el país **del departamento**.
- **La verificación previa cuenta las ciudades que hoy tienen otro país** que su departamento,
  y si hay, imprime el `UPDATE` que las alinea. No lo corre sola.
- **El repetido se mide dentro del mismo departamento**: hay ciudades homónimas en
  departamentos distintos.
- Lo demás, como `departamentos.sql`: "en uso" por las FK, id nuevo por identity o trigger.

La pantalla es `<CatalogoNombre>` con el departamento como `padre`. En el selector de
departamento, debajo de cada uno va su país, pero solo si hay más de un país cargado.

## Barrios (`barrios.sql`)

Reemplaza a la página 10 de APEX (Barrios, IG sobre `BARRIOS`) y a su modal 11 (Crear Barrio),
que en el sitio es el diálogo de `/barrios`, con los permisos de la 10. Paquete
`PKG_BARRIOS_ETHOS`. La tabla, según APEX: `ID_BARRIO` (PK), `ID_PAIS`, `ID_DEPARTAMENTO` e
`ID_CIUDAD` (obligatorios) y `NOMBRE` (obligatorio, 200).

| Método | Ruta | Exige | Qué hace |
| --- | --- | --- | --- |
| GET | `barrios` | sesión | Todos por ciudad y nombre, con ciudad, departamento y país (los de la ciudad), `usos`, `tablas` y `largo` |
| POST | `barrios` | insertar en la página de `/barrios` | `{id_ciudad, nombre}` → `{id_barrio}` |
| PUT | `barrios/:id` | actualizar | `{id_ciudad, nombre}` |
| DELETE | `barrios/:id` | borrar | **409** si algo lo usa |

- **Departamento y país salen de la ciudad** (distinto de APEX, igual que en Ciudades). Se
  elige solo la ciudad; al guardar, `ID_DEPARTAMENTO` es el de la ciudad e `ID_PAIS` el **de
  ese departamento** (no `CIUDADES.ID_PAIS`, que en datos viejos puede no coincidir).
- **La verificación previa cuenta los barrios desalineados** con su ciudad e imprime el
  `UPDATE` que los corrige. No lo corre sola.
- **El repetido se mide dentro de la misma ciudad.**
- Lo demás, como `ciudades.sql`.

La pantalla es `<CatalogoNombre>` con la ciudad como `padre`. En el selector de ciudad,
debajo de cada una va su departamento (hay más de uno), lo que separa las ciudades homónimas.

## Instituciones (`instituciones.sql` y siete más)

Reemplaza a la página 16 de APEX (el listado) y a todo lo que colgaba de su modal 21 (Crear
Institución): los IG de Directores y Coordinadores, los modales 35 (Crear Director) y 46 (Crear
Coordinador), el 33 (Horarios, botón "Horario IE"), el 43 (Pre Horarios, botón "Pre
Postulación"), el 38 (Datos, botón "Postulaciones") y la página 60 (Consulta de Postulaciones,
con su PDF e imagen). En el sitio: el listado es `/instituciones` y la ficha es
`/instituciones/$id` (`nueva` para el alta), con cinco pestañas —Datos, Autoridades, Horario,
Pre-horarios y Postulaciones—, todo con los permisos de la 16.

**Un script por tabla** (09/10/2026). Las de autoridades, horario y postulaciones tienen además
su propia página en APEX (36, 47, 31, 20 y 24), y las personas la suya (34 y 45): cuando se
pasen, usan estos mismos backends. **La 31 (Horarios de Instituciones, `/horarios-instituciones`)
ya está** (09/10/2026): usa `GET horario-instituciones` sin `id_institucion` (todas) y el
listado de `instituciones`, sin cambios en el backend. **La 34 (Directores, `/directores`)
también**: usa `directores` y `GET instituciones-directores` sin `id_institucion` (dónde figura
cada uno), sin cambios en el backend.

| Script | Tabla | Paquete | Endpoints |
| --- | --- | --- | --- |
| `directores.sql` | `DIRECTORES` | `PKG_DIRECTORES_ETHOS` | `directores`, `directores/:id` |
| `coordinadores.sql` | `COORDINADORES` | `PKG_COORDINADORES_ETHOS` | `coordinadores`, `coordinadores/:id` |
| `instituciones.sql` | `INSTITUCIONES` | `PKG_INSTITUCIONES_ETHOS` | `instituciones`, `/opciones`, `/:id`, `/:id/facilitador` |
| `instituciones_directores.sql` | `INSTITUCIONES_DIRECTORES` | `PKG_INST_DIRECTORES_ETHOS` | `instituciones-directores`, `/opciones`, `/:id` |
| `instituciones_coordinadores.sql` | `INSTITUCIONES_COORDNADORES` | `PKG_INST_COORDINADORES_ETHOS` | `instituciones-coordinadores`, `/opciones`, `/:id` |
| `horario_instituciones.sql` | `HORARIO_INSTITUCIONES` | `PKG_HORARIO_INST_ETHOS` | `horario-instituciones`, `/opciones`, `/copiar`, `/:id` |
| `pre_horarios.sql` | `PRE_HORARIOS` | `PKG_PRE_HORARIOS_ETHOS` | `pre-horarios`, `/opciones`, `/confirmar`, `/:id` |
| `postulaciones.sql` | `POSTULACIONES` | `PKG_POSTULACIONES_ETHOS` | `postulaciones`, `/opciones`, `/formulario`, `/:id`, `/:id/estado` |

Orden para correrlos: `directores.sql` y `coordinadores.sql`, después `instituciones.sql` y por
último los otros cinco.

| Método | Ruta | Exige | Qué hace |
| --- | --- | --- | --- |
| GET | `instituciones` | sesión | El listado, con el director vigente y cómo va el año lectivo (`anio`): autoridades activas, bloques de horario, pre-horarios y confirmados, postulaciones activas |
| GET | `instituciones/opciones` | sesión | La lista `ACTIVO_INACTIVO` de APEX y el año lectivo |
| GET | `instituciones/:id` | sesión | La ficha, con `usos` y cuántos pre-horarios del año no tienen facilitador |
| POST | `instituciones` | insertar en la página de `/instituciones` | `{nombre, estado, id_ciudad, id_barrio, direccion, ubicacion, zona, comentario, id_facilitador}` → `{id_institucion, autoridades_cambiadas}` |
| PUT | `instituciones/:id` | actualizar | Lo mismo |
| DELETE | `instituciones/:id` | borrar | **409** si algo la usa fuera de su ficha; autoridades y horario se borran con ella |
| POST | `instituciones/:id/facilitador` | actualizar | El "Actualizar Facilitador" de la 21: el facilitador guardado a los pre-horarios del año que no tienen → `{actualizados}` |
| GET | `instituciones-directores?id_institucion=` | sesión | Las filas de una institución (sin el parámetro, todas); misma forma en `instituciones-coordinadores` |
| POST/PUT/DELETE | `instituciones-directores[/:id]` | actualizar en `/instituciones`, o la acción en `/instituciones-directores` | Una fila por vez |
| GET | `directores` | sesión | Las personas, con en cuántas instituciones figuran |
| POST | `directores` | insertar en `/directores`, o actualizar en `/instituciones` | Alta de persona desde la ficha (era el modal 35) |
| GET | `horario-instituciones?id_institucion=` | sesión | Los bloques de TODOS los años, con `anio_actual` |
| POST | `horario-instituciones/copiar` | insertar (como las autoridades) | `{id_institucion, desde}`: copia ese año al lectivo actual; **409** si el actual ya tiene bloques |
| GET | `pre-horarios?id_institucion=&anio=` | sesión | Los del año (sin `anio`, el actual), con `id_postulacion` y sus `usos` (> 0 = bloqueado) |
| GET | `pre-horarios/opciones` | sesión | Turnos y "confirmado" (listas de APEX), materias, énfasis y docentes (con `es_activo`) |
| POST/PUT/DELETE | `pre-horarios[/:id]` | actualizar en `/instituciones` | Una clase por vez; **409** si está bloqueado o no es del año actual |
| POST | `pre-horarios/confirmar` | actualizar en `/instituciones` | `{id_institucion, ids, estado}`: confirma varios; saltea bloqueados e incompletos. Hoy el sitio no lo usa (la grilla confirma fila por fila, como la 43) |
| GET | `postulaciones?id_institucion=&anio=` | sesión | Las del año, con `anios` (los que tiene la institución) y `usos` |
| GET | `postulaciones/formulario?id_institucion=&anio=` | sesión | Lo que imprime el Formulario N° 1 (el proceso DATOS de la 60) |
| POST/PUT | `postulaciones[/:id]` | insertar / actualizar en `/instituciones` o `/postulaciones` | `{datos}`: la fila de la grilla como **texto JSON** (ORDS bindea solo campos sueltos). No toca `NOMBRE_PROFESOR`, `TELEFONO`, `ID_PRE_HORARIO` ni `ANIO` (ocultas en la 38) |
| DELETE | `postulaciones/:id` | eliminar en `/instituciones` o `/postulaciones` | **409** si tiene intervenciones o evaluaciones |
| PUT | `postulaciones/:id/estado` | actualizar en `/instituciones` o `/postulaciones` | `{estado, obs_estado}`. Hoy el sitio no lo usa (el estado se cambia en la grilla) |

- **Ubicación con FK COMPUESTAS** (distinto de facilitadores). `INSTITUCIONES` tiene FK a
  `BARRIOS` (país, departamento, ciudad, barrio), a `CIUDADES` (país, departamento, ciudad) y
  a `DEPARTAMENTOS` (país, departamento). Por eso país y departamento se copian **de la fila
  del barrio**, o de la ciudad si no hay barrio: así las FK se cumplen siempre. Una ciudad con
  datos viejos desalineados no tiene combinación que las cumpla: la base da ORA-02291 y se
  avisa que hay que corregirla (la verificación de `ciudades.sql` imprime el `UPDATE`). La
  ciudad es obligatoria, como en APEX.
- **El estado arrastra a las autoridades.** `TRG_UPD_ESTADO_INSTITUCIONES` (ya estaba, no se
  toca) pone el nuevo estado a TODAS las filas de directores y coordinadores de la institución:
  reactivarla reactiva también las de períodos viejos. `guardar` las cuenta
  (`autoridades_cambiadas`) y la pantalla lo avisa antes y después de guardar. Si el estado
  anterior era NULL el trigger no hace nada (compara con `!=`).
- **Activa = 'A' o NULL**, el mismo criterio que `evaluaciones_facilitadores.sql`.
- **Las columnas viejas** de `INSTITUCIONES` que APEX ya no mostraba (`DIRECTOR`, `NRO_CI`,
  `TELEFONO`, `COORDINADOR…`, `HORARIO`, `CARGO`, `NIVEL`, `TURNO`, `ID_DIRECTOR`,
  `ID_COORDINADOR`) no se leen ni se tocan.
- **"Actualizar Facilitador"** es el proceso de la 21 tal cual. `TRG_POSTULACIONES` (el
  trigger de `PRE_HORARIOS`) borra y vuelve a crear la postulación de cada pre-horario
  confirmado que se toca, como pasaba en APEX: la ficha dice cuántos son antes de confirmar.
- **Autoridades**: el período lo propone la pantalla con el año del calendario, como APEX
  (`to_char(sysdate,'yyyy')`); es texto libre. La misma persona con el mismo período, cargo
  (o tipo), nivel y turno en la misma institución es **409**: sería la misma fila dos veces.
- **Coordinadores, distinto de directores**: el id se llama `ID_INSTITUION_COORDINADOR` y la
  tabla `INSTITUCIONES_COORDNADORES` (así están en la base); el "cargo" es `TIPO_COORDINADOR`;
  período y estado pueden venir vacíos; `NRO_TELEFONO` es **`CHAR(200)`** y se lee con `TRIM`
  (si no, llega con ~190 espacios atrás). La persona es **obligatoria** al guardar aunque la
  tabla la deje en NULL: la verificación avisa cuántas filas viejas no tienen.
- **Personas**: CI repetida es 409; el nombre repetido solo lo avisa la pantalla (puede haber
  homónimos). Borrar una persona, solo si no figura en ninguna institución.
- **Horario por año.** `ANIO` lo completan dos triggers iguales (`TRG_ANIO_LECTIVO` y
  `TRG_HORARIO_INSTITUCIONES_SET_ANIO`). El modal 33 mostraba todos los años mezclados; el PDF
  de la 60 imprime solo el elegido. La pantalla los separa por año y ofrece copiar el de otro
  año cuando el actual está vacío.
- **Horas**: viajan como `'HH:MM'` y se guardan sobre el 01/01/2025, la fecha que usa
  `TRG_POSTULACIONES_SET_FEC_HORA`. Las de APEX tienen otra fecha, así que todo se compara y
  ordena por `TO_CHAR(…, 'HH24:MI')`. `TOTAL` lo calcula el backend; la hora de fin tiene que
  ser posterior a la de inicio (APEX la dejaba en 00:00).
- **Turno**: en el horario es el `NUMBER` 1/2/3 de `POSTULACIONES.TURNO`; en las autoridades,
  texto de otra lista. Son dos dominios distintos con el mismo nombre.
- **Confirmar un pre-horario crea su postulación.** Lo hace `TRG_POSTULACIONES` (ya estaba, no
  se toca): con `ESTADO = 'SI'` inserta la postulación (la cantidad en la columna de su grado y
  de su manual, las horas en las de su día); en cada UPDATE la **borra y la vuelve a crear**
  (otro id, y vuelve Activa); en un DELETE la borra. Dos consecuencias:
  - El trigger hace `CASE` sobre `GRADO`, `DIA` y `MANUAL` **sin ELSE**: un valor vacío o
    desconocido da ORA-06592 al confirmar. Por eso los tres son obligatorios y se validan contra
    las listas fijas de la 43 (APEX no los pedía).
  - `INTERVENCIONES` y `EVALUACIONES_FACILITADORES` tienen FK a `POSTULACIONES`: si la
    postulación ya tiene alguna, el trigger no puede borrarla y **ese pre-horario queda
    bloqueado** (en APEX fallaba igual, con el error del trigger). El listado lo marca y el
    paquete lo rechaza antes, con un mensaje claro.
- **Solo se modifican los pre-horarios del año actual**: la postulación regenerada toma el año
  lectivo actual (`TRG_POSTULACIONES_SET_ANIO`), no el del pre-horario.
- **Elegir el docente pisa el teléfono** con el suyo, como la acción dinámica de la 43. La
  lista ofrece todos los docentes, "nombre (teléfono)", como el LOV de APEX.
- **Pre-horarios y Postulaciones son grillas editables como los IG de la 43 y la 38**
  (`src/components/grilla-editable.tsx`, pedido el 09/10/2026: "que funcione igual que
  APEX"): mismas columnas, mismo orden y mismas listas; se edita en la celda, Agregar fila,
  Eliminar (tacha hasta guardar) y Guardar, que manda las filas una por una.
- **"Horarios de otro año"** (en la pantalla) reemplaza el doble clic que copiaba el
  horario de la 60 y lo pegaba en la 43: lee las postulaciones del año anterior y agrega la
  fila.
- **Postulaciones: se edita la fila entera, como en la 38.** Ojo, igual que en APEX: si la
  postulación salió de un pre-horario y después se modifica ese pre-horario, el trigger la
  regenera y lo cambiado en la grilla se pierde. Activa = no 'Inactivo' (criterio de la 60).
- **El formulario** (`postulaciones/formulario`) devuelve lo mismo que el proceso DATOS de la
  60, con un arreglo: DATOS filtraba `i.id_pais = 1` y el encabezado salía **vacío** para una
  institución sin país 1. El PDF y la imagen los arma el sitio
  (`src/lib/formulario-postulacion.ts`), con el diseño del que generaba APEX; si cambia el
  contacto impreso (Cecilia Rafael), se cambia ahí.

## Usuarios (`usuarios.sql`)

Reemplaza a la página 67 de APEX (Usuarios) y a su modal 68 (Activar / Inactivar Usuarios). La
68 **no es una página en el sitio**: es el diálogo de cada usuario en `/usuarios`, con los
permisos de la 67. Los usuarios son los del workspace (`APEX_WORKSPACE_APEX_USERS`): acá no se
crean ni se borran, igual que en APEX.

| Método | Ruta | Exige | Qué hace |
| --- | --- | --- | --- |
| GET | `usuarios` | consultar en la página de `/usuarios` | Usuario, nombre, apellido, correo, `bloqueado`, cuántas páginas tiene en `ROLES_PAGINAS`, y `es_yo` / `es_duena` |
| PUT | `usuarios/:usuario/estado` | actualizar en la misma | `{bloqueado: 'S'\|'N'}` → `{bloqueado, sesiones_cerradas}` |

- **Se pide el estado que se quiere, no "invertir".** APEX llamaba a `PRC_TOGGLE_USUARIO`, que
  invierte. El paquete lo sigue usando, pero solo si el estado actual no es el pedido: con
  una lista vieja, "Bloquear" nunca termina activando a nadie.
- **Después relee el estado.** Si `PRC_TOGGLE_USUARIO` no lo cambió —por ejemplo porque
  desde ORDS no hay sesión APEX—, responde un error que lo dice en vez de un "listo" falso.
- **Bloquear cierra sus sesiones del sitio** (`ETHOS_TOKENS`): si no, seguiría adentro hasta
  6 horas.
- **El login del sitio rechaza una cuenta bloqueada** (`cuenta_bloqueada` en `auth.sql`,
  08/10/2026). Antes no: `IS_LOGIN_PASSWORD_VALID` solo compara la contraseña, y un usuario
  bloqueado en APEX seguía entrando al sitio y al APK. Para que valga hay que volver a correr
  `auth.sql`.
- **No se puede bloquear la cuenta propia ni la dueña del workspace**
  (`FUNDACIONCARACTER2024@GMAIL.COM`).

## Auditoría (`auditoria.sql`)

Tres endpoints de **solo lectura** sobre las bitácoras, y el procedimiento que las genera.

| Método | Ruta | Devuelve |
| --- | --- | --- |
| GET | `auditoria/tablas` | Cada tabla auditada con sus triggers, sus columnas cruzadas contra la `_JN` y el trigger, y sus conteos |
| GET | `auditoria/movimientos` `?tabla=&operacion=&usuario=&desde=&hasta=&id_auditoria=&limite=&pagina=&buscar=` | La bitácora de todas las tablas (o una), de lo más nuevo a lo más viejo. `buscar`: contiene, en cualquier columna de datos |
| GET | `auditoria/historial` `?tabla=&id_auditoria=` | Toda la vida de un registro: sus filas de bitácora y cómo está hoy en la tabla |

**Tabla auditada = existe `X_JN` con `JN_OPERATION` y `JN_DATETIME`.** No se decide por el
nombre del trigger porque conviven dos convenciones, y **no guardan lo mismo en un UPDATE**:

| Trigger | En `UPD` guarda |
| --- | --- |
| `AUDITORIA_<TABLA>` (lo genera `pr_crear_trigger_auditoria`) | `:OLD`, el valor **anterior** |
| `EVALUACIONES_FACILITADORES_JNTRG` (escrito a mano) | `:NEW`, el valor **nuevo** |

El backend deduce cuál es leyendo la fuente del trigger (`guarda_en_update`) y el front arma
el antes/después con eso (`src/lib/auditoria.ts` → `reconstruir`).

Lo que conviene saber:

- **No usar `USER_TRIGGER_COLS`: en oracleapex.com se cuelga** (medido el 24/09/2026: un
  `COUNT(*)` filtrado por una sola tabla no volvía nunca). `auditoria/tablas` la consultaba una
  vez por trigger, así que el endpoint no terminaba y ORDS respondía su 500 genérico. Qué columnas
  lee cada trigger se saca ahora de su fuente (`p_columnas_trigger`, sobre `USER_SOURCE`).

- **`pr_crear_trigger_auditoria` quedó versionado acá**, y el script **regenera** todos los
  `AUDITORIA_*` al correrse. Cambios respecto del que había en la base: `JN_ORACLE_USER`
  registra el usuario de la app (ver abajo) y `:NEW.ID_AUDITORIA` ya no se asigna en un
  DELETE. **No correrlo sobre `EVALUACIONES_FACILITADORES`**: le crearía un segundo trigger
  que escribe la misma bitácora.
- **Quién hizo el cambio.** Desde ORDS `V('APP_USER')` es NULL, así que la bitácora anotaba
  el usuario del esquema. Ahora `PKG_AUTH_ETHOS.VALIDAR_TOKEN` deja el usuario del token en
  `CLIENT_IDENTIFIER` (y lo limpia si el token no sirve, porque ORDS reusa sesiones) y los
  triggers anotan `NVL(V('APP_USER'), NVL(CLIENT_IDENTIFIER, USER))`. Las filas viejas
  siguen a nombre del esquema.
- **Las horas vuelven en hora de Paraguay.** `JN_DATETIME` es `SYSDATE` del servidor (UTC):
  el paquete le resta 3 h al devolverla y corre los filtros al revés. Si salen corridas, se
  toca `c_desfase`.
- **SQL dinámico, pero con nombres del diccionario.** El nombre de tabla que llega del front
  se valida contra `USER_TABLES` (`f_tabla`) y todo nombre pasa por
  `DBMS_ASSERT.ENQUOTE_NAME`. Los filtros van siempre como binds.
- **`buscar` mira en todas las columnas de datos de cada bitácora** (no en las `JN_*` ni en
  `ID_AUDITORIA`, que tienen sus propios filtros). Es un "contiene" que no distingue mayúsculas
  pero **sí tildes**. Las fechas se comparan como se ven en pantalla (`DD/MM/YYYY`), y lo que
  apunta a otra tabla está guardado como ID: se encuentra por el número, no por el nombre. Va
  dentro de cada rama del `UNION ALL` (`f_filtro_busqueda`), porque afuera solo quedan las
  columnas de control. Ningún índice la ayuda: con "Todas" recorre cada bitácora entera (28 al
  24/09/2026).

**Acceso: cualquier usuario con sesión** (decidido el 24/09/2026), aunque la bitácora tenga
datos de todas las tablas. Si hay que restringirlo, el lugar es `f_usuario` del paquete.

### Si Auditoría responde el 500 genérico de ORDS

Una respuesta como `{"code":"InternalServerError", …, "instance":"tag:oracle.com,2020:ecid/…"}`
**no viene del paquete**: sus tres procedimientos atrapan los errores y responden
`{"success":false,"message":"Error: ORA-…"}`. Si llega la de ORDS, el error ocurrió al llamar al
paquete o ORDS cortó el request por tiempo. Así se encontró lo de `USER_TRIGGER_COLS`: corriendo
por separado en SQL Commands cada consulta de diccionario que usa el endpoint, hasta ver cuál no
volvía.

## Gráficos del Inicio (`intervenciones.sql`)

Dos endpoints de **solo lectura** sobre `V_HISTORIAL_INTERVENCIONES`, una vista que ya existía
en la base: el script no la crea ni la modifica. Solo necesitan `auth.sql`.

| Método | Ruta | Devuelve | Gráfico |
| --- | --- | --- | --- |
| GET | `intervenciones` `?anio=&mes=&id_facilitador=&limite=` | Las marcaciones **desviadas**: 15 minutos o más del horario (tarde o antes) o a más de 1.000 m de la institución. Una fila por marcación, con los grados agrupados | Puntualidad y Ubicación |
| GET | `intervenciones/por-dia` `?anio=&mes=&si_no=` | Cuántas intervenciones hubo cada día del mes: **todas**, no solo las desviadas | Actividad |

Sin `anio` se usa el año en curso (el del reloj, no el lectivo); `?anio=TODOS` lo apaga.

Lo que conviene saber:

- **El agrupado lo hace el front** (`agruparPorFacilitador` y `agruparPorUbicacion`, en
  `src/lib/intervenciones.ts`). Son pocas filas por mes, y un endpoint agregado aparte obligaría
  a mantener el mismo criterio en dos consultas.
- **`diferencia_minutos` tiene dos rarezas a propósito**: el signo está invertido (positivo =
  llegó *antes*) y está en **horas**, no en minutos. Es la cuenta de la consulta que se usaba en
  APEX, y se conserva para que los números coincidan. El front la convierte con `desvioMinutos()`.
- **El mes se filtra con `EXTRACT(MONTH FROM fecha_hora)`, nunca con la columna `MES`.** La
  vista arma `MES` con `TO_CHAR(fecha_hora, 'Month')` y hereda el idioma de la sesión: `'Agosto'`
  en SQL Workshop, `'August   '` en ORDS. Comparar contra ella apagaba el filtro en silencio
  (05/08/2026).
- **La ubicación de referencia de cada institución se deduce** de la mediana de sus propias
  marcaciones: la columna de ubicación de la institución guarda links de Google Maps acortados,
  no coordenadas.

## Agendas (`agendas.sql`)

**Solo lectura** sobre `V_AGENDA`, otra vista que ya existía (la agenda se arma desde
`POSTULACIONES`). Solo necesita `auth.sql`.

| Método | Ruta | Devuelve |
| --- | --- | --- |
| GET | `agendas` `?anio=&manual=&id_facilitador=&id_institucion=&turno=&dia=&departamento=&ciudad=&buscar=&estado=&limite=&pagina=` | El horario semanal |
| GET | `agendas/filtros` `?anio=&dia=&departamento=&ciudad=&turno=&id_facilitador=&id_institucion=&manual=` | Los valores que existen en los datos, para los combos (lo que en APEX eran las facetas) |

Departamento y ciudad se filtran **por nombre**, con `UPPER` de los dos lados: la vista expone
solo el nombre, no los IDs, y pueden venir vacíos si la institución no los tiene cargados.

## Carga manual de intervenciones (`intervenciones_crud.sql`)

| Método | Ruta |
| --- | --- |
| GET | `intervenciones-crud` `?anio=&mes=&id_facilitador=&id_institucion=&buscar=&limite=&pagina=` |
| GET | `intervenciones-crud/:id` |
| POST | `intervenciones-crud` |
| PUT | `intervenciones-crud/:id` |
| DELETE | `intervenciones-crud/:id` |

**Es un módulo aparte del de los gráficos, a propósito:** aquel es de solo lectura y devuelve
solo las marcaciones desviadas de una vista; este escribe sobre la tabla `INTERVENCIONES` y
devuelve todas. Las reglas de la carga —la postulación como eje, los triggers que completan o
validan campos— están en el encabezado del script. Solo necesita `auth.sql`.

## Inventario de manuales (`inventarios.sql`)

| Método | Ruta | Cuerpo / respuesta |
| --- | --- | --- |
| GET | `inventarios/sucursales` | → `id_sucursal`, `descripcion`, `abiertos` |
| GET | `inventarios` `?id_sucursal=` | La planilla: **todos** los manuales de `INDICES_MANUALES`, contados o no, + `resumen` de la sucursal |
| POST | `inventarios/conteo` | `{id_sucursal, items: "Manual%201:5;Manual%202:"}` → `{guardados, borrados}` |
| POST | `inventarios/cerrar` | `{id_sucursal}` → `{cerrados}`; **409** si hay abiertos sin cantidad física |
| POST | `inventarios/descartar` | `{id_sucursal}` → `{borrados}`: borra el conteo en curso. **409** si no hay |
| POST | `inventarios/revertir` | `{id_sucursal, eliminar: 'S'\|'N'}` → `{revertidos, existencias}`: deshace el **último** cierre. **409** si hay conteo en curso o nada cerrado |
| GET | `inventarios/historial` `?id_sucursal=&estado=N\|S&desde=&hasta=` | La consulta de detalle (pantalla, gráfico y PDF). Sin paginar, con tope de 5000 filas (`truncado`) |

**Se cuenta por manual, no por índice** (25/09/2026): se sacaron `INVENTARIOS.ID_INDICE` y
`EXISTENCIAS.ID_EXISTENCIA`. El catálogo de manuales es el `DISTINCT MANUAL` de
`INDICES_MANUALES`, y el identificador de un manual es su texto.

| Tabla | Qué guarda |
| --- | --- |
| `EXISTENCIAS` | Lo que hay **hoy**: una fila por (manual, sucursal), con UNIQUE |
| `INVENTARIOS` | El **historial**: una fila por inventario. A lo sumo **un conteo abierto** (`IND_CERRADO = 'N'`) por (manual, sucursal), lo garantiza el índice `INVENTARIOS_UN_ABIERTO` que crea el script. Los cerrados solo los toca `revertir` |

**Se carga solo la cantidad física.** La de sistema la toma el paquete de
`EXISTENCIAS.CANTIDAD_ACTUAL` en cada guardado, y al cerrar `EXISTENCIAS` queda con la física
(decidido el 25/09/2026).

**El script reescribe el trigger `INVENTARIOS_ACTUALIZAR_EXISTENCIAS`**, que ya existía:

- busca `EXISTENCIAS` por `MANUAL`: usaba `ID_INDICE`, y al sacar esa columna quedó INVALID
  (con un trigger INVALID, **todo** `UPDATE` sobre `INVENTARIOS` falla con ORA-04098);
- copiaba `CANTIDAD_SISTEMA` en vez de `CANTIDAD_FISICA`, así que cerrar no corregía nada;
- actuaba en **cualquier** `UPDATE` de una fila cerrada, no solo al cerrarla: retocar una fila
  vieja desde APEX volvía a pisar `EXISTENCIAS` con un conteo viejo. Ahora actúa solo en la
  transición a `'S'`;
- rechaza cerrar sin cantidad física o sin manual (`-20002`) en vez de un ORA crudo.

Si `AUDITORIA_INVENTARIOS` o `AUDITORIA_EXISTENCIAS` quedaron INVALID por las columnas
borradas, el script los regenera con `pr_crear_trigger_auditoria` (de `auditoria.sql`).

`items` viaja como texto y no como array JSON porque ORDS bindea solo los campos escalares del
body. El manual va URL-encoded porque es texto libre y podría traer los separadores `:` o `;`.
Solo necesita `auth.sql`.

**Las fechas van en hora local y al minuto** (`TRUNC(SYSDATE - 3/24, 'MI')`, pedido el
25/09/2026): `INVENTARIOS.FECHA` y `EXISTENCIAS.FECHA_ACTUALIZACION`. El servidor está en UTC y
`SYSDATE` pelado las dejaba 3 horas adelantadas. `FECHA_CIERRE` es la excepción: lleva
segundos porque es la clave que agrupa un cierre (ver abajo).

### Descartar y revertir (29/09/2026)

**Descartar** borra todos los conteos abiertos de la sucursal. No toca `EXISTENCIAS`: un
conteo abierto nunca impactó.

**Revertir** deshace el último cierre de la sucursal. El script agrega dos columnas a
`INVENTARIOS` (y, si existe `pr_crear_trigger_auditoria`, las suma a la bitácora):

| Columna | Qué guarda |
| --- | --- |
| `FECHA_CIERRE` | Cuándo se cerró. Todas las filas de un mismo "Cerrar inventario" llevan la misma: es lo que las agrupa, porque no hay tabla de cabecera |
| `CANTIDAD_ANTERIOR` | `EXISTENCIAS.CANTIDAD_ACTUAL` justo antes del cierre (0 si no había fila) |

A `EXISTENCIAS` se le suma `CANTIDAD_ANTERIOR − CANTIDAD_FISICA`; no se le pone de vuelta el
valor de antes. Así lo que se movió después del cierre —una transferencia recibida— se
conserva: antes 10, se contaron 8, llegaron 5 → 13; revertir da 13 + (10 − 8) = 15.

- **Solo el último cierre**, de a uno y del más nuevo al más viejo: uno posterior ya pisó
  `EXISTENCIAS` con otro conteo.
- **Sin conteo en curso** en la sucursal: reabrir chocaría con `INVENTARIOS_UN_ABIERTO`, y
  ese conteo tomó su cantidad de sistema de las existencias que se van a corregir.
- `eliminar = 'N'` reabre los conteos (vuelven a la planilla); `'S'` los borra.
- Reabrir (`'S'` → `'N'`) no dispara `INVENTARIOS_ACTUALIZAR_EXISTENCIAS`, que actúa solo en la
  transición a `'S'`: la devolución la hace el paquete.

**Cierres de antes del 29/09/2026.** `FECHA_CIERRE` se rellena desde `INVENTARIOS_JN` (al
minuto, para que un cierre no quede partido en dos), y los que no tengan rastro se agrupan por
`FECHA`. No tienen `CANTIDAD_ANTERIOR`, así que se usa `CANTIDAD_SISTEMA` —lo que decía
`EXISTENCIAS` al **contar**, no al cerrar—: es exacto salvo que entre el conteo y el cierre
se haya recibido una transferencia de ese manual en esa sucursal.

## Sucursales (`sucursales.sql`)

| Método | Ruta | Cuerpo / respuesta |
| --- | --- | --- |
| GET | `sucursales` | Todas, con su uso: `manuales`, `libros`, `inventarios`, `transferencias` |
| POST / PUT | `sucursales` / `sucursales/:id` | `{descripcion}`; **409** si el nombre ya existe (sin distinguir mayúsculas) |
| DELETE | `sucursales/:id` | **409** si la usan inventarios, existencias o transferencias (dice cuáles) |

**El script reescribe `SUCURSALES_JNTRG`**, que ya existía: en la rama `DELETING` asignaba
`:NEW.ID_AUDITORIA` (ORA-04084, borrar una sucursal con `ID_AUDITORIA` en NULL fallaba
siempre), y registraba el esquema en vez del usuario de la app. Son los dos arreglos que ya
tiene `pr_crear_trigger_auditoria`.

## Transferencias de manuales (`transferencias.sql`)

| Método | Ruta | Cuerpo / respuesta |
| --- | --- | --- |
| GET | `transferencias` `?estado=N\|S&id_sucursal=&limite=&pagina=` | Pendientes primero; `id_sucursal` filtra las que salen **o** llegan |
| GET | `transferencias/manuales` `?id_sucursal=&excluir_id=` | El catálogo con `existencia` y `comprometido` en el origen |
| GET | `transferencias/:id` | Cabecera + `detalle`; si está recibida, `recibida_el` / `recibida_por` (salen de la bitácora) |
| POST / PUT | `transferencias` / `transferencias/:id` | `{id_sucursal_origen, id_sucursal_destino, items: "Manual%201:5;Manual%202:3"}` |
| POST | `transferencias/:id/recibir` | Pasa `IND_RECIBIDA` a `'S'`; **409** si ya estaba |
| POST | `transferencias/:id/revertir` | Deshace la recepción: devuelve las existencias y la deja pendiente; **409** si no estaba recibida |
| DELETE | `transferencias/:id` | Pendiente: la borra. Recibida: revierte la recepción y la borra, en una transacción |
| GET | `transferencias/historial` `?estado=&id_sucursal=&desde=&hasta=` | La consulta y el PDF: **una fila por línea de detalle** con la cabecera repetida y `recibida_el` (de la bitácora). Tope de 5000 líneas (`truncado`) |

**Las existencias las mueve el trigger `TRANSFERENCIAS_ACTUALIZAR_EXISTENCIAS` al recibir**
(resta del origen, suma al destino). El script no lo toca. El paquete escribe `EXISTENCIAS`
en dos casos: antes de recibir crea en 0 las filas que le falten al **origen**, porque el
trigger resta con `UPDATE` y sin fila no restaría nada; y al **revertir** (abajo).

- **Disponible = existencia − comprometido** en otras pendientes que salen de esa sucursal:
  mientras viaja, el origen todavía los tiene. Si se envía más, la pantalla avisa pero deja
  guardar (decidido el 25/09/2026).
- **Una recibida no se edita**: primero se revierte la recepción.
- **Revertir la recepción** (29/09/2026): no hay trigger inverso, así que lo hace el paquete.
  Pasa `IND_RECIBIDA` a `'N'` y por cada línea **suma** al origen y **resta** al destino: una
  cuenta relativa, que conserva lo que se movió después. Si el trigger llegara a reaccionar al
  pasar a `'N'` (hoy no), la devolución se haría dos veces: por eso compara las existencias
  antes y después de ese `UPDATE` y, si cambiaron, deshace todo con un 409. **Eliminar** una
  recibida es revertir + borrar, en la misma transacción.
- **Revertir después de inventariar descuadra**: si después de recibirla se cerró un
  inventario en el origen o el destino, ese conteo ya refleja lo que hay. La confirmación lo
  advierte.
- **Riesgo conocido:** si se cierra un inventario del origen mientras una transferencia viaja,
  al recibirla se descuenta dos veces. La confirmación de recepción lo advierte.
- El trigger del usuario pone `FECHA_ACTUALIZACION = SYSDATE` (UTC), a diferencia del de
  inventarios (hora local al minuto). No se tocó porque es suyo.

## El filtro por año lectivo (`anios_lectivos.sql` y las listas de evaluaciones)

**Los dos combos de personas filtran por el año lectivo activo POR DEFECTO**, sin que el
front mande nada. El año sale de `FN_ANIO_LECTIVO_ACTUAL()`, que devuelve el `ANIO` de la
fila de `ANIOS_LECTIVOS` con `ESTADO = 'A'`.

| Lista | Qué exige además de estar vigente |
| --- | --- |
| `facilitadores` | `ACTIVO = 'SI'` **y** al menos una `POSTULACIONES` en el año activo |
| `instituciones` | `ESTADO = 'A'` **y**, si vino `id_facilitador`, postulación de ESE facilitador en el año activo |

Un facilitador puede seguir activo en su ficha y no estar dando clases este año: sin este
filtro, el combo lo ofrecía igual y no tiene sentido evaluarlo.

Cómo desactivarlo:

| Query | Efecto |
| --- | --- |
| *(nada)* | El año lectivo activo |
| `?anio=TODOS` | No filtra por año |
| `?anio=2025` | Ese año |

**Si no hay ningún año con `ESTADO = 'A'`,** la función devuelve `NULL` y los filtros se
apagan solos: vuelven a salir todos los activos. Es deliberado — una tabla de configuración
sin cargar no puede dejar los combos vacíos y sin explicación.

**El año se compara como TEXTO** (`POSTULACIONES.ANIO` es `VARCHAR2(4)`). El
`anio_a_filtrar()` del paquete hace el `TO_CHAR`: comparar contra un `NUMBER` haría que
Oracle convierta la columna y se pierda el índice `IDX_POST_INST_FAC_ANIO`.

### Un solo año activo a la vez

`anios_lectivos.sql` crea un **índice único funcional** que solo indexa las filas con
`ESTADO = 'A'`, así que la base rechaza un segundo año activo. Activar uno nuevo obliga a
desactivar el anterior en la misma transacción.

Es la única forma de expresar "solo una fila activa" sin un trigger: un `CHECK` no puede
mirar otras filas y un trigger de tabla choca con la *mutating table*.

> **`FN_ANIO_LECTIVO_ACTUAL` ya existía en la base** —la usa el trigger
> `TRG_POSTULACIONES_SET_ANIO`— pero su fuente **no estaba en el repositorio**. El script la
> versiona con `CREATE OR REPLACE`, así que **pisa la que estaba**. Si la anterior decidía
> por otro criterio (por ejemplo `SYSDATE` contra `FECHA_DESDE`/`FECHA_HASTA` en vez de por
> `ESTADO`), el cambio también afecta a las postulaciones nuevas. Es lo buscado —un solo
> criterio para todo el sistema— pero conviene saberlo antes de correrlo.

**Ciudades: una sola lista y una sola columna.** `EVALUACIONES_FACILITADORES` guarda
solo `ID_CIUDAD`, con FK simple a `CIUDADES(ID_CIUDAD)`. El front manda solo
`id_ciudad`; país y departamento son recuperables por join a `CIUDADES` y el histórico
viejo queda en la tabla `_JN`.

`ASPECTOS_POSITIVOS` y `ASPECTOS_MEJORAR` son `CLOB`: sin tope de largo. El límite
práctico lo pone el bind de ORDS (~32 KB por campo), no la columna.

## Cabecera y detalle: una fila NO es una evaluación

Esto es lo más importante para entender el API, y no está modelado en la base.

Una evaluación es **un facilitador en una institución durante un período**, con varios
detalles: un área + una evaluación de esa área + una estrella. Pero
`EVALUACIONES_FACILITADORES` tiene **una fila por detalle**, y la cabecera
(`ID_FACILITADOR`, `ID_INSTITUCION`, `ID_CIUDAD`, `FECHA_DESDE`, `FECHA_HASTA`,
`EVALUADO_POR`, los aspectos) **se repite en cada fila**. No hay columna que agrupe
las filas de una misma evaluación.

Consecuencias, todas reales:

- **Crear una evaluación son N `POST`**, uno por detalle, repitiendo la cabecera. No hay
  transacción: el paquete hace `COMMIT` por llamada, así que si una falla la evaluación
  queda a medias.
- **Editar es un diff** de N filas (`PUT` las que siguen, `POST` las nuevas, `DELETE` las
  que se quitaron). **Borrar** es un `DELETE` por fila.
- **El agrupado lo hace el frontend**, por clave natural (facilitador + institución +
  las dos fechas + `evaluado_por` normalizado) — ver `src/lib/evaluaciones.ts`. Eso
  implica que dos evaluaciones idénticas en esos cinco campos se ven como una sola.
- **`total`, `pagina` y `limite` cuentan FILAS, no evaluaciones.** El front pide
  `limite=200` justamente para que un grupo no quede partido entre dos páginas.

La salida de fondo es agregar una columna de cabecera (`ID_CABECERA` o similar) y
paginar por ella. Requiere DDL sobre una tabla con datos, backfill de las filas ya
cargadas y actualizar el trigger `_JN`. **No está hecho.**

## `ESCALA` y la calificación

`CALIFICACION_ESTRELLAS` **se renombró a `ESCALA`** y **se eliminó la columna
`CALIFICACION`**. `ESCALA` además tiene FK a `ESCALAS_EVALUACIONES(ESCALA)` — a la
columna `UNIQUE`, no a la PK `ID_ESCALA`.

- `ESCALA` guarda **1 (marcada) o NULL (desmarcada)**, una sola estrella por detalle.
  **No se usa 0**: el `CHECK (ESCALA >= 1 AND ESCALA <= 5)` lo rechaza. Ese CHECK y la
  validación del paquete se dejaron en 1..5, así que el API todavía acepta 2..5 aunque el
  front nunca los mande.

### El CHECK de 1..5 no alcanza para los 32 niveles

`ESCALAS_EVALUACIONES.ESCALA` va de **0 a 32**, pero el CHECK de
`EVALUACIONES_FACILITADORES.ESCALA` corta en **1..5**. Con los datos cargados hoy, las
cinco escalas guardables por fila son **'Deficiente'**: ningún otro tramo se puede poner
en una fila. Con el modelo actual no rompe nada, porque la fila usa el 1 solo como
"marcada" y la calificación sale del **conteo** de filas marcadas, no de la FK. Si la
escala de la fila pasa a ser la calificación de ese ítem, hay que revisar el CHECK.
**Sin resolver.**

- **La calificación no se guarda: se deriva** de cuántos detalles están marcados. Ese
  número es el `ESCALA` de `ESCALAS_EVALUACIONES`, que tiene 33 filas en cinco tramos
  (recargada para evaluaciones de hasta 32 ítems; antes eran 12 en cuatro tramos):

  | `ESCALA` | `CALIFICACION` |
  | --- | --- |
  | 0–15 | Deficiente |
  | 16–20 | Aceptable |
  | 21–24 | Bueno |
  | 25–28 | Muy Bueno |
  | 29–32 | Excelente |

  **Hay fila con `ESCALA = 0`**: una evaluación con ítems y ninguno marcado es
  "Deficiente". Solo una evaluación **sin** ítems queda "sin calificar". Más marcadas que
  el tope cae en el tramo más alto.

En SQL, la calificación de cada evaluación (agrupada con la misma clave que el front):

```sql
select e.*, es.calificacion
from (select a.id_facilitador, a.id_institucion, a.fecha_desde, a.fecha_hasta,
             lower(trim(a.evaluado_por)) as evaluado_por,
             count(case when a.id_area is not null and a.id_evaluacion is not null
                         and a.escala = 1 then 1 end) as marcadas
        from evaluaciones_facilitadores a
       group by a.id_facilitador, a.id_institucion, a.fecha_desde, a.fecha_hasta,
                lower(trim(a.evaluado_por))) e
left join escalas_evaluaciones es
       on es.escala = least(e.marcadas, (select max(escala) from escalas_evaluaciones))
```

**`ESCALAS_EVALUACIONES` no tiene endpoint.** Los cinco tramos están cableados en
`src/lib/evaluaciones.ts` (`ESCALA`). Si se editan los textos o los tramos en la base,
**hay que tocar ese archivo**: el front no se entera solo. Pasó el 08/10/2026 —la tabla
pasó de 12 a 32 niveles y la app siguió con los viejos: 27 marcadas salía "Excelente" en
la app y "Muy Bueno" en APEX—. Si vuelve a pasar, la salida de fondo es agregar
`GET listas/escalas` copiando cualquiera de las otras listas.

La sección 1 del `.sql` **no recrea nada**: verifica que estén la PK, las 5 FKs, el
CHECK de estrellas y la columna de la PK en la tabla `_JN`, y agrega solo lo que falte.

**Solo vigentes por defecto**: `facilitadores` filtra `ACTIVO='SI'` e `instituciones`
`ESTADO='A'` (las filas con `ESTADO` nulo cuentan como activas). Para traer todo,
`?activo=TODOS` / `?estado=TODOS`.

**Al editar, mandar `incluir_id`** con el valor ya guardado: si ese facilitador o
institución se dio de baja después de crearse la evaluación, el combo por defecto no
lo trae y el campo aparecería vacío. `incluir_id` lo incluye aunque esté inactivo.

**Cascada del formulario**: `listas/instituciones?id_facilitador=N` devuelve solo las
instituciones donde ese facilitador tiene `POSTULACIONES` (con `EXISTS`, no `JOIN`: un
facilitador puede tener varias postulaciones en la misma institución y un join la
duplicaría). Esa misma lista trae `id_ciudad` y `ciudad`, así el front carga la ciudad
sola sin combo aparte. `?anio=` filtra por `POSTULACIONES.ANIO` y es opcional a
propósito: con el año lectivo por defecto, un facilitador sin postulaciones cargadas de
este año aparecería sin instituciones y el formulario quedaría trabado.

Nada de esto lo obliga la base: se puede guardar una evaluación con una institución
donde el facilitador nunca postuló. Es ayuda de captura, no regla de integridad.

**Evaluaciones: cargar el combo filtrado** por el área elegida
(`listas/evaluaciones?id_area=N`). Una evaluación pertenece a un área y el API
rechaza con 400 la combinación incoherente, que la base sí permitiría.

Las fechas viajan como `YYYY-MM-DD`. `id_auditoria` es de solo lectura: lo pone el
trigger de bitácora, mandarlo desde el front no tiene efecto.

Probar sin frontend:

```bash
curl -X POST "https://oracleapex.com/ords/fundcarac/ethos/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"usuario":"joseg","password":"xxx"}'

curl "https://oracleapex.com/ords/fundcarac/ethos/auth/me" \
  -H "Authorization: Bearer A1B2..."
```

Si `curl` funciona pero el front no, el problema está en el CORS (producción), en el proxy
(desarrollo) o en la URL configurada, no en la base.

## Decisiones de fondo

- **Token opaco en tabla, no JWT.** `RAWTOHEX(SYS_GUID())` ×2, con fecha de expiración.
  Revocable (logout = `ACTIVO='N'`) y sin librerías. Vigencia: 6 h (`c_horas_token`).
- **Un solo token activo por usuario**: el login desactiva los anteriores.
- **Las credenciales las valida APEX**, no una tabla propia. Los usuarios son los del
  workspace (*Administration → Manage Users*). Si Editorial Ethos necesita su propia tabla
  de usuarios, lo único que se reescribe es `credenciales_validas` — hay un ejemplo comentado
  ahí mismo. Nada más del paquete cambia.
- **CORS abierto** (`Access-Control-Allow-Origin: *`), y **es obligatorio**: el sitio publicado
  (GitHub Pages es estático, el proxy no corre) y el APK (que carga ese mismo sitio) le pegan
  directo a ORDS. Solo el desarrollo local pasa por el proxy (`src/routes/api/ords.$.ts`). Si
  la sección 4.4 de `auth.sql` imprime `[WARN]`, revisarlo: el navegador dispara el preflight
  porque las llamadas llevan `Authorization`.
- **`UPPER()` en usuario y token** en todos lados. No cambies el criterio a medias.

## Pasar una página de APEX: el backend

Las reglas generales están en el [`README`](../README.md) → *Pasar una página de APEX al
sitio*. Del lado de Oracle, lo que ya se aprendió:

- **Permisos:** `GET` pide solo sesión (otros combos usan la lista); `POST`/`PUT`/`DELETE`
  piden insertar/actualizar/borrar en la página de su ruta, con
  `PKG_ROLES_PAGINAS_ETHOS.pagina_de_ruta` y `puede`. Nunca un número de página fijo.
- **"En uso" lo dice la base:** las FK de una columna que apuntan a la tabla (salvo las `_JN`),
  contadas por id. La pantalla no ofrece borrar lo que está en uso.
- **El id lo pone la tabla** (identity o trigger), como en APEX. Si da ORA-01400 en la PK, el
  mayor más 1 con la tabla bloqueada.
- **Las listas de valores no se adivinan:** se leen de `APEX_APPLICATION_LOV_ENTRIES` (ver
  `facilitadores/opciones`); si la lista es dinámica, cae a los valores ya cargados.
- **ORDS bindea solo campos escalares del body.** Una ficha grande o con listas viaja como un
  solo campo de texto con el JSON (`datos` en `facilitadores.sql`) y se lee con `APEX_JSON`.
- **`UNISTR` devuelve NVARCHAR2:** en un `UNION` con un texto común da ORA-12704. Va con
  `TO_CHAR(UNISTR(...))`.
- **FK compuestas** (`INSTITUCIONES` hacia `BARRIOS`, `CIUDADES` y `DEPARTAMENTOS`): los ids
  de ubicación se copian **de la fila** del barrio o de la ciudad, no se derivan por separado;
  si no, una fila vieja desalineada hace fallar la FK (ver *Instituciones*).
- **`CHAR(n)` viene relleno de espacios** hasta n: se lee con `TRIM`
  (`INSTITUCIONES_COORDNADORES.NRO_TELEFONO`).
- **Nombres con errores de tipeo en la base** (`INSTITUCIONES_COORDNADORES`,
  `ID_INSTITUION_COORDINADOR`): el SQL usa el de la base; el archivo, el endpoint y el front,
  el bien escrito.
- **Los scripts son ASCII** (salvo la raya del título). Un mensaje con ñ va con `UNISTR`:
  `'No hay un ' || UNISTR('a\00f1o') || ' lectivo'`. Ojo al generarlo con `sed`: en el
  reemplazo, `\0` es "toda la coincidencia" (pasó el 09/10/2026).
- **Tildes:** en datos, `UNISTR` (el upload de SQL Scripts puede no respetar la codificación).
  Una **columna** con tilde (`DENOMINACIÓN`) se busca en `USER_TAB_COLUMNS` y se usa con SQL
  dinámico.
- **Triggers de bitácora a mano:** la verificación previa los lista; uno que asigna `:NEW` en un
  DELETE da ORA-04084 (como `SUCURSALES_JNTRG`).
- **Datos viejos desalineados** (una ciudad con otro país que su departamento): la verificación
  los cuenta e imprime el `UPDATE` que los alinea, sin correrlo sola.
- **Fin de línea de las guías:** `README.md` y `backend/README.md` son LF; `src/routes/README.md`
  es CRLF. Un script que las edite tiene que respetar el de cada una: si separa por el que no es,
  no encuentra las líneas y pega el texto al final del archivo (pasó el 08/10/2026).

## Agregar un endpoint de negocio

El patrón a copiar es `auth/me`. En cada handler protegido:

1. Leer `:authorization`, quitarle el prefijo `Bearer `, pasar el token al paquete.
2. Declarar el `ORDS.DEFINE_PARAMETER` del header — **una vez por handler, no por template**.
   Si falta, `:authorization` llega `NULL` y todo responde *"Token invalido o expirado"*
   aunque el login haya dado un token bueno. Es el error que más tiempo cuesta.

Y en el paquete de negocio, las primeras líneas de todo procedimiento protegido:

```sql
l_usuario := PKG_AUTH_ETHOS.VALIDAR_TOKEN(p_token);
IF l_usuario IS NULL THEN
  p_error(401, 'Unauthorized', 'Token invalido o expirado');
  RETURN;
END IF;
```

Si el módulo está en el menú, después del token va el permiso de la página (08/10/2026). La
página se busca por su ruta, no por un número escrito en el código:

```sql
IF PKG_ROLES_PAGINAS_ETHOS.puede(
     l_usuario,
     PKG_ROLES_PAGINAS_ETHOS.pagina_de_ruta('/evaluaciones'),
     'I') = 'N' THEN  -- C consultar, I insertar, U actualizar, D borrar
  p_error(403, 'Forbidden', 'No tenes permiso para cargar evaluaciones');
  RETURN;
END IF;
```

Hoy ningún módulo lo hace todavía: ver *Menú y permisos*.

En `p_error`, `OWA_UTIL.STATUS_LINE` va **antes** de `MIME_HEADER`. Al revés la respuesta ya
está abierta y el status se pierde (queda 200 con `success:false`). El frontend detecta la
expiración por status **y** por mensaje; no quites esa red de seguridad.

## Pendientes conocidos

- **Sin rate limiting.** El endpoint está expuesto a internet. Si esto pasa a producción,
  contar intentos fallidos por usuario/IP en una tabla y bloquear temporalmente.
- **Token de 6 h fijas**, sin renovación deslizante. Al expirar, el usuario vuelve al login.
- El script `.sql` **no se aplica solo**: si lo editas, hay que volver a correrlo a mano.
- **Los módulos no controlan permisos en el backend.** El menú y las pantallas respetan
  `ROLES_PAGINAS`, pero los endpoints de cada módulo solo piden sesión. Falta sumar
  `PKG_ROLES_PAGINAS_ETHOS.puede` en cada paquete (ver *Agregar un endpoint de negocio*).
- **Los tramos de la calificación están copiados en el sitio** (`ESCALA` en
  `src/lib/evaluaciones.ts`). Si cambia `ESCALAS_EVALUACIONES`, hay que tocar ese archivo; la
  salida de fondo es un `GET listas/escalas`.
