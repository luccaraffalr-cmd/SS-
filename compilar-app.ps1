# Arma la app Android (archivo .apk) a partir de la app web.
# Uso (en PowerShell, desde la carpeta del proyecto):  .\compilar-app.ps1
# El archivo queda en: android\app\build\outputs\apk\debug\app-debug.apk

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

Set-Location "$raiz\android"
& "$raiz\android\gradlew.bat" assembleDebug --no-daemon
if ($LASTEXITCODE) { throw 'Falló la compilación de Android.' }

Set-Location $raiz
Get-Item "$raiz\android\app\build\outputs\apk\debug\app-debug.apk" | Select-Object FullName, Length, LastWriteTime
