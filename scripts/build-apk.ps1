# Genera el APK de Editorial Ethos empaquetando el sitio web con Capacitor.
# Uso:  .\scripts\build-apk.ps1 [-config debug|release]
# Doc:  APK.md
#
# Pasos: Java 21 -> build web en modo SPA -> cap sync -> gradle -> reporte.
# Cada paso corta el script si falla: un error de build no debe llegar
# disfrazado de APK viejo.

param(
    [ValidateSet("debug", "release")]
    [string]$config = "debug",

    # URL de ORDS que queda EMBEBIDA en el APK. Dentro del APK no hay servidor
    # Node, así que el proxy `/api/ords/` no corre y el front tiene que pegarle
    # directo a Oracle. Funciona porque ORDS responde con CORS abierto.
    [string]$apiUrl = "https://oracleapex.com/ords/fundcarac/ethos/"
)

$ErrorActionPreference = "Stop"
$Info = "Cyan"; $Ok = "Green"; $Bad = "Red"

function Fallar($mensaje) {
    Write-Host "ERROR: $mensaje" -ForegroundColor $Bad
    exit 1
}

# El script vive en scripts/, pero todos los comandos van desde la raíz.
$raiz = Split-Path -Parent $PSScriptRoot
Set-Location $raiz

Write-Host "=== APK de Editorial Ethos ($config) ===" -ForegroundColor $Info

# --- 1. Java 21 -------------------------------------------------------------
# Capacitor 8 / AGP 8 no compila con Java 17. Se fija solo para esta sesión:
# no toca el JAVA_HOME global de la máquina.
Write-Host "1/5 Java 21..." -ForegroundColor $Info
$env:JAVA_HOME = "C:\Program Files\Java\jdk-21.0.11"
if (-not (Test-Path $env:JAVA_HOME)) {
    Fallar "JDK 21 no encontrado en $env:JAVA_HOME. Instalalo o corregí esta ruta."
}
$env:Path = "$env:JAVA_HOME\bin;$env:Path"
# --version y no -version: el segundo escribe en stderr y PowerShell lo reporta
# como error nativo aunque el comando haya salido bien.
#
# OJO CON EL PIPE: esto NO puede ser `& java --version | Select-Object -First 1`.
# `Select-Object -First 1` cierra el pipeline apenas recibe la primera línea, y
# eso mata a `java` antes de que termine de escribir las otras dos. Java muere
# por pipe cerrado y deja un $LASTEXITCODE != 0 aunque haya andado perfecto.
#
# Es una carrera: gana casi siempre y falla de vez en cuando con "java --version
# falló" en una máquina donde Java está impecable. Pasó el 31/07/2026 después de
# tres builds seguidos exitosos. Se captura TODO y se recorta después.
$javaSalida = & java --version 2>&1
if ($LASTEXITCODE -ne 0) {
    Fallar "java --version falló (exit $LASTEXITCODE): $javaSalida"
}
Write-Host "   $(@($javaSalida)[0])" -ForegroundColor $Ok

# --- 2. Android SDK ---------------------------------------------------------
# Se valida ANTES de gastar el build web: Gradle sin SDK falla con un stack
# trace largo que no dice lo que realmente pasa.
Write-Host "2/5 Android SDK..." -ForegroundColor $Info
$localProps = Join-Path $raiz "android\local.properties"
if (-not (Test-Path $localProps)) {
    Fallar "Falta android\local.properties con la línea sdk.dir. Ver APK.md."
}
$sdkDir = (Get-Content $localProps | Where-Object { $_ -match "^\s*sdk\.dir\s*=" }) -replace "^\s*sdk\.dir\s*=\s*", "" -replace "\\:", ":" -replace "\\\\", "\"
if (-not $sdkDir) { Fallar "android\local.properties no define sdk.dir." }
if (-not (Test-Path $sdkDir)) {
    Write-Host "El SDK de Android no está en: $sdkDir" -ForegroundColor $Bad
    Write-Host "Instalalo (ver APK.md) o corregí sdk.dir en android\local.properties." -ForegroundColor $Bad
    exit 1
}
Write-Host "   SDK: $sdkDir" -ForegroundColor $Ok

# --- 3. Build web en modo SPA ----------------------------------------------
# APK_BUILD=1 apaga nitro y prende el modo SPA (ver vite.config.ts), que deja
# un shell estático que la WebView puede abrir desde el sistema de archivos.
Write-Host "3/5 Build web (SPA, API embebida: $apiUrl)..." -ForegroundColor $Info
$env:APK_BUILD = "1"
$env:VITE_API_URL = $apiUrl
npm run build
$buildExit = $LASTEXITCODE
$env:APK_BUILD = ""
$env:VITE_API_URL = ""
if ($buildExit -ne 0) { Fallar "el build web falló" }

