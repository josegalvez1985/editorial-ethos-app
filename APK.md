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

Lo normal es el script, que hace todo esto y **corta en el primer paso que falle**:

```powershell
npm run apk          # release firmado con la clave propia  <- el que se reparte
npm run apk:debug    # debug: compila más rápido, pero Play Protect lo bloquea
```

Para apuntar a otro ORDS sin editar nada:

```powershell
powershell -File scripts\build-apk.ps1 -config release -apiUrl "https://oracleapex.com/ords/otro/ethos/"
```

### Los pasos a mano

Si hay que diagnosticar algo, los mismos pasos uno por uno. Abrir PowerShell **en la raíz del
proyecto** y ejecutar en orden:

```powershell
# 1. Ir a la raíz del proyecto
cd C:\Users\josej\OneDrive\Desktop\Proyectos\editorial-ethos-app.git

# 2. Configurar Java 21 solo para esta sesión (no afecta JAVA_HOME global)
$env:JAVA_HOME = "C:\Program Files\Java\jdk-21.0.11"
$env:Path = "$env:JAVA_HOME\bin;$env:Path"

# 3. Verificar que Java 21 está activo
java --version

# 4. Build web en modo SPA, con la URL de ORDS embebida
#    APK_BUILD=1 apaga nitro y prende el modo SPA (ver vite.config.ts).
$env:APK_BUILD = "1"
$env:VITE_API_URL = "https://oracleapex.com/ords/fundcarac/ethos/"
npm run build
$env:APK_BUILD = ""; $env:VITE_API_URL = ""

# 5. Capacitor exige que el punto de entrada se llame index.html;
#    el prerender lo deja como _shell.html.
Copy-Item dist\client\_shell.html dist\client\index.html -Force

#    Sacar el APK anterior del bundle, o el nuevo lo empaqueta adentro.
Remove-Item dist\client\app.apk -Force -ErrorAction SilentlyContinue

# 6. Sincronizar con Android (IMPORTANTE: desde la raíz, no desde android/)
npx cap sync android

# 7. Entrar al directorio android
cd android

# 8. Detener daemon de Gradle previo (por si quedó con otro JDK)
.\gradlew --stop

# 9. Limpiar caché de Gradle del proyecto (solo si algo quedó raro;
#    en un build normal alcanza con el clean del paso 10)
Remove-Item -Recurse -Force .\.gradle -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force .\app\build -ErrorAction SilentlyContinue

# 10. Limpiar build
.\gradlew clean

# 11. Generar el APK firmado de release (con stacktrace si hay error)
.\gradlew assembleRelease --stacktrace

cd ..
```

