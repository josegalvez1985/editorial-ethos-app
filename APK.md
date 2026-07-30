# Generar el APK de Editorial Ethos (Capacitor)

El APK **empaqueta el sitio web adentro**: Capacitor copia `dist/client` a los assets nativos y
la WebView carga esos archivos locales. Config en [`capacitor.config.ts`](capacitor.config.ts)
(`webDir: "dist/client"`, sin `server.url`).

> Como la web viaja dentro del APK, **SÍ** hay que regenerar el APK ante cualquier cambio del
> front (páginas, lógica, estilos, bugfixes). No hay actualización remota del contenido.

## Lo que este proyecto hace distinto

Dos cosas no son opcionales acá, y las dos las resuelve el script:

**1. El build es SPA, no SSR.** El sitio normal se sirve con un servidor Node; dentro del APK no
hay servidor. Con `APK_BUILD=1`, [`vite.config.ts`](vite.config.ts) apaga nitro y prende el modo
SPA de TanStack Start, que prerrenderiza un shell estático en `dist/client/_shell.html`. Capacitor
exige que el punto de entrada se llame `index.html`, así que el script lo copia con ese nombre.

**2. El APK no puede usar el proxy.** La web pega a `/api/ords/` y
[`src/routes/api/ords.$.ts`](src/routes/api/ords.$.ts) reenvía a Oracle — pero eso es **código de
servidor** y en el APK no corre. Por eso el build del APK embebe la URL de ORDS **directa** en
`VITE_API_URL`. Funciona porque ORDS responde con `Access-Control-Allow-Origin: *` (ver
[`backend/README.md`](backend/README.md), donde el CORS abierto está justamente para el cliente
móvil) y porque `androidScheme: "https"` deja el origen en `https://localhost`, sin contenido
mixto.

Si algún día se cierra el CORS de ORDS, **este APK deja de poder loguear** y habría que meter un
plugin de HTTP nativo de Capacitor.

## Requisitos

- **Node 18+** (para `npx cap`).
- **JDK 21** en `C:\Program Files\Java\jdk-21.0.11` — Capacitor 8 / AGP 8 no compila con Java 17.
  Ya está instalado en esta máquina.
- **Android SDK** — ✅ **ya instalado** en `C:\Users\josej\Android\Sdk`, con licencias aceptadas:

  | Paquete | Versión |
  | --- | --- |
  | `cmdline-tools` | `latest` (build 13114758) |
  | `platforms;android-36` | ✅ |
  | `build-tools;36.1.0` | ✅ |
  | `platform-tools` | ✅ (r37) |

  Las versiones son las que piden `compileSdkVersion` / `targetSdkVersion` en
  [`android/variables.gradle`](android/variables.gradle). La ruta se fija en
  `android/local.properties` (`sdk.dir=...`), que **no se commitea**.

> **NO VOLVER A DESCARGARLO.** Ya está. Si `npm run apk` falla en el paso 2, es que la carpeta
> se movió o se borró: verificá primero con `Test-Path "C:\Users\josej\Android\Sdk"` y con
> `Get-ChildItem C:\Users\josej\Android\Sdk` antes de bajar un solo byte. Instalar de nuevo
> encima son ~1,1 GB al pedo.

### Si hay que instalarlo en otra máquina

Solo en ese caso, y verificando antes que no esté ya:

1. Descargar *Command line tools only* de <https://developer.android.com/studio#command-tools>.
2. Descomprimir de modo que quede exactamente
   `<SDK>\cmdline-tools\latest\bin\sdkmanager.bat`
   (la carpeta tiene que llamarse `latest`; si queda `cmdline-tools\cmdline-tools`, renombrala).
   **Extraer a una ruta corta**: las rutas internas de `smali` pasan el límite de 260 caracteres
   de Windows y la extracción falla a mitad de camino con `DirectoryNotFoundException`.
3. Instalar los componentes y aceptar las licencias:

   ```powershell
   $sdk = "C:\Users\josej\Android\Sdk"
   $env:JAVA_HOME = "C:\Program Files\Java\jdk-21.0.11"
   & "$sdk\cmdline-tools\latest\bin\sdkmanager.bat" --sdk_root=$sdk `
       "platform-tools" "platforms;android-36" "build-tools;36.1.0"
   # --licenses es interactivo: hay que alimentarlo con "y"
   $(1..30 | ForEach-Object { "y" }) | & "$sdk\cmdline-tools\latest\bin\sdkmanager.bat" --sdk_root=$sdk --licenses
   ```

Si lo instalás en otra ruta, corregí `sdk.dir` en `android/local.properties` y nada más.

## Build

```powershell
npm run apk          # debug: instalable directo, firmado con la debug key
npm run apk:release  # release: sale SIN firmar (ver "Firmar")
```

Eso corre [`scripts/build-apk.ps1`](scripts/build-apk.ps1), que hace los cinco pasos y corta en el
primero que falle. Para apuntar a otro ORDS sin editar nada:

```powershell
powershell -File scripts\build-apk.ps1 -config debug -apiUrl "https://oracleapex.com/ords/otro/ethos/"
```

Los pasos, si hace falta correrlos a mano desde la raíz:

```powershell
# 1. Java 21 solo para esta sesión (no toca el JAVA_HOME global)
$env:JAVA_HOME = "C:\Program Files\Java\jdk-21.0.11"
$env:Path = "$env:JAVA_HOME\bin;$env:Path"
java --version   # debe decir 21

