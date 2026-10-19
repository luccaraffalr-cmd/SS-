# Publica una versión nueva de la app Android: los celulares con la versión 2 o más muestran "Hay una versión nueva —
# Actualizar" y se actualizan solos (ver src/ActualizarApp.jsx y ActualizacionPlugin.java).
# Uso (en PowerShell, desde la carpeta del proyecto), DESPUÉS de subir versionCode y versionName en android\app\build.gradle:
#   .\publicar-apk.ps1 -Novedades "Qué trae esta versión (una línea, se le muestra al chofer)"
# Hace: arma la app (compilar-app.ps1) → la sube a Storage (carpeta pública "app") → actualiza la tabla config_app
# → deja una copia en Descargas\Remiseria.apk (para instalar a mano en un celular nuevo).
param([Parameter(Mandatory = $true)][string]$Novedades)
$ErrorActionPreference = 'Stop'
$raiz = $PSScriptRoot
$ref = 'yomjqdbaatydpvazkvvg'
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')

$gradle = Get-Content -Raw "$raiz\android\app\build.gradle"
$codigo = [int]([regex]::Match($gradle, 'versionCode (\d+)').Groups[1].Value)
$nombre = [regex]::Match($gradle, 'versionName "([^"]+)"').Groups[1].Value
Write-Host "Versión $nombre (código $codigo)"

& "$raiz\compilar-app.ps1"
Set-Location $raiz
$apk = "$raiz\android\app\build\outputs\apk\debug\app-debug.apk"
$archivo = "remiseria-$codigo.apk"

npx.cmd supabase storage cp $apk "ss:///app/$archivo" --project-ref $ref --content-type application/vnd.android.package-archive --cache-control 'max-age=60'
if ($LASTEXITCODE) { throw 'No se pudo subir la app a Storage.' }
$url = "https://$ref.supabase.co/storage/v1/object/public/app/$archivo"

# La clave de servicio se pide en el momento a la CLI (ya logueada); no se guarda ni se muestra.
$claves = npx.cmd supabase projects api-keys --project-ref $ref -o json | ConvertFrom-Json
$servicio = ($claves | Where-Object { $_.name -eq 'service_role' }).api_key
if (-not $servicio) { throw 'No se pudo obtener la clave de servicio de Supabase.' }
$cuerpo = @{ version_codigo = $codigo; version_nombre = $nombre; apk_url = $url; novedades = $Novedades } | ConvertTo-Json
Invoke-RestMethod -Method Patch -Uri "https://$ref.supabase.co/rest/v1/config_app?id=eq.1" `
  -Headers @{ apikey = $servicio; Authorization = "Bearer $servicio"; Prefer = 'return=minimal' } `
  -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($cuerpo)) | Out-Null

Copy-Item $apk "$env:USERPROFILE\Downloads\Remiseria.apk" -Force
Write-Host "Publicada la versión $nombre. Los celulares con la app 1.1 o más la ofrecen sola; el archivo también quedó en Descargas\Remiseria.apk."
