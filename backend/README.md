# Backend — Juventud con Valores (Oracle APEX / ORDS)

| Archivo | Qué trae | Orden |
| --- | --- | --- |
| **[`ethos_auth.sql`](ethos_auth.sql)** | Tokens, `PKG_AUTH_ETHOS`, módulo ORDS `ethos`, `auth/*` | 1º, obligatorio |
| **[`ethos_anios_lectivos.sql`](ethos_anios_lectivos.sql)** | `ANIOS_LECTIVOS` + `FN_ANIO_LECTIVO_ACTUAL()` | 2º |
| **[`ethos_evaluaciones_facilitadores.sql`](ethos_evaluaciones_facilitadores.sql)** | CRUD de `EVALUACIONES_FACILITADORES` + listas de valores de los combos y de la tarjeta de dirección (`PKG_EVAL_FACILITADORES_ETHOS`) | 3º |

Los tres son idempotentes. El tercero **no** define el módulo ni habilita el esquema:
agrega handlers al módulo `ethos` que creó el primero.

**El orden importa entre el 2º y el 3º:** el paquete de evaluaciones llama a
`FN_ANIO_LECTIVO_ACTUAL()`. Si no existe, no compila.

> Los objetos y el prefijo ORDS se siguen llamando `ethos` aunque la marca haya cambiado a
> *Juventud con Valores* el 04/08/2026. Renombrarlos obliga a tocar la URL base, el `.env`,
> el workflow de deploy y el APK ya instalado: mucho riesgo para un cambio cosmético.

## Qué contiene

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
2. **SQL Workshop → SQL Scripts → Upload** → sube `ethos_auth.sql`.
3. **Run**. Al terminar mira la salida: cada paso imprime `[OK]`, `[SKIP]`, `[WARN]` o `[ERROR]`.
4. Copia la **URL BASE** que imprime el bloque final. Es la que va en el frontend.

Tiene que correrlo el usuario **dueño del esquema** del workspace, no `SYS`.

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

### El filtro por año lectivo

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

`ethos_anios_lectivos.sql` crea un **índice único funcional** que solo indexa las filas con
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

Si `curl` funciona pero el front no, el problema está en el proxy o en la URL configurada,
no en la base.

## Decisiones de fondo

- **Token opaco en tabla, no JWT.** `RAWTOHEX(SYS_GUID())` ×2, con fecha de expiración.
  Revocable (logout = `ACTIVO='N'`) y sin librerías. Vigencia: 6 h (`c_horas_token`).
- **Un solo token activo por usuario**: el login desactiva los anteriores.
- **Las credenciales las valida APEX**, no una tabla propia. Los usuarios son los del
  workspace (*Administration → Manage Users*). Si Editorial Ethos necesita su propia tabla
  de usuarios, lo único que se reescribe es `credenciales_validas` — hay un ejemplo comentado
  ahí mismo. Nada más del paquete cambia.
- **CORS abierto** (`Access-Control-Allow-Origin: *`) por el único cliente que pega directo a
  ORDS: la app Expo de `mobile/`. El sitio web no lo necesita, porque pasa por su proxy
  server-side (`src/routes/api/ords.$.ts`) y por lo tanto es mismo origen. Si la sección 4.4
  imprimió `[WARN]`, no bloquea nada con esta arquitectura.
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