# 2. Build web en modo SPA, con ORDS directo embebido
$env:APK_BUILD = "1"
$env:VITE_API_URL = "https://oracleapex.com/ords/fundcarac/ethos/"
npm run build
$env:APK_BUILD = ""; $env:VITE_API_URL = ""
Copy-Item dist\client\_shell.html dist\client\index.html -Force

# 3. Sincronizar la web y la config de Capacitor con el proyecto Android
npx cap sync android

# 4. Compilar
cd android
.\gradlew --stop
.\gradlew clean
.\gradlew assembleDebug --stacktrace
# salida: android\app\build\outputs\apk\debug\app-debug.apk
# release: .\gradlew assembleRelease  -> app-release-unsigned.apk
cd ..
```

En PowerShell invocar siempre `.\gradlew` (con `.\`).

Abrir la carpeta del resultado:

```powershell
explorer .\android\app\build\outputs\apk\debug\
```

## Instalar en el celular

1. Copiar `app-debug.apk` al teléfono.
2. Habilitar "Instalar apps de fuentes desconocidas" para el navegador o el gestor de archivos.
3. Abrir el APK e instalar.

El APK debug ya viene firmado con la debug key, así que no hay pasos extra.

El `appId` es `com.editorialethos.app`, **el mismo** que declara la app Expo en
[`mobile/app.json`](mobile/app.json). Si alguna vez llegaste a instalar un APK compilado con EAS,
Android va a rechazar este por firma distinta: desinstalá el anterior primero.

## ¿Cuándo hay que regenerar el APK?

Siempre que cambie algo que viaje dentro del APK:

- **Cambios del front** (rutas, componentes, estilos, lógica de `src/`): SÍ, porque la web está
  empaquetada. Un deploy del sitio **no** actualiza la app instalada.
- **Cambios nativos**: ícono, `appName`, `appId`, plugins de Capacitor, `versionName` /
  `versionCode`.
- **Cambio de la URL de ORDS**: SÍ, queda embebida en el bundle.

Un cambio del backend (`backend/*.sql`) no necesita APK nuevo, salvo que cambie el contrato de la
API.

## Versión

[`android/app/build.gradle`](android/app/build.gradle) → `versionCode` / `versionName`
(actualmente `1` / `"1.0"`). Subirlos antes de repartir una versión nueva; Android se niega a
instalar encima un `versionCode` menor o igual.

## Ícono de la app

Ya está el de la marca: los `mipmap-*`, el adaptive icon y el splash se generaron desde
[`assets/icon.png`](assets/) (1024×1024, el mismo que usa la app Expo) y **están commiteados** en
`android/app/src/main/res/`. No hay que hacer nada en cada build.

Para volver a generarlos —si cambia el logo— reemplazá `assets/icon.png` y corré:

```powershell
npx @capacitor/assets generate --android --iconBackgroundColor "#ffffff" --splashBackgroundColor "#ffffff"
```

**Con `npx`, no como dependencia del proyecto.** `@capacitor/assets` estuvo un rato en
`devDependencies` y hubo que sacarlo: arrastra un `@capacitor/cli@5.7.8` viejo además del 8.4.1
real —lo que rompía `npm ci` en GitHub Actions con `Missing: lru-cache@11.5.2 from lock file`— y
un `sharp@0.32.6` nativo que el runner tenía que compilar con `node-gyp` para nada, porque los
íconos ya están generados. Es una herramienta de un solo uso, no una dependencia de build.

Después de regenerarlos, hay que recompilar el APK.

## Firmar el APK release

`assembleRelease` sale sin firmar y **no se instala así**. Para firmarlo:

```powershell
# Crear un keystore propio. Guardar la contraseña aparte; NO commitear el .jks.
keytool -genkey -v -keystore ethos-release.jks -keyalg RSA -keysize 2048 -validity 10000 -alias ethos

$bt = "C:\Users\josej\Android\Sdk\build-tools\36.1.0"
& "$bt\apksigner.bat" sign --ks ethos-release.jks `
    --out ethos-release.apk `
    android\app\build\outputs\apk\release\app-release-unsigned.apk
& "$bt\apksigner.bat" verify ethos-release.apk
```

Para automatizarlo, agregar un `signingConfig` en `android/app/build.gradle` que lea el keystore
desde variables de entorno.

## Relación con la app Expo de `mobile/`

Este APK y la app Expo son **dos implementaciones distintas** del mismo producto. Hoy el APK que
se genera es este, el de la web. Lo que eso implica:

- **A favor:** trae el módulo de evaluaciones completo. La app Expo solo tiene login, inicio y
  cuenta.
- **En contra:** se pierde la biometría real (`expo-local-authentication` + keystore del sistema).
  En la WebView, el botón de biometría del login web solo avisa que no está disponible.

`mobile/` sigue en el repo y se puede compilar a mano con EAS (`cd mobile && npm run build:apk`),
pero ya no es lo que responde a "generá el apk".

## Notas

- `appId` = `com.editorialethos.app`, `appName` = "Editorial Ethos".
- La carpeta `android/` se commitea; sus artefactos de build los ignora `android/.gitignore`,
  igual que `local.properties` y los `*.apk`.
- El backend ([`backend/ethos_auth.sql`](backend/ethos_auth.sql)) tiene que estar corrido o el
  login no entra, igual que en la web.
- El token de ORDS dura 6 h y no se renueva: a las 6 h, de vuelta al login.
