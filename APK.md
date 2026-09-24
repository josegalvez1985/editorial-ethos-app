# Generar el APK de Juventud con Valores (Capacitor)

**El APK es una cáscara**: su WebView abre <https://www.ethospy.online/> con `server.url` (ver
[`capacitor.config.ts`](capacitor.config.ts)) cada vez que arranca. No trae las pantallas
adentro, así que **un `git push` actualiza los teléfonos** sin compilar nada, siempre que tengan
la 2.0 o superior.

Este documento es para lo que el push **no** cambia: un plugin nativo, el ícono, el splash, el
nombre visible, los permisos del manifest, la URL del sitio y el `versionCode`. La tabla de qué
pide APK nuevo y qué no está en el
[README](README.md#hay-que-repartir-un-apk-nuevo-casi-nunca).

> Hasta la 1.9.2 el APK empaquetaba la web y se actualizaba con el plugin OTA de Capgo, que no
> funcionó en la práctica. Se reemplazó el 05/08/2026; la historia está en el README y en
> `capacitor.config.ts`. `OTA.md` ya no existe.

## Lo que conviene saber antes de compilar

**1. El script sigue haciendo el build web, pero eso no es lo que se ve.** `npx cap sync` exige
que exista `webDir` (`dist/client`), así que el script compila el sitio en modo SPA
(`APK_BUILD=1`, ver [`vite.config.ts`](vite.config.ts)) y Capacitor lo copia adentro. Mientras
`server.url` esté puesta **esos archivos no se usan**: quedan como último recurso por si algún
día se quita la URL. Por lo mismo, el `-apiUrl` del script solo afecta a esa copia; el ORDS que
usan los teléfonos es el del sitio publicado, que se define en
[`deploy.yml`](.github/workflows/deploy.yml).

**2. Ni el APK ni el sitio publicado usan el proxy.** GitHub Pages es estático, así que
[`src/routes/api/ords.$.ts`](src/routes/api/ords.$.ts) no corre y el navegador —o la WebView—
le pega directo a ORDS. Funciona porque ORDS responde con `Access-Control-Allow-Origin: *`. Si
algún día se cierra ese CORS, **dejan de poder loguear el sitio y el APK**.

**3. La regla de oro:** antes de compilar, abrí <https://www.ethospy.online/> en el navegador
del celular. Si ahí funciona, el APK va a funcionar, porque es ese mismo sitio en una WebView.
Si ahí no funciona, un APK nuevo no lo arregla.

## Requisitos

| Qué | Dónde lo busca el build | En la PC actual (`C:\Users\joseg\…`, 24/09/2026) |
| --- | --- | --- |
| **JDK 21** | `C:\Program Files\Java\jdk-21.0.11`, ruta fija en [`scripts/build-apk.ps1`](scripts/build-apk.ps1) | **No está.** El `java` del PATH es `C:\orant\jdk`, que no sirve |
| **Android SDK**: `platforms;android-36`, `build-tools;36.1.0`, `platform-tools` | `sdk.dir` en `android/local.properties`, que no se commitea | **No está**, y tampoco `local.properties` |
| **Clave de firma**: `ethos-release.jks` + `android/keystore.properties` | la raíz del repo y `android/`; no se commitean | **No está.** Ver [Firma](#firma) |
| Node 18+ | — | sí |

Todo eso estaba en la PC anterior (`C:\Users\josej\…`): el JDK en la misma ruta y el SDK en
`C:\Users\josej\Android\Sdk`. **Antes de instalar nada, confirmá que de verdad falta** (el SDK
son ~1,1 GB) y, sobre todo, **recuperá la clave de firma del respaldo**: sin ella no se puede
actualizar la app que ya está en los teléfonos.

Capacitor 8 / AGP 8 no compila con Java 17: tiene que ser el 21. Las versiones del SDK son las
que piden `compileSdkVersion` / `targetSdkVersion` en
[`android/variables.gradle`](android/variables.gradle).

### Instalar las herramientas en una PC nueva

Verificando antes que no estén ya:

1. **JDK 21** en `C:\Program Files\Java\jdk-21.0.11`, o en otra ruta corrigiendo la línea
   `$env:JAVA_HOME` de [`scripts/build-apk.ps1`](scripts/build-apk.ps1).
2. Descargar *Command line tools only* de <https://developer.android.com/studio#command-tools>.
3. Descomprimir de modo que quede exactamente
   `<SDK>\cmdline-tools\latest\bin\sdkmanager.bat`
   (la carpeta tiene que llamarse `latest`; si queda `cmdline-tools\cmdline-tools`, renombrala).
   **Extraer a una ruta corta**: las rutas internas de `smali` pasan el límite de 260 caracteres
   de Windows y la extracción falla a mitad de camino con `DirectoryNotFoundException`.
4. Instalar los componentes y aceptar las licencias:

   ```powershell
   $sdk = "C:\Users\joseg\Android\Sdk"
   $env:JAVA_HOME = "C:\Program Files\Java\jdk-21.0.11"
   & "$sdk\cmdline-tools\latest\bin\sdkmanager.bat" --sdk_root=$sdk `
       "platform-tools" "platforms;android-36" "build-tools;36.1.0"
   # --licenses es interactivo: hay que alimentarlo con "y"
   $(1..30 | ForEach-Object { "y" }) | & "$sdk\cmdline-tools\latest\bin\sdkmanager.bat" --sdk_root=$sdk --licenses
   ```

5. Crear `android/local.properties` apuntando al SDK, con las barras escapadas como las escribe
   Android Studio:

   ```properties
   sdk.dir=C\:\\Users\\joseg\\Android\\Sdk
   ```

6. Traer `ethos-release.jks` (a la raíz del repo) y `keystore.properties` (a `android/`) desde el
   respaldo. Ver [Firma](#firma).

## Build

Lo normal es el script, que hace todo esto y **corta en el primer paso que falle**:

```powershell
npm run apk          # release firmado con la clave propia  <- el que se reparte
npm run apk:debug    # debug: compila más rápido, pero Play Protect lo bloquea
```

El script acepta `-apiUrl`, pero **no cambia el ORDS que usan los teléfonos**: solo el de la
copia local que no se muestra (ver arriba). El de los teléfonos es el del sitio publicado, en
[`deploy.yml`](.github/workflows/deploy.yml).

### Los pasos a mano

Si hay que diagnosticar algo, los mismos pasos uno por uno. Abrir PowerShell **en la raíz del
proyecto** y ejecutar en orden:

```powershell
# 1. Ir a la raíz del proyecto
cd C:\Users\joseg\Desktop\scripts\editorial-ethos-app

# 2. Configurar Java 21 solo para esta sesión (no afecta JAVA_HOME global)
$env:JAVA_HOME = "C:\Program Files\Java\jdk-21.0.11"
$env:Path = "$env:JAVA_HOME\bin;$env:Path"

# 3. Verificar que Java 21 está activo
java --version

# 4. Build web en modo SPA. Es la copia local que exige `cap sync` y que no se
#    muestra mientras exista server.url (ver arriba).
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

1. Copiar `app-release.apk` al teléfono. Se reparte el release: el debug lo bloquea Play
   Protect (ver [Firma](#firma)).
2. Habilitar "Instalar apps de fuentes desconocidas" para la app con la que se abre el archivo
   (el navegador o el gestor de archivos).
3. Abrir el APK e instalar.

El `appId` es `com.editorialethos.app`, **el mismo** que declara la app Expo en
[`mobile/app.json`](mobile/app.json). Si alguna vez llegaste a instalar un APK compilado con EAS,
Android va a rechazar este por firma distinta: desinstalá el anterior primero.

## ¿Cuándo hay que regenerar el APK?

Solo cuando cambia algo del binario:

- **Cambios nativos**: un plugin de Capacitor, el ícono, el splash, `appName`, los permisos del
  manifest, `minSdkVersion` / `targetSdkVersion`.
- **La URL del sitio** (`server.url`): está horneada en el APK.

**No** hace falta por un cambio del front (pantallas, formularios, estilos, lógica de `src/`),
ni por la URL de ORDS —la define el sitio publicado—, ni por un `.sql` del backend. Todo eso
llega con el push o con correr el script en APEX.

La excepción es un teléfono que todavía no tiene la 2.0: hay que instalarle un APK a mano
**una vez**, porque las versiones anteriores traían la web adentro y no se actualizan solas.

## Versión

[`android/app/build.gradle`](android/app/build.gradle) → `versionCode` / `versionName`
(actualmente **`15` / `"2.0"`**). Subirlos antes de repartir una versión nueva; Android se
niega a instalar encima un `versionCode` menor o igual. El historial de cada versión está
comentado ahí mismo.

## Identidad de la app

| Qué | Valor | ¿Se puede cambiar? |
| --- | --- | --- |
| Nombre visible | "Juventud con Valores" | Sí, `res/values/strings.xml` |
| `applicationId` | `com.editorialethos.app` | **No** sin romper la actualización |

**El `applicationId` sigue diciendo `editorialethos` a propósito.** Es la identidad de la app
para Android: si se cambia, el sistema la toma como una app distinta, no se instala encima de
la que ya está en los teléfonos, queda duplicada y el usuario pierde lo que tuviera guardado.
El nombre visible se cambia cuando se quiera; el id, no sin migrar.

## Ícono de la app

Ya es el de la marca. Se regeneró el **04/08/2026** desde `public/logo.png` (512×512) en las
seis densidades, y **está commiteado** en `android/app/src/main/res/`. No hay que hacer nada
en cada build.

| Archivo | Qué es |
| --- | --- |
| `ic_launcher.png` | Legacy cuadrado (Android < 8), a sangre |
| `ic_launcher_round.png` | Legacy redondo, recortado a círculo |
| `ic_launcher_background.png` | Capa de atrás del adaptativo: azul `#7095CC` liso |
| `ic_launcher_foreground.png` | Capa de adelante: el logo al 62%, centrado |
| `splash.png` (×26) | Portrait/landscape × densidades × `-night` |

### Dos cosas que hay que respetar si se regenera

1. **El adaptativo va sin `inset` en el XML.** El template traía
   `<inset android:inset="16.7%">` en las dos capas; con eso, el recorte del launcher dejaba
   un borde transparente alrededor del azul. El margen está **dentro del PNG** (el logo
   dibujado al 62%), que es lo que evita que "Juventud con Valores" quede cortado.
2. **Los splash `-night` van sobre navy `#0E1226`**, no sobre el azul claro: si no, el
   arranque destella celeste antes de entrar a una app en modo oscuro.

### Cómo se regeneraron

**Sin instalar nada.** Se usó `System.Drawing` de .NET vía PowerShell, que ya viene con
Windows. Los scripts quedaron en el scratchpad de la sesión, pero son cortos: leen el PNG,
lo redimensionan con `HighQualityBicubic` y lo guardan.

Antes se usaba `npx @capacitor/assets`. **No volver a ponerlo en `devDependencies`:** arrastra
un `@capacitor/cli@5.7.8` viejo además del 8.4.1 real —lo que rompía `npm ci` en GitHub Actions
con `Missing: lru-cache@11.5.2 from lock file`— y un `sharp@0.32.6` nativo que el runner tenía
que compilar con `node-gyp` para nada. Es una herramienta de un solo uso, no una dependencia.

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

> **En la PC actual no están** (verificado el 24/09/2026): el repo viene de GitHub y estos
> archivos nunca viajan con él. Antes de compilar un release hay que traerlos del respaldo o de
> la PC anterior. Mientras el APK siga siendo una cáscara pesa poco —un cambio de web no pide
> APK—, pero el día que haga falta uno nuevo, sin esta clave no se va a poder instalar encima.

Verificar con qué clave quedó firmado un APK:

```powershell
$bt = "C:\Users\joseg\Android\Sdk\build-tools\36.1.0"   # o donde esté el SDK
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

## No hay acceso biométrico

**Se implementó y se quitó el 31/07/2026**, a pedido explícito: consumió demasiado tiempo
para lo que aportaba. Se fueron el plugin `@capgo/capacitor-native-biometric`,
`src/lib/biometria.ts`, el switch de Mi cuenta, el botón del login y los permisos
`USE_BIOMETRIC` / `USE_FINGERPRINT` del manifest.

Para no escribir la contraseña está el check **"Recordar usuario y contraseña"** del login,
que funciona igual en la web y en el APK. La guarda en `localStorage` **en texto plano**: sin
Keystore no hay otro lugar donde ponerla. Es opt-in y el login lo advierte en pantalla. Ver
[`src/lib/api.ts`](src/lib/api.ts).

### Si alguna vez se reimplanta

Lo que costó descubrir, para no volver a pagarlo:

**1. Sin bloqueo de pantalla NO hay biometría.** El Keystore exige PIN, patrón o contraseña en
el equipo para poder cifrar. Sin eso `isAvailable()` devuelve `false` aunque el celular tenga
lector de huellas, y no se puede sortear desde la app. Es la causa más común de que "el botón
no aparezca". Que la comprobación devuelva el **motivo** y no un booleano: `deviceIsSecure`
distingue "poné un PIN" de "registrá una huella", y esa diferencia es la que el usuario
necesita para resolverlo.

**2. El plugin MIENTE en la web.** Su implementación de navegador es un stub de desarrollo:
`isAvailable()` devuelve `true`, `verifyIdentity()` siempre tiene éxito sin pedir nada, y las
credenciales van a un `Map` en memoria. Hay que cortar por `window.Capacitor` **antes** de
consultarlo, o la web ofrece una huella que no existe y da por guardada una contraseña que no
está en ningún lado.

**3. `USE_BIOMETRIC` no lo trae el plugin.** Su `AndroidManifest.xml` solo declara la
`AuthActivity`. Sin esa línea en el manifest de la app, el `BiometricPrompt` falla en runtime
con el código JS perfecto y el celular con lector.

**4. El modo de guardado correcto** es `setCredentials({ accessControl: BIOMETRY_ANY })` +
`getSecureCredentials()`, con `authValidityDuration` en 0: ata la clave del Keystore a un
`CryptoObject` y exige una huella viva en cada lectura. `BIOMETRY_ANY` y no
`BIOMETRY_CURRENT_SET`, porque este último invalida la credencial cuando el usuario registra
una huella nueva y el acceso deja de andar sin explicación.

## Cosas que conviene saber

### "Fuentes desconocidas" es por app instaladora, no por APK

El permiso se concede a **la app que abre el archivo**, no al archivo. Si lo
habilitaste para Chrome pero después abrís el APK desde el gestor de archivos,
Android lo vuelve a bloquear: hay que habilitarlo también para el gestor.

Y Android **no abre el instalador solo** al terminar una descarga web: el usuario
tiene que tocar la notificación.

### `npx cap sync android` es obligatorio tras instalar un plugin

Sin ese paso el plugin no existe en runtime y los errores son confusos —del tipo
*"plugin not implemented"*— que parecen problemas de código. El script ya lo hace;
solo importa si se compila a mano.

Comprobación: el sync tiene que listar el plugin instalado. **Hoy el proyecto no usa
ninguno**, así que lo correcto es que no aparezca esa línea:

```
[info] Found 0 Capacitor plugins for android:
```

### Diagnosticar el WebView con DevTools

El APK es una WebView, así que se depura con las DevTools de Chrome completas:
**`chrome://inspect`** en el escritorio, con el celular conectado por USB y
depuración activada. Da consola, red y breakpoints sobre la app corriendo en el
teléfono — dos minutos contra horas de adivinar.

### Desinstalar antes de cambiar de firma

Android **no instala encima** una app firmada con otra clave: falla con
`INSTALL_FAILED_UPDATE_INCOMPATIBLE`. Al pasar de un APK debug a uno release —o al revés— hay que
desinstalar el anterior primero, y se pierden los datos locales (preferencias, contraseña
recordada).

## Relación con la app Expo de `mobile/`

Este APK y la app Expo son **dos implementaciones distintas** del mismo producto. Hoy el APK que
se genera es este, el de la web. Lo que eso implica:

- **A favor:** trae todos los módulos, porque es el sitio. La app Expo solo tiene login, inicio
  y cuenta.
- **En contra:** no tiene biometría. `mobile/` sí (`expo-local-authentication`), pero es la app
  que ya no se compila. En el APK de Capacitor se probó y se quitó — ver *No hay acceso
  biométrico* más arriba.

`mobile/` sigue en el repo y se puede compilar a mano con EAS (`cd mobile && npm run build:apk`),
pero ya no es lo que responde a "generá el apk".

## Notas

- `appId` = `com.editorialethos.app`, `appName` = "Juventud con Valores".
- La carpeta `android/` se commitea; sus artefactos de build los ignora `android/.gitignore`,
  igual que `local.properties` y los `*.apk`.
- El backend ([`backend/auth.sql`](backend/auth.sql)) tiene que estar corrido o el login no
  entra, igual que en la web.
- El token de ORDS dura 6 h y no se renueva: a las 6 h, de vuelta al login.
