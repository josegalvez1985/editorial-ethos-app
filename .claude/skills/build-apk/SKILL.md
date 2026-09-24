---
name: build-apk
description: Compila el APK de Android de Juventud con Valores, una cáscara de Capacitor que abre el sitio publicado (build local con Gradle). Úsala cuando el usuario pida "genera el apk", "compila el apk", "build de Android", "hazme el instalable" o "regenera la app". Cubre cuándo hace falta de verdad, las precondiciones, el build y la entrega del archivo.
---

# Generar el APK de Juventud con Valores

El APK es una **cáscara de Capacitor**: su WebView abre <https://www.ethospy.online/>
(`server.url` en `capacitor.config.ts`) y no trae las pantallas adentro. El build es **local con
Gradle**, no en la nube.

Doc completa: [`APK.md`](../../../APK.md). Léela si algo no encaja con lo de acá.

**No compiles la app Expo de `mobile/`.** Sigue en el repo, pero "el apk" es este. Si el usuario
pide explícitamente el de Expo, eso es `cd mobile && npx eas-cli build --platform android
--profile preview` y necesita cuenta de Expo + login interactivo.

## 0. ¿Hace falta de verdad?

Casi nunca. Un cambio de front (pantallas, formularios, estilos, lógica de `src/`) **llega a los
teléfonos con el push**, sin APK. Hace falta uno nuevo solo por un cambio nativo (plugin, ícono,
splash, nombre visible, permisos, `minSdkVersion` / `targetSdkVersion`), por un cambio de
`server.url`, o para instalarlo en un teléfono que todavía no tiene la 2.0.

Si el pedido viene por un cambio de front, decíselo al usuario antes de compilar. La tabla
completa está en el README → *¿Hay que repartir un APK nuevo? Casi nunca*.

## 1. En esta PC todavía NO se puede compilar (verificado el 24/09/2026)

El proyecto se mudó de PC (`C:\Users\josej\…` → `C:\Users\joseg\…`). En la actual **no están**:

| Qué | Dónde lo busca el build |
| --- | --- |
| JDK 21 | `C:\Program Files\Java\jdk-21.0.11`, fijo en `scripts/build-apk.ps1`. El `java` del PATH es `C:\orant\jdk`, que no sirve |
| Android SDK | `sdk.dir` en `android/local.properties`, que tampoco existe |
| Clave de firma | `ethos-release.jks` (raíz) + `android/keystore.properties` |

Antes de nada, comprobá si sigue siendo así:

```powershell
Test-Path "C:\Program Files\Java\jdk-21.0.11"
Get-Content android\local.properties
Test-Path ethos-release.jks; Test-Path android\keystore.properties
```

Si falta algo, **no instales ni descargues nada sin preguntarle al usuario** (el SDK son ~1,1 GB):
contale qué falta y remitilo a `APK.md` → *Requisitos*. **La clave de firma no se puede
regenerar**: hay que traerla del respaldo, porque un release firmado con otra clave no se instala
encima de la app que ya está en los teléfonos.

No te guíes por docs de otros proyectos de Jose que ubican el SDK en
`C:\Program Files\Android\cmdline-tools`: mirá `android/local.properties` y el disco.

## 2. El comando

Desde la raíz del proyecto:

```powershell
npm run apk          # release firmado con la clave propia  <- el que se reparte
npm run apk:debug    # debug: más rápido, pero Play Protect lo bloquea al instalar
```

**Mostrá cada paso que ejecutás.** Jose lo pidió explícitamente: nada de `run_in_background` ni de
salidas recortadas que escondan el log. Y antes de decir "listo", verificá que el `.apk` exista en
disco — una fecha de archivo no es prueba de nada.

Eso corre `scripts/build-apk.ps1`, que hace los pasos en orden (Java 21 → SDK → build web SPA →
`cap sync` → Gradle → reporte) y **corta en el primero que falla**. No repitas los pasos a mano
salvo que estés diagnosticando algo.

**En primer plano y SIN PIPES.** `npm run apk` crudo, con `timeout: 600000`. Nada de
`run_in_background`, nada de `| grep` ni `| tail` para acortar el log: el pipe lo retiene en
buffer, no se ve una sola línea mientras corre, y si el build se pasa del timeout el harness lo
manda a segundo plano con el archivo de salida **vacío**. Pasó el 31/07/2026 y hubo que matar el
proceso y correr `android\gradlew --stop` para destrabar el daemon antes de reintentar.

Un build limpio tarda ~1,5 min de Gradle más el build web.

## 3. Qué revisar antes de dar el APK por bueno

- El script imprime la ruta del `.apk` y su tamaño. **Si no imprimió eso, el build no terminó** —
  no digas que está listo.
- El build web del script es solo la copia local que exige `cap sync`, y **no se muestra**
  mientras exista `server.url`. Por eso `-apiUrl` no cambia el ORDS de los teléfonos: ese es el
  del sitio publicado (`VITE_API_URL` en `.github/workflows/deploy.yml`).
- Si el login falla con un error de CORS, el problema es el backend, no el APK: el sitio y el APK
  le pegan directo a ORDS.

## 4. Entregar el resultado

Dale al usuario:

- La ruta del APK, que es de donde Jose lo copia a mano:
  - release: `android\app\build\outputs\apk\release\app-release.apk`
  - debug: `android\app\build\outputs\apk\debug\app-debug.apk`

  **No lo copies a `public\app.apk` ni menciones esa ruta.** Jose pidió sacar esa copia
  (31/07/2026): el sitio ya no ofrece la descarga, así que solo dejaba un binario viejo en
  `public/` que el build siguiente volvía a empaquetar adentro del APK.
- Cómo instalarlo: copiarlo al teléfono, habilitar "instalar apps de fuentes desconocidas" para
  la app con la que se abre, y abrirlo. Se reparte el release; el debug lo bloquea Play Protect.
- Que los cambios de front **no dependen de este APK**: los teléfonos con la 2.0 o superior los
  ven con el push.

Si Gradle falla, leé el error real del `--stacktrace` y reportá la causa. No digas "listo" con un
build en rojo.

## 5. Antes de una versión para repartir

- Subir `versionCode` / `versionName` en `android/app/build.gradle` (hoy `15` / `"2.0"`). Android
  no instala encima un `versionCode` menor o igual.
- El release se firma **solo**, con `ethos-release.jks` vía `android/keystore.properties`. Si el
  archivo de salida se llama `app-release-unsigned.apk`, falta ese `keystore.properties`.
- El ícono y el splash ya son los de la marca (04/08/2026) y están commiteados en
  `android/app/src/main/res/`: no hay que regenerarlos en cada build.
- El backend `backend/auth.sql` tiene que estar corrido o el login no entra.
