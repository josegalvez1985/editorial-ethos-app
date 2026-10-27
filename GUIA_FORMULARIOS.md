# Guía: Formularios 1, 2 y 3 en otro proyecto

Cómo llevar los tres formularios de **editorial-ethos-app** (26/10/2026) a otra aplicación
**React + TypeScript** que usa **la misma base y los mismos endpoints ORDS** (módulo `ethos`,
workspace `fundcarac`). Los formularios salen en **PDF, imagen (PNG) y Excel con el mismo
formato**, y se generan enteros en el navegador.

| Formulario | Qué es | Para quién |
| --- | --- | --- |
| **Form. 1** — Postulación anual | Lo que una institución postula: grados, manuales, horarios y docentes | Una institución y un año, con sus **postulaciones** o con sus **pre-horarios** |
| **Form. 2** — Reporte diario del facilitador | Sus clases en una institución y las intervenciones de un período (normalmente un mes) | Un facilitador, una institución y un rango de fechas |
| **Form. 3** — Agenda semanal del facilitador | Su semana por turno, con lo bloqueado en rojo | Un facilitador y un año lectivo, con **postulaciones** o con **pre-horarios** |

**El backend no se toca**: la otra aplicación llama a los mismos endpoints. **Del front se copian
18 archivos de este repo** con el script del punto 2.2. No se pegan acá porque son unas 6.500
líneas y quedarían viejas. En la otra aplicación se adaptan tres cosas (2.3) y se arman las
pantallas (2.4).

## 0. Cómo funciona

```
Otra aplicación (React)                              Oracle (ORDS, módulo ethos)
───────────────────────                              ───────────────────────────
login ──────── POST auth/login ───────────────────►  PKG_AUTH_ETHOS → token (6 h)

Form. 1 ────── GET postulaciones/formulario ──────►  institución, autoridades, postulaciones
               (+ GET pre-horarios, si es con pre-horarios)

Form. 2 ────── GET postulaciones/formulario ──────►  la cabecera
               GET postulaciones/todas ───────────►  las clases (del año)
               GET intervenciones-crud ───────────►  las intervenciones (del año, paginadas)
               GET facilitadores ─────────────────►  el teléfono del facilitador
               GET etapas ────────────────────────►  "Buscar etapa"

Form. 3 ────── GET postulaciones/todas ───────────►  las clases (o GET pre-horarios/facilitador)
               GET facilitadores-bloqueos ────────►  lo rojo

        datos ─► armar (lib/*.ts) ─► dibujar ─► PDF (jsPDF) · PNG (canvas) · .xlsx (exceljs)
```

- **Todo se dibuja en el navegador.** No hay PDF ni Excel generados en Oracle.
- **El Form. 2 y el Form. 3 se arman sobre una grilla de celdas** (`planilla-celdas.ts`). De esa
  grilla salen las tres salidas, que por eso no se pueden desincronizar. El Form. 1 es más viejo:
  el PDF y la imagen salen de un mismo dibujo y el Excel se arma aparte (`descargarFormularioExcel`).
- **Solo lectura.** Ningún formulario escribe en la base.

## 1. Backend: no hay nada nuevo que crear

### 1.1 La URL y el login

- Base: `https://oracleapex.com/ords/fundcarac/ethos/`, la misma de este sitio (`VITE_API_URL` en
  `.github/workflows/deploy.yml`).
- Login: `POST auth/login` con `{usuario, password}`. Responde `{success, data: {token, usuario,
  nombre, email, expira}}`. El token dura **6 horas** y viaja en `Authorization: Bearer <token>`.
- **Los usuarios son los mismos**: las cuentas del workspace APEX `fundcarac`. La otra aplicación
  no tiene usuarios propios.

### 1.2 Lo que tiene que estar corrido en APEX

Todo esto ya está en la base que usa este sitio. Sirve para revisar si algo falla.

