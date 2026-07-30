# Build estático del sitio, igual al que hace GitHub Actions.
# Uso:  .\scripts\build-static.ps1 [-apiUrl "https://..."]
# Doc:  DESPLIEGUE.md
#
# Sirve para probar en local exactamente lo que se va a publicar, sin esperar el
# workflow. La salida queda en dist\client.

param(
    # URL de ORDS que queda EMBEBIDA en el bundle. Sin servidor Node no corre el
    # proxy `/api/ords/`, así que el navegador le pega directo a Oracle.
    [string]$apiUrl = "https://oracleapex.com/ords/fundcarac/ethos/",

    # Prefijo del que cuelga el sitio. Por defecto la raíz, que es lo que sirve
    # `npx serve dist\client`. GitHub Pages sin dominio propio publica en
    # /editorial-ethos-app/: para reproducir ESE build, pasá ese valor (y ojo,
    # después hay que servirlo desde una carpeta con ese nombre o todo da 404).
    [string]$basePath = "/"
)

$ErrorActionPreference = "Stop"
$Info = "Cyan"; $Ok = "Green"; $Bad = "Red"

$raiz = Split-Path -Parent $PSScriptRoot
Set-Location $raiz

Write-Host "=== Build estático de Editorial Ethos ===" -ForegroundColor $Info
Write-Host "API embebida: $apiUrl" -ForegroundColor $Info
Write-Host "Base del sitio: $basePath" -ForegroundColor $Info

$env:STATIC_BUILD = "1"
$env:VITE_API_URL = $apiUrl
$env:BASE_PATH = $basePath
npm run build
$exit = $LASTEXITCODE
$env:STATIC_BUILD = ""
$env:VITE_API_URL = ""
$env:BASE_PATH = ""
if ($exit -ne 0) {
    Write-Host "ERROR: el build falló" -ForegroundColor $Bad
    exit 1
}

$cliente = Join-Path $raiz "dist\client"
$shell = Join-Path $cliente "_shell.html"
if (-not (Test-Path $shell)) {
    Write-Host "ERROR: no se generó dist\client\_shell.html. ¿Se apagó el modo SPA?" -ForegroundColor $Bad
    exit 1
}

# Los mismos tres pasos que hace el workflow. Ver los comentarios en
# .github/workflows/deploy.yml para el porqué de cada uno.
Copy-Item $shell (Join-Path $cliente "index.html") -Force
Copy-Item (Join-Path $cliente "index.html") (Join-Path $cliente "404.html") -Force
if (-not (Test-Path (Join-Path $cliente ".nojekyll"))) {
    New-Item -ItemType File -Path (Join-Path $cliente ".nojekyll") | Out-Null
}

# Sin CNAME: el dominio propio ya no viaja en el repo. Lo escribe el workflow
# solo si existe la repository variable CUSTOM_DOMAIN (ver DESPLIEGUE.md); si el
# archivo se publica con el DNS apuntando a otro lado, el sitio entero queda en
# un bucle de redirecciones.
$faltan = @("index.html", "404.html", ".nojekyll") | Where-Object {
    -not (Test-Path (Join-Path $cliente $_))
}
if ($faltan) {
    Write-Host "ERROR: falta en dist\client: $($faltan -join ', ')" -ForegroundColor $Bad
    exit 1
}

$mb = [math]::Round((Get-ChildItem $cliente -Recurse -File | Measure-Object Length -Sum).Sum / 1MB, 1)
Write-Host ""
Write-Host "=== Sitio estático listo ($mb MB) ===" -ForegroundColor $Ok
Write-Host $cliente -ForegroundColor $Ok
Write-Host "Probalo con:  npx serve dist\client" -ForegroundColor $Info
