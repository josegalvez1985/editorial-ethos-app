---
name: build-apk
description: Compila el APK de Android de Editorial Ethos empaquetando el sitio web con Capacitor (build local con Gradle). Úsala cuando el usuario pida "genera el apk", "compila el apk", "build de Android", "hazme el instalable" o "regenera la app". Cubre las precondiciones, el build y la entrega del archivo.
---

# Generar el APK de Editorial Ethos

El APK **empaqueta el sitio web** (`src/`, TanStack Start) dentro de una WebView con Capacitor.
El build es **local con Gradle**, no en la nube.

Doc completa: [`APK.md`](../../../APK.md). Léela si algo no encaja con lo de acá.

**No compiles la app Expo de `mobile/`.** Sigue en el repo, pero "el apk" es este. Si el usuario
pide explícitamente el de Expo, eso es `cd mobile && npx eas-cli build --platform android
--profile preview` y necesita cuenta de Expo + login interactivo.

## 1. El comando

Desde la raíz del proyecto:

```powershell
npm run apk          # release firmado con la clave propia  <- el que se reparte
npm run apk:debug    # debug: más rápido, pero Play Protect lo bloquea al instalar
```

**Mostrá cada paso que ejecutás.** Jose lo pidió explícitamente: nada de `run_in_background` ni de
salidas recortadas que escondan el log. Y antes de decir "listo", verificá que el `.apk` exista en
disco — una fecha de archivo no es prueba de nada.

Eso corre `scripts/build-apk.ps1`, que hace los cinco pasos en orden (Java 21 → build web SPA →
`cap sync` → Gradle → reporte) y **corta en el primero que falla**. No repitas los pasos a mano
salvo que estés diagnosticando algo.

**Corre el build en background** (`run_in_background: true`): tarda ~4 minutos con todo cacheado.
Esperá la notificación, no hagas polling.

## 2. Todo lo que hace falta YA ESTÁ INSTALADO. No descargues nada.

Esta máquina tiene todo lo necesario. **Comprobado y funcionando** (build exitoso del 30/07/2026):

| | Dónde |
| --- | --- |
| JDK 21 | `C:\Program Files\Java\jdk-21.0.11` |
| Android SDK | `C:\Users\josej\Android\Sdk` (android-36, build-tools 36.1.0, platform-tools, licencias aceptadas) |
| Gradle 8.14.3 | cacheado en `~/.gradle/wrapper/dists` |
| Capacitor + `android/` | en el repo |

**NUNCA instales ni descargues nada sin verificar primero que falta, y sin preguntarle al
usuario.** Bajar el SDK de nuevo son ~1,1 GB en su disco y su conexión, para nada.

Si el paso 2 del script falla:

```powershell
Test-Path "C:\Users\josej\Android\Sdk"          # ¿existe?
Get-ChildItem "C:\Users\josej\Android\Sdk"      # ¿qué tiene adentro?
Get-Content android\local.properties            # ¿a dónde apunta sdk.dir?
```

Lo más probable es que sea un `sdk.dir` mal apuntado, no un SDK ausente — se arregla editando
`android/local.properties`, una línea, sin descargar nada. Solo si esas comprobaciones muestran
que de verdad no está, pedile permiso al usuario antes de instalar y seguí *Si hay que instalarlo
en otra máquina* de `APK.md`.

**Nota histórica, para no repetir el error:** hay docs de otros proyectos de Jose que dicen que el
SDK va en `C:\Program Files\Android\cmdline-tools`. Esa ruta **nunca existió** en esta máquina: el
SDK real está en `C:\Users\josej\Android\Sdk`, que es a donde apunta
`android/local.properties`. No te guíes por un doc de otro proyecto: mirá el disco.

## 3. Qué revisar antes de dar el APK por bueno

- El script imprime la ruta del `.apk` y su tamaño. **Si no imprimió eso, el build no terminó** —
  no digas que está listo.
- La URL de ORDS queda **embebida** en el bundle. Por defecto
  `https://oracleapex.com/ords/fundcarac/ethos/`. Si el usuario necesita otra, pasala:
  `powershell -File scripts\build-apk.ps1 -config debug -apiUrl "..."`. Cambiarla después obliga a
  recompilar.
- Dentro del APK **no corre** el proxy `src/routes/api/ords.$.ts`. Es normal y está previsto: el
  front pega directo a ORDS. Si el login falla con error de CORS, el problema es el backend, no el
  APK.

## 4. Entregar el resultado

El script termina imprimiendo `=== APK listo (N MB) ===` con la ruta. **Si no imprimió eso, el
build no terminó** — no digas que está listo.

Dale al usuario:

- La ruta del APK: `android\app\build\outputs\apk\debug\app-debug.apk`, y que el script ya lo
  copió a `public\app.apk` (nombre fijo, sobrescribe el anterior).
- Cómo instalarlo: copiarlo al teléfono, habilitar "instalar apps de fuentes desconocidas" y
  abrirlo. El debug ya viene firmado con la debug key.
- Si hubo cambios de front en esta sesión, decí que ese APK ya los incluye — y que un cambio
  posterior necesita un APK nuevo, porque la web viaja adentro.

Si Gradle falla, leé el error real del `--stacktrace` y reportá la causa. No digas "listo" con un
build en rojo.

## 5. Antes de una versión para repartir

- Subir `versionCode` / `versionName` en `android/app/build.gradle`. Android no instala encima un
  `versionCode` menor o igual.
- El release se firma **solo**, con `ethos-release.jks` vía `android/keystore.properties`. Si el
  archivo de salida se llama `app-release-unsigned.apk`, falta ese `keystore.properties`.
- El ícono actual es el de Capacitor por defecto, no el de la marca (`APK.md` → *Ícono de la app*).
- El backend `backend/ethos_auth.sql` tiene que estar corrido o el login no entra.