| Script | Para qué |
| --- | --- |
| `auth.sql` | Login y token |
| `postulaciones.sql` | `postulaciones/formulario`, `postulaciones/todas` |
| `pre_horarios.sql` | `pre-horarios` y **`pre-horarios/facilitador`** |
| `intervenciones_crud.sql` | `intervenciones-crud` |
| `facilitadores.sql` | `GET facilitadores` |
| `etapas.sql` | `GET etapas` |
| `facilitadores_dias_bloqueos.sql` | `GET facilitadores-bloqueos` |

> **`pre-horarios/facilitador` es del 26/10/2026.** Si al final de `pre_horarios.sql` no aparece
> `GET pre-horarios/facilitador?id_facilitador=&anio=`, hay que volver a correr el script. Sin ese
> endpoint, el Form. 3 con pre-horarios responde 404. Lo demás anda igual.

### 1.3 Permisos y CORS

- **Todos estos `GET` piden solo sesión**: no miran `ROLES_PAGINAS`. Quién ve cada pantalla en
  la otra aplicación lo decide la otra aplicación.
- **CORS ya está resuelto.** Cada endpoint tiene su preflight `OPTIONS` y responde
  `Access-Control-Allow-Origin: *`, que es lo que ya usan el sitio publicado y el APK. La otra
  aplicación puede llamar a ORDS directo desde el navegador, sin proxy.

### 1.4 Los endpoints y lo que se lee de cada uno

Ningún endpoint devuelve el formulario armado. Cada uno devuelve datos, y los arma
el front con los archivos del punto 2.

| Método y ruta | Parámetros | Lo que se usa |
| --- | --- | --- |
| `GET postulaciones/formulario` | `id_institucion`, `anio` | `nombre`, `direccion`, `departamento`, `ciudad`, `barrio`, `autoridades[]` (`cargo`, `nombre`, `ci`, `telefono`), `detalle[]` (las postulaciones activas), `horarios[]` |
| `GET postulaciones/todas` | `anio` (vacío = el lectivo actual) | `anio`, `anio_actual`, `anios[]`, `data[]`: una postulación con `id_institucion`, `institucion`, `id_facilitador`, `facilitador`, `turno`, `seccion`, `g2`…`g3m`, `ser`…`liderazgo`, `lunes_desde`…`viernes_hasta`, `enfasis`, `estado` |
| `GET pre-horarios` | `id_institucion` (siempre el año actual) | `anio`, `anio_actual`, `data[]`: un pre-horario (un grado, un manual, un día) con `id_facilitador` y `facilitador` |
| `GET pre-horarios/facilitador` | `id_facilitador`, `anio` | `data[]`: `id_institucion`, `institucion`, `turno`, `grado`, `seccion`, `dia`, `hora_desde`, `hora_hasta`, `estado` |
| `GET intervenciones-crud` | `anio`, `id_facilitador`, `id_institucion`, `limite` (máx. 500), `pagina` | `total`, `data[]`: `id_intervencion`, `id_postulacion`, `fecha` (`DD/MM/YYYY`), `nro_indice`, `si_no`, `motivo_desarrollo` |
| `GET facilitadores` | — | `data[]`: `id_facilitador`, `telefono` |
| `GET etapas` | — | `data[]`: `id_etapa`, `fecha_inicio`, `fecha_fin` |
| `GET facilitadores-bloqueos` | — | Los bloqueos de todos: facilitador, año y, por día, franjas `"07:00 - 11:40, 13:00 - 17:05"` |

## 2. Frontend

### 2.1 Dependencias

```bash
npm install jspdf@^4.2.1 jspdf-autotable@^5.0.8 exceljs@^4.4.0 @tanstack/react-query@^5.101.1
```

- `jspdf` y `exceljs` **se cargan recién al tocar el botón** (`import()` dinámico): no pesan en
  la carga inicial.
