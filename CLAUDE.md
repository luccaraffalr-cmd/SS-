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

## Estado (29/9/2026)
- **Etapa 1 terminada** (SQL 001–015 aplicados; 016 = ofertas sin tiempo límite, pedirle confirmación de que lo corrió).
- Hay commits locales **sin publicar** en Netlify (próximos viajes, carteles de viajes sin chofer, ofertas sin tiempo).
- Pendiente antes de usarla en serio: publicar, borrar datos de prueba (usuarios `prueba1`/`prueba2` y sus viajes),
  cargar los choferes reales (fotos de autos en Descargas\remises), y en cada celular: activar notificaciones,
  instalar la app y batería "sin restricciones".
- Siguiente: el usuario elige entre Etapa 2 (ubicación: primero integrar Traccar, que ya usan, y después app
  Android propia) y Etapa 3 (plata y clientes: cuenta corriente de choferes con comisiones, resúmenes,
  clientes y saldos de cuentas corrientes).
