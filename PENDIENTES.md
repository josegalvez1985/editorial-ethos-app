# Pendientes

Estado al **30/07/2026**. Ordenado por lo que bloquea a lo que puede esperar.

Cada punto dice **por qué** quedó pendiente, no solo qué falta: la mayoría son decisiones
tomadas a conciencia, no olvidos.

---

## 🔴 Bloqueantes

### 1. Correr el script del backend en APEX

**Sin esto el API de evaluaciones está caído.** La tabla cambió (se eliminó `CALIFICACION`,
`CALIFICACION_ESTRELLAS` pasó a `ESCALA`) y el paquete PL/SQL ya está adaptado en el repo,
pero **los scripts no se aplican solos**.

```
SQL Workshop → SQL Scripts → Upload → backend/ethos_evaluaciones_facilitadores.sql → Run
```

Hasta que se corra, `GET`, `POST` y `PUT` de `evaluaciones-facilitadores` fallan porque
`PKG_EVAL_FACILITADORES_ETHOS` no compila contra la estructura vieja.

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
navegador. El APK **no lo necesita** (sus assets ya viajan adentro).

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

### 9. El APK usa el ícono por defecto de Capacitor

Los íconos de la marca ya están hechos en `mobile/assets/`. Ver [`APK.md`](APK.md) →
*Ícono de la app*.

### 10. Firmar el APK release y versionarlo

`assembleRelease` sale sin firmar. Y `android/app/build.gradle` está en `versionCode 1` /
`versionName "1.0"`: hay que subirlos antes de repartir una versión nueva.

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

### 13. Sin rate limiting en el login

El endpoint está expuesto a internet. Si esto pasa a producción, contar intentos fallidos
por usuario/IP y bloquear temporalmente. Ver [`backend/README.md`](backend/README.md).

### 14. El token no se renueva

Dura 6 h fijas, sin renovación deslizante. Al expirar, el usuario vuelve al login.

### 15. `mobile/` quedó sin el módulo de evaluaciones

La app Expo tiene solo login, inicio y cuenta. Ya no es lo que responde a "generá el apk"
—eso ahora es el APK de la web con Capacitor— pero sigue en el repo. Decidir si se
completa, se deja como está o se da de baja.
