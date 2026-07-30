# Backend — Editorial Ethos (Oracle APEX / ORDS)

| Archivo | Qué trae | Orden |
| --- | --- | --- |
| **[`ethos_auth.sql`](ethos_auth.sql)** | Tokens, `PKG_AUTH_ETHOS`, módulo ORDS `ethos`, `auth/*` | Primero, obligatorio |
| **[`ethos_evaluaciones_facilitadores.sql`](ethos_evaluaciones_facilitadores.sql)** | CRUD de `EVALUACIONES_FACILITADORES` + listas de valores de los combos (`PKG_EVAL_FACILITADORES_ETHOS`) | Después |

Los dos son idempotentes. El segundo **no** define el módulo ni habilita el esquema:
agrega handlers al módulo `ethos` que creó el primero.

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
| `facilitadores` | `buscar` (nombre o CI), `activo`, `incluir_id` | `id_facilitador`, `nombre_apellido`, `activo` |
| `instituciones` | `buscar`, `estado`, `incluir_id`, `id_facilitador`, `anio` | `id_institucion`, `nombre`, `estado`, `id_ciudad`, `ciudad` |
| `areas` | `buscar` | `id_area`, `descripcion` |
| `evaluaciones` | `id_area`, `buscar` | `id_evaluacion`, `id_area`, `descripcion` |
| `ciudades` | `buscar` | `id_ciudad`, `nombre` |

**Ciudades: una sola lista y una sola columna.** `EVALUACIONES_FACILITADORES` guarda
solo `ID_CIUDAD`, con FK simple a `CIUDADES(ID_CIUDAD)`. El front manda solo
`id_ciudad`; país y departamento son recuperables por join a `CIUDADES` y el histórico
viejo queda en la tabla `_JN`.

`ASPECTOS_POSITIVOS` y `ASPECTOS_MEJORAR` son `CLOB`: sin tope de largo. El límite
práctico lo pone el bind de ORDS (~32 KB por campo), no la columna.

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
