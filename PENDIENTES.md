# Pendientes

Estado al **04/08/2026**. Ordenado por lo que bloquea a lo que puede esperar.

Cada punto dice **por qué** quedó pendiente, no solo qué falta: la mayoría son decisiones
tomadas a conciencia, no olvidos.

---

## 🔴 Bloqueantes

### 1. Correr los scripts del backend en APEX, **en este orden**

**Sin esto el API de evaluaciones está caído.** Los scripts no se aplican solos.

```
SQL Workshop → SQL Scripts → Upload → Run, uno por uno:

  1. backend/ethos_anios_lectivos.sql
  2. (cargar la fila del año lectivo activo, ver abajo)
  3. backend/ethos_evaluaciones_facilitadores.sql
```

**El orden no es opcional:** el paquete de evaluaciones llama a
`FN_ANIO_LECTIVO_ACTUAL()`, que crea el primer script. Sin ella no compila.

El primero además crea `ANIOS_LECTIVOS`. Después de correrlo hay que **cargar el año**, o
los combos no filtran por año lectivo (no se rompen, pero muestran de más):

```sql
INSERT INTO anios_lectivos (anio, descripcion, estado, fecha_desde, fecha_hasta)
VALUES (2026, 'Año lectivo 2026', 'A', DATE '2026-02-01', DATE '2026-11-30');
COMMIT;
```

El tercero es el de siempre: la tabla cambió (se eliminó `CALIFICACION`,
`CALIFICACION_ESTRELLAS` pasó a `ESCALA`) y el paquete ya está adaptado en el repo. Hasta
que se corra, `GET`, `POST` y `PUT` de `evaluaciones-facilitadores` fallan porque
`PKG_EVAL_FACILITADORES_ETHOS` no compila contra la estructura vieja.

**Ojo con `FN_ANIO_LECTIVO_ACTUAL`:** ya existía en la base pero su fuente no estaba en el
repo. El script la versiona con `CREATE OR REPLACE`, o sea que **pisa la anterior** y su
criterio (año con `ESTADO = 'A'`) pasa a valer también para el trigger
`TRG_POSTULACIONES_SET_ANIO`. Ver [`backend/README.md`](backend/README.md).

### ~~2. Instalar el Android SDK~~ ✅ RESUELTO (30/07/2026)