- `jspdf-autotable` lo importa `pdf-base.ts`, aunque estos formularios no lo usan.
- `@tanstack/react-query` lo importa `postulaciones.ts`, por el hook de los reportes por año.
  Si la otra aplicación no usa react-query, se puede no instalarlo. Para eso, en
  `postulaciones.ts` se borran:
  - `soloAnio`, `TodasPostulaciones`, `juntarAnios` y `usePostulacionesPorAnio`, que están en la
    sección "Los reportes por año". `TODOS_LOS_ANIOS` y lo que sigue después del hook se quedan.
  - El import de `@tanstack/react-query`.
  - `useMemo` del import de `react`. `CSSProperties` se queda.
- `clsx` y `tailwind-merge`: solo si se copia `utils.ts` entero (ver 2.3).

### 2.2 Copiar los archivos

En PowerShell, con las dos rutas ajustadas. **No pisa nada**: si en la otra aplicación ya existe
un archivo con el mismo nombre, lo saltea y avisa, para resolverlo a mano.

```powershell
$origen  = "C:\Users\josej\OneDrive\Desktop\Proyectos\editorial-ethos-app.git"
$destino = "C:\ruta\de\la\otra-app"   # <- la raíz del otro proyecto

$archivos = @(
  # Form. 1
  "src/lib/formulario-postulacion.ts",   # el dibujo: PDF, imagen y Excel
  "src/lib/postulaciones.ts",            # tipos, listas fijas (grados, manuales, días) y endpoints
  "src/lib/pre-horarios.ts",             # el Form. 1 con pre-horarios (formularioConPreHorarios)
  # Form. 2
  "src/lib/reporte-diario-facilitador.ts",
  "src/lib/planilla-reporte-diario.ts",
  "src/lib/intervenciones-crud.ts",
  "src/lib/etapas.ts",
  # Form. 3
  "src/lib/agenda-semanal-facilitador.ts",
  "src/lib/planilla-agenda-semanal.ts",
  "src/lib/facilitadores-bloqueos.ts",
  # Comunes
  "src/lib/planilla-celdas.ts",          # el motor de la grilla del Form. 2 y el Form. 3
  "src/lib/pdf-base.ts",                 # logo, texto seguro para el PDF, abrir en pestaña
  "src/lib/excel-base.ts",
  "src/lib/excel.ts",
  "src/lib/asset.ts",
  "src/lib/evaluaciones.ts",             # solo por nombreTurno (1 Mañana, 2 Tarde, 3 Noche)
  "src/lib/facilitadores.ts",            # solo por el tipo Uso que usa etapas.ts
  "src/lib/horario-instituciones.ts",    # solo por minutos("HH:MM")
  "public/logo.png"                      # el logo del Form. 2 (y de la cabecera de los PDF)
)

foreach ($a in $archivos) {
  $d = Join-Path $destino $a
  if (Test-Path $d) { Write-Warning "Ya existe, no se copió: $a"; continue }
  New-Item -ItemType Directory -Force (Split-Path $d) | Out-Null
  Copy-Item (Join-Path $origen $a) $d
  Write-Host "copiado: $a"
}
```

**Copiar de un commit, no de cambios a medio hacer**: anotar en la otra aplicación de qué commit
de este repo salieron (ver punto 5).

### 2.3 Adaptar tres cosas

**1. `@/lib/api` → `authFetch`.** Es lo único que los archivos copiados usan de `api.ts`. Tiene
que cumplir este contrato:

- `authFetch(ruta, init?)`: la `ruta` es relativa al módulo (`"postulaciones/todas?anio=2026"`).
- Agrega `Authorization: Bearer <token>`.
- Devuelve el JSON ya parseado.
- **Lanza un `Error` con el `message` del backend** si la respuesta no es 2xx o trae
  `success: false`. Las pantallas muestran ese mensaje.

Si la otra aplicación ya tiene su login contra `auth/login`, se crea `src/lib/api.ts` con un
`authFetch` que use su token. Si no tiene nada, alcanza con esto:

