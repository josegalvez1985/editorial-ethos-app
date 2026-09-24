# Backend — Juventud con Valores (Oracle APEX / ORDS)

| Archivo | Qué trae | Orden |
| --- | --- | --- |
| **[`auth.sql`](auth.sql)** | Tokens, `PKG_AUTH_ETHOS`, módulo ORDS `ethos`, `auth/*` | 1º, obligatorio |
| **[`anios_lectivos.sql`](anios_lectivos.sql)** | `ANIOS_LECTIVOS` + `FN_ANIO_LECTIVO_ACTUAL()` | 2º |
| **[`evaluaciones_facilitadores.sql`](evaluaciones_facilitadores.sql)** | CRUD de `EVALUACIONES_FACILITADORES` + listas de valores de los combos y de la tarjeta de dirección (`PKG_EVAL_FACILITADORES_ETHOS`) | 3º |
| **[`intervenciones.sql`](intervenciones.sql)** | Puntualidad: atraso de los facilitadores sobre `V_HISTORIAL_INTERVENCIONES` (`PKG_INTERVENCIONES_ETHOS`) | independiente |
| **[`intervenciones_crud.sql`](intervenciones_crud.sql)** | Carga manual de intervenciones (`PKG_INTERV_CRUD_ETHOS`) | independiente |
| **[`agendas.sql`](agendas.sql)** | Horario semanal sobre `V_AGENDA` (`PKG_AGENDAS_ETHOS`) | independiente |
| **[`auditoria.sql`](auditoria.sql)** | Consulta de las bitácoras `_JN` (`PKG_AUDITORIA_ETHOS`) + `pr_crear_trigger_auditoria` | independiente |

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
| PUT | `evaluaciones-facilitadores/:id` | Bearer | JSON plano (registro completo) → `{success, message}` |
| DELETE | `evaluaciones-facilitadores/:id` | Bearer | → `{success, message}` o **409** si tiene dependencias |
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

### El CHECK de 1..5 no alcanza para los 12 niveles

`ESCALAS_EVALUACIONES.ESCALA` va de **1 a 12**, pero el CHECK de
`EVALUACIONES_FACILITADORES.ESCALA` corta en **5**. Con los datos cargados hoy, eso
significa que como valor de fila solo son alcanzables:

| `ESCALA` guardable | `CALIFICACION` que da la FK |
| --- | --- |
| 1, 2, 3 | Deficiente |
| 4, 5 | Aceptable |
| 6 … 12 | **imposible de guardar** (lo bloquea el CHECK) |

O sea que **"Bueno" y "Excelente" no se pueden poner en una fila.** Con el modelo actual
no rompe nada, porque la fila usa el 1 solo como "marcada" y la calificación sale del
**conteo** de filas marcadas, no de la FK. Pero si la escala de la fila pasa a ser la
calificación de ese ítem, hay que elegir una de dos:

- ampliar el CHECK a `BETWEEN 1 AND 12`, o
- recargar `ESCALAS_EVALUACIONES` con cinco niveles (1..5) en vez de doce.

**Sin resolver.**
- **La calificación no se guarda: se deriva** de cuántos detalles están marcados. Ese
  número es el `ESCALA` de `ESCALAS_EVALUACIONES`, que tiene 12 filas en cuatro tramos:

  | `ESCALA` | `CALIFICACION` |
  | --- | --- |
  | 1–3 | Deficiente |
  | 4–6 | Aceptable |
  | 7–9 | Bueno |
  | 10–12 | Excelente |

  No hay fila con `ESCALA = 0`: cero marcadas es "sin calificar", no un nivel.

**`ESCALAS_EVALUACIONES` no tiene endpoint.** Los cuatro tramos están cableados en
`src/lib/evaluaciones.ts` (`ESCALA`). Si se editan los textos o las descripciones en la
base, **hay que tocar ese archivo**: el front no se entera solo. Si eso molesta, el
patrón a copiar para agregar `GET listas/escalas` es cualquiera de las cinco listas.

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

En `p_error`, `OWA_UTIL.STATUS_LINE` va **antes** de `MIME_HEADER`. Al revés la respuesta ya
está abierta y el status se pierde (queda 200 con `success:false`). El frontend detecta la
expiración por status **y** por mensaje; no quites esa red de seguridad.

## Pendientes conocidos

- **Sin rate limiting.** El endpoint está expuesto a internet. Si esto pasa a producción,
  contar intentos fallidos por usuario/IP en una tabla y bloquear temporalmente.
- **Token de 6 h fijas**, sin renovación deslizante. Al expirar, el usuario vuelve al login.
- El script `.sql` **no se aplica solo**: si lo editas, hay que volver a correrlo a mano.
