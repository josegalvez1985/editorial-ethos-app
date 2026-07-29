---
name: build-apk
description: Compila el APK (o AAB) de Android de la app Expo en mobile/. Úsala cuando el usuario pida "genera el apk", "compila el apk", "build de Android", "hazme el instalable", "sácame el aab" o "súbelo a Play Store". Cubre las precondiciones de EAS, el build en la nube y la entrega del enlace de descarga.
---

# Generar el APK de Editorial Ethos

La app Android vive en `mobile/` (Expo SDK 57, expo-router). El build se hace
**en la nube con EAS**.

El repo tiene **dos frontends**: `mobile/` (esta app) y la raíz (sitio web TanStack
Start + Vite). Comparten el backend `backend/` pero no el código. Esta skill cubre
solo el APK; un cambio de UI aquí **no** sale en la web.

**Esta máquina no tiene Android SDK, `adb` ni Java**, así que `eas build --local` va a fallar.
No lo intentes ni propongas instalar Android Studio salvo que el usuario lo pida.

Todos los comandos se corren desde `mobile/`, con **npm** (no bun — la raíz usa bun, `mobile/` no).

## 1. Precondiciones (verifícalas antes de compilar)

Corre estas comprobaciones y resuelve lo que falle antes de seguir:

```bash
cd mobile
npx eas-cli --version     # instala eas-cli si falta
npx eas-cli whoami        # debe imprimir el usuario de Expo
```

- **`eas-cli` no instalado** → `npm install -g eas-cli` (o usa `npx eas-cli` en todo).
- **`whoami` falla / "Not logged in"** → **PARA aquí.** `eas login` es interactivo y pide
  contraseña; no puedes hacerlo tú. Dile al usuario que corra `eas login` en su terminal y
  te avise. No pidas ni aceptes credenciales.
- **Falta `extra.eas.projectId` en `mobile/app.json`** → hace falta `eas init`, que también es
  interactivo (pregunta por la cuenta/slug). Pídele al usuario que lo corra.

## 2. Pre-vuelo local

Antes de gastar una cola de build en la nube, confirma que el proyecto compila:

```bash
npx tsc --noEmit
npx expo export --platform android --output-dir "$SCRATCH/export-check" --clear
```

Usa el scratchpad de la sesión para `--output-dir`; no dejes `dist/` en el repo.
Si algo falla aquí, arréglalo antes de lanzar el build — un error de bundle también
tumba el build remoto, pero 15 minutos después.

## 3. Lanzar el build

APK instalable directo (lo que el usuario suele querer):

```bash
npx eas-cli build --platform android --profile preview --non-interactive
```

AAB para Play Store:

```bash
npx eas-cli build --platform android --profile production --non-interactive
```

Los perfiles están en `mobile/eas.json`: `preview` → `buildType: apk`, `production` → `app-bundle`.

**Corre el build en background** (`run_in_background: true`): tarda entre 10 y 25 minutos según
la cola de EAS. Mientras esperas, no hagas polling con sleeps — te llega la notificación al
terminar. Si necesitas revisar el avance, lee el archivo de salida de la tarea.

`--non-interactive` falla si EAS necesita generar un keystore nuevo y no hay ninguno.
Si el error menciona *keystore* o *credentials*, quita `--non-interactive` y dile al usuario
que responda la pregunta de credenciales en su propia terminal (EAS puede generar y
guardar el keystore por él; es la opción recomendada).

## 4. Entregar el resultado

Al terminar, EAS imprime una URL de la build en `expo.dev` y un enlace directo al `.apk`.
**Dale ambos al usuario**, más:

- Cómo instalarlo: descargar el APK en el Android y abrirlo; hay que permitir
  "instalar apps de orígenes desconocidos" para el navegador/gestor de archivos.
- El icono que verá es el adaptativo de `mobile/assets/android-icon-*.png`.

Si el build falla, lee los logs con `npx eas-cli build:view` o el enlace de la build,
y reporta la causa real — no digas "listo" con un build en rojo.

## 5. Antes de una versión pública

Estos puntos no bloquean un APK de prueba, pero sí una publicación. Menciónalos si el
usuario habla de Play Store o de repartir el APK fuera de su equipo:

- `version` y `android.versionCode` en `mobile/app.json` (el perfil `production` ya usa
  `autoIncrement`, y `eas.json` tiene `appVersionSource: "remote"`).
- El `package` es `com.editorialethos.app`; cambiarlo después de publicar crea otra app.
- **`expo.extra.apiUrl` en `mobile/app.json`** queda embebido en el APK. Confirma que
  apunta al ORDS correcto ANTES de compilar; cambiarlo después obliga a recompilar.
  El backend (`backend/ethos_auth.sql`) tiene que estar corrido o el login no entra.
- El login es real contra Oracle APEX/ORDS, pero el contenido de `app/(tabs)/home.tsx`
  sigue siendo mockup embebido, no una API.