```ts
// src/lib/api.ts (mínimo): login contra el mismo ORDS y authFetch.
const BASE = import.meta.env.VITE_API_URL ?? "https://oracleapex.com/ords/fundcarac/ethos/";
let token: string | null = null;

export async function login(usuario: string, password: string) {
  const res = await fetch(`${BASE}auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ usuario, password }),
  });
  const json = await res.json().catch(() => ({}));
  const data = json?.data ?? json;
  if (!res.ok || json?.success === false || !data?.token)
    throw new Error(String(json?.message ?? "Usuario o contraseña incorrectos"));
  token = data.token as string;
  return data as { token: string; usuario: string; nombre: string; expira: string };
}

export async function authFetch(path: string, init: RequestInit = {}) {
  if (!token) throw new Error("No hay sesión activa");
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    cache: "no-store",
    headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.success === false)
    throw new Error(String(data?.message ?? "Operación fallida"));
  return data;
}
```

**2. `@/lib/utils`.** Los archivos copiados usan `normalizar`, `nombreTabla` y el tipo
`ValorLista`. Si la otra aplicación **no** tiene `src/lib/utils.ts`, se copia el de este repo.
Si ya tiene uno (lo crea shadcn, con `cn`), **no se pisa**: se le agregan esas tres piezas,
copiadas de `src/lib/utils.ts` de este repo. Son 30 líneas, incluida la función `singular`
que usa `nombreTabla`.

**3. El alias `@/` y el logo.**

- Los imports son `@/lib/...` → `src/lib/...`. Si la otra aplicación no tiene ese alias, se suma
  en `tsconfig.json` (`"paths": { "@/*": ["./src/*"] }`) y en `vite.config.ts`
  (`resolve.alias`).
- `asset.ts` arma la URL del logo con `import.meta.env.BASE_URL`, que es de Vite. Con otro
  empaquetador (Next, CRA) se cambia por `/${ruta}`. El logo tiene que quedar servido en
  `/logo.png`. Si no carga, el formulario sale igual, sin logo.

### 2.4 Usarlos en las pantallas

Son funciones sueltas, sin React. Cada pantalla junta los datos, arma el formulario y llama
a la salida.

> **El PDF y la imagen se abren con `abrirPdfEnPestana`, llamada DENTRO del clic y sin `await`
> antes.** El navegador solo deja abrir una pestaña en el mismo instante del clic. La función
> abre la pestaña primero y le pone el archivo cuando está listo. Si no puede abrirla (APK,
> bloqueador), descarga el archivo. El Excel siempre se descarga.

**Form. 1** (`formulario-postulacion.ts`):

```ts
import {
  descargarFormularioExcel, generarFormularioImagen, generarFormularioPdf, nombreArchivo,
} from "@/lib/formulario-postulacion";
import { abrirPdfEnPestana } from "@/lib/pdf-base";
import { obtenerFormulario } from "@/lib/postulaciones";
import { formularioConPreHorarios, listarPreHorarios } from "@/lib/pre-horarios";

// Con las postulaciones de un año:
const formulario = () => obtenerFormulario(idInstitucion, anio);
// Con los pre-horarios (todos, confirmados o no), en lugar de las postulaciones:
// const formulario = async () =>
//   formularioConPreHorarios(await obtenerFormulario(idInstitucion, anio),
//                            (await listarPreHorarios(idInstitucion)).items);

const archivo = nombreArchivo({ nombre: nombreInstitucion, anio }); // "Form. 1 - Institución - 2026"
onClickPdf = () => abrirPdfEnPestana(() => formulario().then(generarFormularioPdf), `${archivo}.pdf`);
onClickPng = () =>
  abrirPdfEnPestana(() => formulario().then(generarFormularioImagen), `${archivo}.png`, "la imagen");
onClickXlsx = () => formulario().then(descargarFormularioExcel);
```

**Form. 2** (`reporte-diario-facilitador.ts` + `planilla-reporte-diario.ts`):

```ts
import { cargarFormulario2, textoEtapa } from "@/lib/reporte-diario-facilitador";
import {
  descargarForm2Excel, generarForm2Imagen, generarForm2Pdf,
} from "@/lib/planilla-reporte-diario";
import { listarTodasPostulaciones } from "@/lib/postulaciones";