Instalado en `C:\Users\josej\Android\Sdk` (android-36, build-tools 36.1.0, platform-tools,
licencias aceptadas). **La cadena completa del APK está verificada**: `npm run apk` compila y
deja el `.apk` en `android\app\build\outputs\apk\debug\` y una copia en `public\app.apk`.

**No hay que volver a descargar nada.** Ver [`APK.md`](APK.md) → *Requisitos*.

---

## 🟠 Decisiones abiertas

### 3. El `CHECK` de `ESCALA` no llega a los 12 niveles

`EVALUACIONES_FACILITADORES.ESCALA` tiene `CHECK (ESCALA >= 1 AND ESCALA <= 5)` y FK a
`ESCALAS_EVALUACIONES.ESCALA`, que va de **1 a 12**. Cruzando con los datos cargados, como
valor de fila solo son alcanzables *Deficiente* (1-3) y *Aceptable* (4-5): **"Bueno" y
"Excelente" no se pueden guardar en una fila.**

Hoy no rompe nada porque la fila usa el `1` solo como "marcada" y la calificación sale del
**conteo** de filas marcadas, no de la FK. Hay tres salidas:

| Opción | Qué implica |
| --- | --- |
| **A. Es solo un rename** | La estrella queda binaria y la calificación por conteo. **Es lo que está implementado.** No hay que hacer nada. |
| **B. Cada ítem lleva escala 1-5** | Volver a la estrella de 5 por ítem + recargar `ESCALAS_EVALUACIONES` con 5 niveles. |
| **C. Cada ítem lleva escala 1-12** | Ampliar el `CHECK` a `BETWEEN 1 AND 12` + selector de 12 niveles en la UI. |

Detalle en [`backend/README.md`](backend/README.md) → *El CHECK de 1..5 no alcanza*.

---

## 🟡 Deuda de diseño: la tabla sin cabecera

### 4. Agregar una columna de cabecera a `EVALUACIONES_FACILITADORES`

**Es la causa raíz de cuatro problemas distintos.** Una evaluación son N filas que repiten
la cabecera (facilitador, institución, período, evaluado_por, aspectos) y no hay columna
que las agrupe. Consecuencias que hoy están mitigadas pero no resueltas:

- **El agrupado es por clave natural** (facilitador + institución + las dos fechas +
  `evaluado_por`), así que dos evaluaciones idénticas en esos campos se fusionan en una.
- **La paginación cuenta filas, no evaluaciones.** Se pide `limite=200` para que un grupo
  no se parta entre páginas; con más de 200 filas en el rango, se parte igual.
- **Guardar y borrar son N llamadas sin transacción.** Si una falla, la evaluación queda a
  medias. `guardarEvaluacion` lo reporta, pero no lo puede evitar.
- **Bloquea las escrituras offline** (ver punto 7).

Costo: DDL sobre una tabla con datos, backfill de las filas ya cargadas y actualizar el
trigger `_JN`. Está documentado en [`backend/README.md`](backend/README.md) →
*Cabecera y detalle*.

---

## 🔵 Offline

Los puntos 1 y 2 del plan **ya están hechos** (fallo de red que no expulsa al usuario, y
caché de react-query persistida). Falta:

### 5. Service worker para la web

Sin él, la web instalada como PWA no abre sin conexión: muestra la pantalla de error del
navegador. El APK **no lo necesita** (sus assets ya viajan adentro, y el OTA mantiene esa
propiedad: el bundle descargado se guarda en el teléfono, no se pide en cada arranque —
ver [`OTA.md`](OTA.md)).

`vite-plugin-pwa` para precachear el shell. **Si no se va a hacer**, conviene sacar
`display: standalone` de [`public/site.webmanifest`](public/site.webmanifest): hoy promete
una app instalable que offline no arranca.

### 6. Indicador de "sin conexión" en la UI

Hoy la app muestra datos cacheados **sin avisar que son viejos**. El error ya dice "Sin
conexión con el servidor" cuando una llamada falla, pero no hay un cartel de estado.

### 7. Escrituras offline (cola de sincronización)

**Depende del punto 4.** Sin columna de cabecera hay que resolver además: ids locales para
evaluaciones creadas sin red (el id lo genera Oracle con `IDENTITY`), reconciliación al
sincronizar, y colisión con la clave natural. Hacerlo antes de la cabecera es construir
sobre el problema.

También falta detección de conflictos: no hay `updated_at` ni versión de fila para saber si
alguien editó lo mismo mientras estabas sin red.

---

## ⚪ Chicos

### 8. Flash del tema claro al cargar

Quien tenga el modo oscuro elegido ve un destello blanco en cada carga. El HTML del SSR
sale siempre en claro (`<html lang="es">` sin `class="dark"`) porque la clase se aplica
recién al hidratar. Se arregla con ~10 líneas de script inline en el `<head>` de
[`src/routes/__root.tsx`](src/routes/__root.tsx) que lean `ethos-theme` antes del primer
paint. **La preferencia sí se guarda bien**; el problema es solo el destello.

### ~~9. El APK usa el ícono por defecto de Capacitor~~ ✅ RESUELTO (04/08/2026)

Los mipmaps se regeneraron desde `public/logo.png` en las seis densidades (legacy cuadrado,
legacy redondo y las dos capas del adaptativo), más los 26 `splash.png`. El nombre visible
pasó a "Juventud con Valores".

El adaptativo va **sin `inset` en el XML**: el margen está dentro del PNG (el logo dibujado
al 62% y centrado). Con el `inset="16.7%"` que traía el template, el recorte del launcher
dejaba un borde transparente alrededor del azul.

`applicationId` **no** cambió (`com.editorialethos.app`): cambiarlo haría que Android trate
el APK como otra app y no se instale encima de la que ya está en los teléfonos.

### 10. Versionar el APK antes de repartir una versión nueva

La firma **ya está resuelta**: `assembleRelease` firma solo con `ethos-release.jks` (ver
[`APK.md`](APK.md) → *Firma*).

Lo que queda: subir `versionCode` / `versionName` en `android/app/build.gradle` **en cada
versión que se reparta** — Android se niega a instalar encima un `versionCode` menor o igual.
Hoy va en `11` / `"1.8"`.

**Esto pesa mucho menos desde el OTA (05/08/2026):** repartir un APK ya solo hace falta para
cambios nativos. Un cambio de web se publica con `git push`. Ver [`OTA.md`](OTA.md).

### ~~15b. Acceso biométrico en el APK~~ ❌ DESCARTADO (31/07/2026)

Se implementó y se quitó el mismo día, a pedido explícito: costó demasiado tiempo para lo que
aportaba. Fuera el plugin, `src/lib/biometria.ts`, el switch de Mi cuenta y los permisos del
manifest.

Lo que hace hoy el trabajo es el check **"Recordar usuario y contraseña"** del login, que anda
igual en la web y en el APK. Guarda la contraseña en `localStorage` **en texto plano** —sin
Keystore no hay otro lugar—, es opt-in y el login lo advierte en pantalla. El token sigue sin
escribirse en el disco.

Si alguna vez se reintenta, en [`APK.md`](APK.md) → *No hay acceso biométrico* quedaron
anotadas las cuatro trampas que costaron el tiempo, para no volver a pagarlas.

### 11b. `POSTULACIONES.TURNO` no tiene tabla ni dominio en la base

Es un `NUMBER` **sin FK y sin tabla que lo describa**. Los valores cargados son 1
(4417 filas), 2 (3512) y 3 (44), y el significado —Mañana / Tarde / Noche— lo confirmó
Jose el 05/08/2026; no está escrito en ningún lado de Oracle.

Queda cableado en `TURNOS`, en [`src/lib/evaluaciones.ts`](src/lib/evaluaciones.ts),
por el mismo motivo que la escala: **no hay de dónde leerlo**. Si un día se carga un
turno 4, la tarjeta muestra "Turno 4" en vez de romperse.

La salida es una tabla `TURNOS` con su FK, y un join en `lov_postulaciones`. Mientras
no exista, cualquier cambio de dominio hay que hacerlo en ese objeto.

### 11. La escala está cableada en el front

Los cuatro tramos de `ESCALAS_EVALUACIONES` viven en `ESCALA`, en
[`src/lib/evaluaciones.ts`](src/lib/evaluaciones.ts). **Si se editan los textos en la base,
hay que tocar ese archivo.** La alternativa es un `GET listas/escalas`, copiando el patrón
de cualquiera de las cinco listas existentes.

### 12. El lint del repo viene roto

4602 errores de CRLF en 53 archivos, todos del template (`src/components/ui/*`,
`router.tsx`, `server.ts`, `error-capture.ts`). Ninguno es de código escrito para este
proyecto. `npm run format` lo arregla, pero reformatea medio repo en un commit — por eso
quedó sin hacer.

### ~~12b. Traversal de rutas en el proxy de ORDS~~ ✅ RESUELTO (30/07/2026)

El splat se concatenaba crudo a la URL de destino, y como `fetch` resuelve los `../`, un
pedido a `/api/ords/../../_/db-api/stable/` salía del prefijo y llegaba a la API de
administración SQL de ORDS usando el proxy de pivote. Agravado por que el `Authorization`
se reenvía sin validarse, así que ni siquiera hacía falta un token válido.

No era alcanzable en producción —el build estático no incluye el proxy—, pero sí en
`npm run dev` y en cualquier deploy con Node. Resuelto en
[`src/routes/api/ords.$.ts`](src/routes/api/ords.$.ts) con `resolverDestino()`: normaliza
con `new URL()` y exige que el `pathname` resuelto siga empezando con `ORDS_PREFIX`,
rechazando además barras codificadas (`%2f`, `%5c`) y URLs protocol-relative.

### 13. Sin rate limiting en el login

El endpoint está expuesto a internet. Si esto pasa a producción, contar intentos fallidos
por usuario/IP y bloquear temporalmente. Ver [`backend/README.md`](backend/README.md).

### 14. El token no se renueva

Dura 6 h fijas, sin renovación deslizante. Al expirar, el usuario vuelve al login.

### 15. `mobile/` quedó sin el módulo de evaluaciones

La app Expo tiene solo login, inicio y cuenta. Ya no es lo que responde a "generá el apk"
—eso ahora es el APK de la web con Capacitor— pero sigue en el repo. Decidir si se
completa, se deja como está o se da de baja.

### 16. El nombre `ethos` quedó por todos lados

La marca cambió a **Juventud con Valores** el 04/08/2026, pero siguen diciendo *ethos*: el
repositorio, el `applicationId` del APK, el módulo ORDS, los paquetes PL/SQL y las claves de
`localStorage` (`ethos-theme`, `ethos-palette`, `ethos-usuario`…).

**No es olvido.** Cada uno tiene su costo:

| Qué | Por qué no se cambió |
| --- | --- |
| `applicationId` | Android lo trataría como app distinta: no se instala encima, el usuario pierde lo guardado |
| Módulo ORDS y paquetes | Cambia la URL base → tocar `.env`, el workflow y **el APK ya instalado** |
| Claves de `localStorage` | Renombrarlas descarta las preferencias de quien ya usa la app |

Lo único gratis sería el nombre del repo. Si algún día se hace todo, va junto con una
migración de las claves viejas a las nuevas.

### 17. `evaluado_por` sigue siendo texto libre

Desde el 04/08/2026 se normaliza el formato al guardar ("jose galvez" → "Jose Galvez", ver
`formatearNombre` en [`src/lib/evaluaciones.ts`](src/lib/evaluaciones.ts)), pero **sigue
siendo un campo tipeado**: nada impide "Jose Galvez" y "J. Galvez" como dos personas.

Lo correcto sería un combo contra una tabla de evaluadores, o contra `FACILITADORES` si
quien evalúa siempre está ahí. Requiere decidir **quién puede evaluar**, que hoy no está
definido en la base.

Ojo si se hace: `claveNatural()` agrupa por `evaluado_por` en minúsculas. Cambiar el campo a
un ID cambia el agrupado de todo lo ya cargado.

### 18. Las filas viejas de `evaluado_por` quedaron con el formato anterior

El formato nuevo se aplica **al guardar**, así que solo toca las evaluaciones que se editen
de ahora en más. Las cargadas antes siguen como se tipearon ("JOSE GALVEZ", "jose galvez").

Se arregla con un `UPDATE` de una sola pasada — `INITCAP()` de Oracle hace casi lo mismo que
`formatearNombre()`. No se corrió porque toca datos históricos y eso se decide, no se
asume:

```sql
-- Mirar primero qué cambiaría:
SELECT DISTINCT evaluado_por, INITCAP(evaluado_por)
  FROM evaluaciones_facilitadores
 WHERE evaluado_por <> INITCAP(evaluado_por);
```

**Si se corre, el agrupado no se rompe**: `claveNatural()` normaliza a minúsculas, así que
un grupo con filas viejas y nuevas sigue siendo el mismo grupo.

### 19. Las evaluaciones ya cargadas no tienen postulación elegida

Desde el 05/08/2026 el formulario muestra las postulaciones del facilitador en esa
institución como tarjetas, y la elegida viaja en `id_postulacion`. Eso resuelve la
ambigüedad que `f_postulacion()` no podía: **cuando hay varias, elige una persona**.

Lo que queda: las filas cargadas antes siguen con lo que dedujo el backend, o con
`NULL` cuando había más de una candidata. **Solo se completan editando la evaluación
y eligiendo la tarjeta.** No se puede backfillear automáticamente — si se pudiera
deducir, `f_postulacion()` ya lo habría hecho.

Para ver cuántas están sin resolver:

```sql
SELECT COUNT(*) FROM evaluaciones_facilitadores WHERE id_postulacion IS NULL;
```

Ojo si se toca: `f_postulacion_final()` **valida que la postulación pertenezca** al
facilitador y la institución que se están guardando, y si no, la ignora y vuelve a
deducir. Un id de otra institución no rompe el guardado, simplemente no se usa.

### 20. `INDICES_MANUALES` no tiene tabla de manuales

`MANUAL` es un `VARCHAR2(100)` de la propia fila, así que el combo de manuales sale
de un `SELECT DISTINCT manual` — **ese distinct ES el catálogo**, no hay otro lado de
dónde sacarlo.

Consecuencias, ninguna bloqueante hoy:

- **Un typo crea un manual nuevo.** "Manual 1" y "manual 1 " son dos entradas
  distintas en el combo, y nada lo impide.
- No hay orden propio: se listan alfabéticamente. Si los manuales tuvieran un orden
  editorial distinto del alfabético, no se puede expresar.

La salida es una tabla `MANUALES` con su FK desde `INDICES_MANUALES`. Mientras tanto
el `DISTINCT` alcanza, porque esas filas las carga el equipo y no el usuario final.

### 21. `ID_INDICE` se guarda por fila, no por evaluación

Es el mismo problema del punto 4 (la tabla sin cabecera): el índice es un dato de la
evaluación, pero como cada detalle es una fila, se repite en todas. `agrupar()` toma
el de la primera fila que lo tenga.

En la práctica no molesta —el formulario lo manda igual en todas—, pero una carga
hecha desde APEX sobre una sola fila del grupo dejaría el resto sin él. Se resuelve
con la columna de cabecera del punto 4, no antes.
