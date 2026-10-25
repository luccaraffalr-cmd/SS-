package ar.remiseria.app;

import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;

/**
 * "Compartir desde WhatsApp" (versión 3, 22/10/2026): en WhatsApp (o Google Maps, la galería…) se toca Compartir →
 * Senda Segura, y la app web (src/compartidoApp.js) lo agrega a un viaje. Recibe un texto (link, ubicación) o un archivo
 * (foto, audio, PDF). Lo guarda hasta que la página lo pide con leer() y, si la app ya estaba abierta, avisa con el
 * evento "compartido".
 */
@CapacitorPlugin(name = "Compartido")
public class CompartidoPlugin extends Plugin {

    private static final int MAXIMO = 20 * 1024 * 1024; // 20 MB

    private JSObject pendiente; // lo último que compartieron, hasta que la página lo lee

    @Override
    public void load() {
        // La app se abrió desde "Compartir".
        recibir(getActivity().getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        // La app ya estaba abierta y le compartieron algo.
        recibir(intent);
    }

    /** Lo que compartieron (o nada), y lo borra: { compartido: { texto?, archivo?: { base64, nombre, tipo }, error? } } */
    @PluginMethod
    public void leer(PluginCall call) {
        JSObject r = new JSObject();
        synchronized (this) {
            if (pendiente != null) r.put("compartido", pendiente);
            pendiente = null;
        }
        call.resolve(r);
    }

    @SuppressWarnings("deprecation")
    private void recibir(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return;
        String texto = intent.getStringExtra(Intent.EXTRA_TEXT);
        Uri uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
        String tipo = intent.getType();
        // Para que no se vuelva a agregar si la pantalla se recarga.
        getActivity().setIntent(new Intent(Intent.ACTION_MAIN));

        // Leer el archivo puede tardar: se hace aparte y después se avisa a la página.
        new Thread(() -> {
            JSObject r = new JSObject();
            if (texto != null && !texto.trim().isEmpty()) r.put("texto", texto);
            if (uri != null) {
                try {
                    r.put("archivo", leerArchivo(uri, tipo));
                } catch (Exception e) {
                    r.put("error", e.getMessage());
                }
            }
            if (r.length() == 0) return;
            synchronized (this) {
                pendiente = r;
            }
            notifyListeners("compartido", new JSObject());
        }).start();
    }

    private JSObject leerArchivo(Uri uri, String tipoDelIntent) throws Exception {
        String nombre = "archivo";
        try (Cursor c = getContext().getContentResolver().query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            if (c != null && c.moveToFirst() && c.getString(0) != null) nombre = c.getString(0);
        } catch (Exception ignorado) {
            // sin nombre: queda "archivo"
        }
        String tipo = getContext().getContentResolver().getType(uri);
        if (tipo == null) tipo = tipoDelIntent;

        ByteArrayOutputStream datos = new ByteArrayOutputStream();
        try (InputStream entrada = getContext().getContentResolver().openInputStream(uri)) {
            if (entrada == null) throw new Exception("No se pudo abrir el archivo.");
            byte[] buffer = new byte[64 * 1024];
            for (int n; (n = entrada.read(buffer)) > 0; ) {
                datos.write(buffer, 0, n);
                if (datos.size() > MAXIMO) throw new Exception("El archivo es muy grande (más de 20 MB).");
            }
        }

        JSObject a = new JSObject();
        a.put("base64", Base64.encodeToString(datos.toByteArray(), Base64.NO_WRAP));
        a.put("nombre", nombre);
        a.put("tipo", tipo == null ? "" : tipo);
        return a;
    }
}
