# App de remisería — instrucciones para Claude

## Con quién trabajás
- El usuario **no sabe programar**. Explicá todo en **español rioplatense (voseo), en palabras simples**, y decí exactamente qué tocar y dónde (botón por botón).
- Trabaja casi siempre en esta computadora (Windows, en español); a veces desde el celular.
- Temas "a confirmar" o reglas de negocio nuevas: **preguntale antes de implementar**.

## Documentos
- `especificacion-remiseria.md`: reglas de negocio. La sección **"10 bis. Decisiones tomadas"** reemplaza lo que diga el resto (estados del chofer, aceptación de viajes, prioridad, etc.). Anotá ahí cada decisión nueva.
- `supabase/sql/NNN_*.sql`: cambios a la base, numerados y en orden.

## Stack
- Vite + React (JavaScript) + `@supabase/supabase-js`. Estilos en `src/estilos.css`. Pensado para celular.
- Supabase: proyecto `yomjqdbaatydpvazkvvg`. Claves públicas en `.env` (commiteado; solo claves públicas).
  Secretos (VAPID de notificaciones) están en los secrets de Supabase, nunca en el repo.
- Funciones de Supabase: `supabase/functions/usuarios` (crear usuarios / cambiar contraseña) y `notificar` (push).
- Notificaciones push web: `public/sw.js`, `src/notificaciones.js`; se disparan al insertar en `ofertas`.
- Netlify: https://fastidious-cocada-43719b.netlify.app (publica solo al hacer push a `main`).

## Cómo trabajamos
1. **SQL**: escribí el archivo en `supabase/sql/`, copialo al portapapeles
   (`Get-Content -Raw -Encoding UTF8 <archivo> | Set-Clipboard`) y pedile al usuario que lo pegue en
   Supabase → SQL Editor → + New query → Ctrl+V → Run. Recién después de que diga "listo", verificá
   (consultando la API con la clave anon) y seguí.
2. **Probar en local** antes de publicar: el usuario usa http://localhost:5173 (gestión en ventana normal,
   chofer en incógnito) y en el celular http://192.168.0.101:5173 (mismo WiFi; ahí no andan las notificaciones).
   Levantá el servidor con la configuración `remiseria` de `.claude/launch.json`. Si ve una versión vieja,
   reiniciá el servidor y que recargue con Ctrl+Shift+R.
3. **Netlify cuesta créditos**: plan gratis = 300 créditos/mes y cada publicación gasta 15. **No hagas push
   a `main` sin que el usuario lo pida**; se publica por tandas. `netlify.toml` no publica si no cambió la app.
4. Funciones de Supabase: `npx.cmd supabase functions deploy <nombre> --project-ref yomjqdbaatydpvazkvvg --use-api`
   (la CLI ya está logueada).
5. En PowerShell, Git/Node pueden no estar en el PATH del proceso: anteponé
   `$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User');`
6. Commits en español, con autor "Lucca Raffa".
7. **App Android** (Capacitor, carpeta `android/`): se arma con `.\compilar-app.ps1` (build web + `cap sync` +
   Gradle) → `android\app\build\outputs\apk\debug\app-debug.apk`. Usa Java 21 de `%LOCALAPPDATA%\jdk21`
   (el Java 25 de Android Studio no anda con Gradle 8.14) y el SDK de `%LOCALAPPDATA%\Android\Sdk`.
   `.\compilar-app.ps1 -Prueba` arma una app de prueba con las pantallas de esta compu adentro (para probar
   en el celular antes de publicar). Avisos de viajes en la app: Firebase (proyecto `senda-segura`,
   `android/app/google-services.json`, no es secreto); la clave de la cuenta de servicio está en el secret
   `FIREBASE_CUENTA` de Supabase y la usa `notificar` (tabla `tokens_app`).
   La app **carga las pantallas desde Netlify** (`server.url` en `capacitor.config.json`; sin internet muestra
   `public/sin-internet.html`): los cambios de pantallas llegan solos al publicar en Netlify. Solo hace falta
   un APK nuevo si cambia la parte nativa (`android/`) o `capacitor.config.json`. La usan choferes **y el dueño**
   (gestión desde el celular). Dentro de la app no andan las web push: por eso los avisos van por Firebase.
   Se firma con la clave de depuración de esta compu (`%USERPROFILE%\.android\debug.keystore`): no borrarla,
   o los celulares no van a poder actualizar sin desinstalar. Parte nativa: `UbicacionService.java`
   (servicio en primer plano que manda a `reportar_mi_ubicacion`) y `UbicacionPlugin.java`.

## Estado (29/9/2026, noche)
- **Etapa 1 terminada.** Publicado en Netlify el 29/9/2026 (quedan ~7 deploys de septiembre; publicar por tandas).
- **Sin Traccar** (decidido 29/9): todos los choferes usan la app Android (`DescargasRemiseria.apk`, carga las
  pantallas desde Netlify). SQL 021: limpieza y arranque de cero (sin viajes, sin viajes fijos, sin `prueba1`/`prueba2`;
  `ubicaciones` e `historial_ubicacion` por `chofer_id`). Render (repo `remis`) quedó sin uso: se puede borrar
  cuando el usuario quiera (lo hace él: Render → el servicio → Settings → Delete; GitHub → remis → Settings → Archive).
- App Android: ubicación automática (Empezar a trabajar → Terminar el día), revisión de permisos, avisos por Firebase.
  Se mide la confiabilidad con el uso real (`historial_ubicacion` guarda 7 días).
- Hecho también: viajes fijos (`019`) y calendario en Viajes.
- Pendiente antes de usarla en serio: cargar los choferes reales (fotos de autos en Descargasemises), instalar la
  app en cada celular (permisos: ubicación "todo el tiempo", batería sin restricciones, notificaciones).
- Después: Etapa 3 (plata y clientes: cuenta corriente de choferes con comisiones, resúmenes, clientes y saldos).
