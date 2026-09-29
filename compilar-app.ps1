# Arma la app Android (archivo .apk) a partir de la app web.
# Uso (en PowerShell, desde la carpeta del proyecto):
#   .\compilar-app.ps1           → app normal: abre las pantallas publicadas en Netlify.
#   .\compilar-app.ps1 -Prueba   → app de prueba: lleva adentro las pantallas de esta compu
#                                  (para probar en el celular antes de publicar en Netlify).
# El archivo queda en: android\app\build\outputs\apk\debug\app-debug.apk
param([switch]$Prueba)

$raiz = $PSScriptRoot

# Java 21 (el de Android Studio es más nuevo de lo que soporta Gradle 8) y el SDK de Android.
$env:JAVA_HOME = (Get-ChildItem "$env:LOCALAPPDATA\jdk21" -Directory | Select-Object -First 1).FullName
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:Path = "$env:JAVA_HOME\bin;" + [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
  [Environment]::GetEnvironmentVariable('Path', 'User')

Set-Location $raiz
npm.cmd run build
if ($LASTEXITCODE) { throw 'Falló el armado de la app web.' }
npx.cmd cap sync android
if ($LASTEXITCODE) { throw 'Falló la copia de la app web al proyecto Android.' }

if ($Prueba) {
  # Sin "server.url": la app usa las pantallas copiadas adentro en vez de las de Netlify.
  $config = "$raiz\android\app\src\main\assets\capacitor.config.json"
  $datos = Get-Content -Raw -Encoding UTF8 $config | ConvertFrom-Json
  $datos.PSObject.Properties.Remove('server')
  [IO.File]::WriteAllText($config, ($datos | ConvertTo-Json -Depth 10), (New-Object Text.UTF8Encoding $false))
  Write-Host 'App de PRUEBA: lleva las pantallas de esta compu (no las de Netlify).'
}

Set-Location "$raiz\android"
& "$raiz\android\gradlew.bat" assembleDebug --no-daemon
if ($LASTEXITCODE) { throw 'Falló la compilación de Android.' }

Set-Location $raiz
Get-Item "$raiz\android\app\build\outputs\apk\debug\app-debug.apk" | Select-Object FullName, Length, LastWriteTime