En PowerShell invocar siempre `.\gradlew` (con `.\`), nunca `./gradlew`.

## Resultado

El APK se genera en:

```
android\app\build\outputs\apk\release\app-release.apk
```

> Si el archivo se llama `app-release-**unsigned**.apk`, Gradle **no encontró la firma**: falta
> `android\keystore.properties`. Ese APK no se instala. Ver *Firma* más abajo.

**El script no lo copia a ningún otro lado**: se reparte desde ahí. Antes lo duplicaba en
`public\app.apk` para que el sitio ofreciera la descarga, pero el sitio ya no la ofrece
(`DESCARGA_APK_URL` está en `""`), así que esa copia solo dejaba un binario viejo en `public/`
que el build web volvía a empaquetar dentro del APK siguiente.

Para abrir la carpeta directamente al terminar:

```powershell
explorer .\android\app\build\outputs\apk\release\
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

## Firma

**Ya está automatizada.** [`android/app/build.gradle`](android/app/build.gradle) lee
`android/keystore.properties` y firma el release solo. No hay que correr `apksigner` a mano.

| Archivo | Qué es |
| --- | --- |
| `ethos-release.jks` (raíz) | El keystore. `CN=Editorial Ethos, O=Editorial Ethos, L=Asuncion, C=PY` |
| `android/keystore.properties` | Ruta del `.jks`, alias y contraseñas |

Los dos están en `.gitignore` y **no se commitean**.

> **RESPALDALOS FUERA DEL PROYECTO, HOY.**
> Si se pierde cualquiera de los dos, **no se puede volver a actualizar la app instalada**:
> Android exige que toda actualización esté firmada con la misma clave. No hay recuperación. La
> única salida sería publicar con otro `appId` y que todos reinstalen desde cero.

Verificar con qué clave quedó firmado un APK:

```powershell
$bt = "C:\Users\josej\Android\Sdk\build-tools\36.1.0"
& "$bt\apksigner.bat" verify --print-certs --verbose android\app\build\outputs\apk\release\app-release.apk
```

Lo que hay que ver:

```
Signer #1 certificate DN: CN=Editorial Ethos, ...   <- correcto
Verified using v2 scheme: true
Verified using v3 scheme: true                      <- necesario, ver abajo
```

Si dice `CN=Android Debug`, es un APK **debug**: esa clave es pública y la comparten todos los
proyectos Capacitor, por eso **Play Protect lo bloquea**. Hay que compilar con `npm run apk`.

### Play Protect: "Se bloqueó la app para proteger tu dispositivo"

Tiene dos causas distintas, y conviene no confundirlas:

1. **Firmado con la debug key** → se arregla compilando el release (arriba).
2. **Clave propia sin reputación** → **no se arregla compilando.** Google no conoce el
   certificado, y en apps repartidas fuera de Play eso genera el aviso igual. Salidas:
   - Tocar **"Más detalles" → "Instalar de todos modos"**.
   - Instalar por USB, que saltea Play Protect:
     `adb install -r android\app\build\outputs\apk\release\app-release.apk`.
   - Publicar en Play Store, donde Google re-firma con su propia clave y el aviso desaparece.
     Eso requiere un `.aab` (`.\gradlew bundleRelease`), no un APK.

El `signingConfig` fuerza **v1 + v2 + v3**. El v3 importa: es el esquema que le permite a Android
verificar la identidad de la clave, y sin él la firma queda como no verificable, que es una de las
señales que empujan a Play Protect a bloquear. AGP por defecto solo emite v2.

## Acceso biométrico — SOLO en el APK

**Implementado.** El usuario lo activa desde **Mi cuenta → Seguridad** y a partir de
ahí entra con la huella, sin escribir la contraseña. Código en
[`src/lib/biometria.ts`](src/lib/biometria.ts).

**No existe en la web ni en la PWA**, y eso no es una limitación pendiente: es la
condición para que sea aceptable. En un navegador no hay Keystore, así que guardar la
contraseña ahí sería `localStorage` en texto plano — exactamente lo que se sacó de
este proyecto. `enApp()` corta en seco si no hay puente nativo de Capacitor, así que
en el navegador el switch no se pinta y el botón del login no aparece.

### Qué se guarda y qué no

| | Dónde vive | Sobrevive a cerrar la app |
| --- | --- | --- |
| Token de sesión | Memoria, nada más | **No** — sigue igual que siempre |
| Contraseña | Keystore de Android, cifrada por hardware | Sí, **solo si el usuario activó la huella** |
| Usuario | `localStorage` (dato no sensible) | Sí, con "Recordar mi usuario" |

La huella **no restaura la sesión**: destapa la contraseña y con ella se rehace el
`POST auth/login` contra el backend, que valida como siempre. Un token vencido no se
revive por tener huella.

### El modo de guardado importa

`setCredentials({ accessControl: BIOMETRY_ANY })` + `getSecureCredentials()`. Eso ata
la clave del Keystore a un `CryptoObject`: **cada lectura exige un `BiometricPrompt`
vivo**, y ningún otro punto del código de la app puede leer la contraseña sin él.
`authValidityDuration` queda en 0 (el default) justamente para eso — cualquier valor
mayor abre una ventana en la que el secreto se puede leer en silencio.

Se usa `BIOMETRY_ANY` y no `BIOMETRY_CURRENT_SET` porque este último invalida la
credencial cuando el usuario registra una huella nueva: agrega un dedo y el acceso
deja de andar sin ninguna explicación.

`isAvailable({ useFallback: false })`: el PIN del equipo **no** alcanza para destapar
la contraseña. Si se aceptara, cualquiera que sepa el PIN entra a la cuenta, que es
justo lo que la huella tiene que evitar.

### El permiso va en el manifest de la app

`USE_BIOMETRIC` **no lo trae el plugin** — su `AndroidManifest.xml` solo declara la
`AuthActivity`. Está agregado a mano en
[`android/app/src/main/AndroidManifest.xml`](android/app/src/main/AndroidManifest.xml).
Sin esa línea el `BiometricPrompt` falla en runtime aunque el código JS esté perfecto
y el celular tenga lector.

### Las tres causas que hicieron perder un día

Ninguna es un bug del código y las tres se ven igual desde afuera —"el botón no
aparece"—, así que conviene descartarlas **antes** de tocar nada:

**1. Sin bloqueo de pantalla NO hay biometría.** La más común y la menos evidente. El
Keystore de Android exige que el dispositivo tenga **PIN, patrón o contraseña** para
poder cifrar secretos. Sin eso `isAvailable()` devuelve `false` aunque el celular
tenga lector de huellas. Es una restricción del sistema operativo, no algo que se
pueda sortear desde la app: hacen falta bloqueo de pantalla **y** al menos una huella
registrada. Un celular sin bloqueo instala el APK perfecto y todo lo demás funciona;
solo la biometría queda muerta.

Por eso `disponible()` devuelve el **motivo** y no un booleano: `deviceIsSecure`
distingue "poné un PIN" de "registrá una huella", y el switch de Mi cuenta muestra esa
diferencia, que es la que el usuario necesita para poder resolverlo.

**2. Guardar la contraseña es el precio.** El token dura 6 h y no se renueva, así que
para reentrar sin escribir nada hay que repetir el `POST auth/login` — y para eso hay
que guardar la contraseña en algún lado. En el navegador eso significa `localStorage`
en texto plano. La combinación que lo evita es token en memoria + contraseña en el
Keystore detrás de la huella, y **solo funciona en el APK**: es exactamente lo que
está implementado.

### 2. "Fuentes desconocidas" es por app instaladora, no por APK

El permiso se concede a **la app que abre el archivo**, no al archivo. Si lo
habilitaste para Chrome pero después abrís el APK desde el gestor de archivos,
Android lo vuelve a bloquear: hay que habilitarlo también para el gestor.

Y Android **no abre el instalador solo** al terminar una descarga web: el usuario
tiene que tocar la notificación.

### 3. `npx cap sync android` es obligatorio tras instalar un plugin

Sin ese paso el plugin no existe en runtime y los errores son confusos —del tipo
*"plugin not implemented"*— que parecen problemas de código. El script ya lo hace;
solo importa si se compila a mano.

Comprobación: el sync tiene que imprimir el plugin.

```
[info] Found 1 Capacitor plugin for android:
       @capgo/capacitor-native-biometric@8.6.2
```

### Diagnosticar el WebView con DevTools

El APK es una WebView, así que se depura con las DevTools de Chrome completas:
**`chrome://inspect`** en el escritorio, con el celular conectado por USB y
depuración activada. Da consola, red y breakpoints sobre la app corriendo en el
teléfono — dos minutos contra horas de adivinar. Los `console.warn` de
[`lib/biometria.ts`](src/lib/biometria.ts) aparecen ahí.

### Orden de trabajo

Probar todo junto hace imposible saber qué está roto. El orden que funciona:

1. Sesión persistente **en el navegador**
2. APK básico, sin biometría
3. Instalarlo y verificar que abre
4. **Recién ahí** la biometría

### Desinstalar antes de cambiar de firma

Android **no instala encima** una app firmada con otra clave: falla con
`INSTALL_FAILED_UPDATE_INCOMPATIBLE`. Al pasar de un APK debug a uno release —o al revés— hay que
desinstalar el anterior primero, y se pierden los datos locales (sesión guardada, preferencias).

## Relación con la app Expo de `mobile/`

Este APK y la app Expo son **dos implementaciones distintas** del mismo producto. Hoy el APK que
se genera es este, el de la web. Lo que eso implica:

- **A favor:** trae el módulo de evaluaciones completo. La app Expo solo tiene login, inicio y
  cuenta. Y desde la v1.5 **también tiene biometría real**, vía
  `@capgo/capacitor-native-biometric` contra el mismo Keystore del sistema que usa Expo.
- **En contra:** ya casi nada. La diferencia que queda es de implementación, no de capacidades.

`mobile/` sigue en el repo y se puede compilar a mano con EAS (`cd mobile && npm run build:apk`),
pero ya no es lo que responde a "generá el apk".

## Notas

- `appId` = `com.editorialethos.app`, `appName` = "Editorial Ethos".
- La carpeta `android/` se commitea; sus artefactos de build los ignora `android/.gitignore`,
  igual que `local.properties` y los `*.apk`.
- El backend ([`backend/ethos_auth.sql`](backend/ethos_auth.sql)) tiene que estar corrido o el
  login no entra, igual que en la web.
- El token de ORDS dura 6 h y no se renueva: a las 6 h, de vuelta al login.