// Las postulaciones del año de la fecha desde (de todas las instituciones: sirven también
// para armar las listas de Facilitador e Institución, filtradas entre sí).
const { items } = await listarTodasPostulaciones({
  anio: desde.slice(0, 4), idDepartamento: null, idCiudad: null,
  idBarrio: null, idInstitucion: null, turno: null,
});
const form = await cargarFormulario2({
  idInstitucion, idFacilitador, facilitador,   // facilitador = su nombre
  desde, hasta,                                // "YYYY-MM-DD"; normalmente un mes completo
  etapa: textoEtapa(desde, hasta),             // la línea roja; se puede dejar escribirla
  postulaciones: items,
});
// form.clases[].sobran > 0: esa clase tuvo más de 4 intervenciones (conviene avisarlo).
generarForm2Pdf(form); generarForm2Imagen(form); descargarForm2Excel(form);
```

**Form. 3** (`agenda-semanal-facilitador.ts` + `planilla-agenda-semanal.ts`):

```ts
import {
  armarAgenda, clasesDePostulaciones, clasesDePreHorarios,
} from "@/lib/agenda-semanal-facilitador";
import { listarBloqueos } from "@/lib/facilitadores-bloqueos";
import {
  descargarForm3Excel, generarForm3Imagen, generarForm3Pdf,
} from "@/lib/planilla-agenda-semanal";