$shell = Join-Path $raiz "dist\client\_shell.html"
if (-not (Test-Path $shell)) {
    Fallar "no se generó dist\client\_shell.html. ¿Se apagó el modo SPA en vite.config.ts?"
}
# Capacitor exige index.html como punto de entrada; el prerender lo llama _shell.
Copy-Item $shell (Join-Path $raiz "dist\client\index.html") -Force

# vite copia public/ entero a dist/client, así que el APK anterior terminaría
# empaquetado DENTRO del nuevo y lo haría crecer en cada build.
Remove-Item (Join-Path $raiz "dist\client\app.apk") -Force -ErrorAction SilentlyContinue

# --- 4. Sincronizar con el proyecto Android --------------------------------
Write-Host "4/5 cap sync android..." -ForegroundColor $Info
npx cap sync android
if ($LASTEXITCODE -ne 0) { Fallar "cap sync falló" }

# --- 5. Compilar -----------------------------------------------------------
Write-Host "5/5 Gradle ($config)..." -ForegroundColor $Info
Push-Location (Join-Path $raiz "android")
try {
    # --stop mata daemons viejos que se quedan con el SDK o el JDK anterior.
    .\gradlew --stop
    .\gradlew clean
    if ($LASTEXITCODE -ne 0) { Fallar "gradlew clean falló" }

    if ($config -eq "debug") {
        .\gradlew assembleDebug --stacktrace
        $candidatos = @("android\app\build\outputs\apk\debug\app-debug.apk")
    }
    else {
        .\gradlew assembleRelease --stacktrace
        # Con keystore.properties, Gradle firma y el archivo se llama
        # app-release.apk; sin él sale app-release-unsigned.apk.
        $candidatos = @(
            "android\app\build\outputs\apk\release\app-release.apk",
            "android\app\build\outputs\apk\release\app-release-unsigned.apk"
        )
    }
    if ($LASTEXITCODE -ne 0) { Fallar "Gradle falló ($config)" }
}
finally {
    Pop-Location
}

$apk = $null
foreach ($c in $candidatos) {
    $ruta = Join-Path $raiz $c
    if (Test-Path $ruta) { $apk = $ruta; break }
}
if (-not $apk) { Fallar "Gradle terminó bien pero no apareció el APK en $($candidatos -join ' ni ')" }

# --- 6. Reporte -------------------------------------------------------------
# El APK queda SOLO donde lo deja Gradle: se copia a mano desde ahí.
#
# Antes esto lo duplicaba en `public\app.apk`. Se sacó a pedido de Jose: el sitio
# ya no ofrece la descarga (`DESCARGA_APK_URL` está en "", ver DESPLIEGUE.md), así
# que esa copia no la servía nadie y solo dejaba un binario viejo en `public/`
# que el build web volvía a empaquetar dentro del APK siguiente.
$mb = [math]::Round((Get-Item $apk).Length / 1MB, 1)
Write-Host ""
Write-Host "=== APK listo ($mb MB) ===" -ForegroundColor $Ok
Write-Host $apk -ForegroundColor $Ok

# Con qué clave quedó firmado. Importa: un APK firmado con la debug key lo
# bloquea Play Protect al instalarlo ("Se bloqueó la app para proteger tu
# dispositivo"), porque esa clave es pública y la comparten todos los proyectos.
$apksigner = Join-Path $sdkDir "build-tools\36.1.0\apksigner.bat"
if (Test-Path $apksigner) {
    $certs = & $apksigner verify --print-certs $apk 2>$null | Select-String "certificate DN"
    if ($certs -match "CN=Android Debug") {
        Write-Host "FIRMA: debug key -> Play Protect lo va a bloquear al instalar." -ForegroundColor $Bad
        Write-Host "       Para repartirlo usá 'npm run apk' (release firmado)." -ForegroundColor $Bad
    }
    else {
        Write-Host "FIRMA: clave propia, instalable sin bloqueo de Play Protect." -ForegroundColor $Ok
    }
}
elseif ($config -eq "release" -and $apk -like "*unsigned*") {
    Write-Host "OJO: salió SIN FIRMAR (falta android\keystore.properties). Ver APK.md." -ForegroundColor $Bad
}