const [todas, { bloqueos }] = await Promise.all([
  listarTodasPostulaciones({ anio, idDepartamento: null, idCiudad: null,
                             idBarrio: null, idInstitucion: null, turno: null }),
  listarBloqueos(),
]);
const agenda = armarAgenda({
  anio,
  facilitador,                                          // su nombre
  clases: clasesDePostulaciones(todas.items, idFacilitador),
  // o, con los pre-horarios: clases: await clasesDePreHorarios(idFacilitador, anio),
  bloqueo: bloqueos.find((b) => b.idFacilitador === idFacilitador && String(b.anio) === anio) ?? null,
});
// agenda.noche y agenda.sinHorario: lo que quedó afuera (conviene avisarlo).
generarForm3Pdf(agenda); generarForm3Imagen(agenda); descargarForm3Excel(agenda);
```

### 2.5 Las pantallas de este repo, de referencia

No se copian tal cual: usan piezas de la interfaz de este sitio (`AppShell`, `SelectorModal`,
`Cargando`, `Fallo`, el `Dialog` de shadcn, `sonner`, `lucide-react` y los colores del tema de
Tailwind). Sirven de modelo para los parámetros, los avisos y la vista previa.

| Archivo | Qué muestra |
| --- | --- |
| `src/routes/reporte-diario-facilitador.index.tsx` | Form. 2: mes (atajos y selector), fechas, Buscar etapa, línea de la etapa, Facilitador e Institución filtrados entre sí, vista previa, avisos |
| `src/routes/agenda-semanal-facilitador.index.tsx` | Form. 3: año lectivo en pastillas, facilitador, vista previa, avisos |
| `src/components/form-3-institucion.tsx` | Form. 3 desde la ficha de una institución: elegir el facilitador si van varios, del año que muestra la pestaña |
| `src/components/postulaciones-institucion.tsx`, `pre-horarios-institucion.tsx` | Los botones del Form. 1 (busca `imprimir`) |

**La vista previa es la misma imagen que se descarga** (`generarForm2Imagen` y
`generarForm3Imagen`) mostrada en un `<img>`. Así lo que se ve es lo que sale.

## 3. Las reglas (acordadas con Jose el 26/10/2026)

Están en el código de los archivos copiados, en el encabezado de cada uno. Acá van resumidas,
para no romperlas al adaptar.

**Form. 1**
- Las postulaciones **activas** (estado distinto de `Inactivo`) de la institución y el año, por
  turno, con subtotal amarillo y total celeste. Con pre-horarios: todos, confirmados o no.
- Archivo: "Form. 1 - Institución - año".

**Form. 2**
- **Una fila por postulación activa** del facilitador en la institución (del año de la fecha
  desde) y por día con horario. Las secciones del mismo turno, día, hora, grado y manual van
  **juntas**, en una clase con un renglón por sección.
- **Intervenciones de la 1° a la 4°**: las de la clase en el período, en orden de fecha, **una por
  día** (de varias el mismo día, la última). **1/0** = se desarrolló o no; si no, el **motivo** va
  en *FIRMA PROF. / \*JUSTIF.* **TOTAL** = las desarrolladas. Si hay más de 4, salen las primeras
  4 (`sobran`).
- El período es **normalmente un mes completo**.
- **En blanco, para completar a mano:** recuperaciones y TÍTULO de las autoridades. La base no los
  tiene.
- `CON_INTERVENCIONES` (en `true`) apaga o prende el llenado de las intervenciones.
- Archivo: "Form. 2 - Institución - Facilitador - 01-10-2026 al 31-10-2026".

**Form. 3**
- **Solo MAÑANA y TARDE**: el turno de la clase o, sin turno, por la hora (antes de las 12:00,
  mañana). Las de la noche no salen.
- **Las filas salen de las clases**: las horas de inicio y de fin, en orden. Cada clase va en
  su hora de inicio.
- **Una celda por institución, día y hora**: lo que coincide se junta ("7° A+B", "8°&9°") y
  cuenta **1**.
- **Rojo** = horario bloqueado del facilitador ese año. **Nombre IE** completo.
- "REUNIÓN DE FACILITADORES" se completa a mano.
- Desde una institución: **la agenda es la del facilitador entero** (con sus otras instituciones),
  **del año que muestra la pestaña** (Postulaciones, el año elegido; Pre-horarios, siempre el
  actual), y cada pestaña usa su tabla (postulaciones o pre-horarios).
- Archivo: "Form. 3 - Facilitador - año".

**Textos fijos que pueden cambiar** (están en el código y no en la base):
- La declaración, la nota y el contacto del Form. 1 (`formulario-postulacion.ts`).
- La coordinación nacional (`COORDINACION`, en `reporte-diario-facilitador.ts`).
- La misión y la nota de justificación del Form. 2 (`planilla-reporte-diario.ts`).

## 4. Prueba final

1. Con una cuenta del workspace, el login de la otra aplicación devuelve el token.
2. **Form. 1:** una institución con postulaciones sale en PDF, imagen y Excel con los mismos
   números que en este sitio (pestaña Postulaciones de esa institución).
3. **Form. 2:** un facilitador, una institución y un mes con intervenciones. Revisar:
   - las columnas de la 1° a la 4°;
   - un "0" con su motivo;
   - el TOTAL.

   Compararlo con `/reporte-diario-facilitador` de este sitio, con los mismos parámetros.
4. **Form. 3:** un facilitador con horarios bloqueados. El TOTAL tiene que coincidir con
   `/agenda-semanal-facilitador`, y lo bloqueado tiene que salir en rojo. Con pre-horarios, probar
   también desde una institución (eso usa `pre-horarios/facilitador`).
5. Abrir los `.xlsx` en Excel: tienen que salir en oficio apaisado, en una hoja, con las celdas
   unidas y los colores.
6. El PDF en el celular. Si la pestaña no se abre, se descarga.

Si un formulario sale vacío o con error, primero confirmar que Oracle responda (por ejemplo,
`GET auth/me` sin token tiene que devolver 401 al instante) y que estén corridos los scripts de
1.2. Después recién mirar el código.

## 5. Mantenerlos iguales

Los archivos de la otra aplicación son **copias**. Un cambio hecho acá **no** llega solo:

- Anotar en la otra aplicación de qué commit de este repo se copiaron.
- Si acá se cambia un formulario, volver a copiar **sus** archivos (los de la tabla de 2.2) y
  revisar el diff antes de pisar. Si en la otra aplicación se tocó algo, se perdería.
- El backend es uno solo. Un cambio en un endpoint (un campo que se renombra) afecta a las
  dos aplicaciones a la vez: se corre el script una vez y se publican las dos.
