package ar.remiseria.app;

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Que la app se actualice sola (desde la versión 2, 19/10/2026). La app web (src/actualizacionApp.js) compara la
 * versión de esta app con la última (tabla config_app) y, si hay una nueva, la baja y abre el instalador de Android.
 */
@CapacitorPlugin(name = "Actualizacion")
public class ActualizacionPlugin extends Plugin {

    /** Versión de esta app: versionName ("1.1") y versionCode (2), de android/app/build.gradle. */
    @PluginMethod
    public void info(PluginCall call) {
        try {
            PackageInfo pi = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
            JSObject r = new JSObject();
            r.put("version", pi.versionName);
            r.put("codigo", Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? pi.getLongVersionCode() : pi.versionCode);
            call.resolve(r);
        } catch (Exception e) {
            call.reject("No se pudo leer la versión de la app.");
        }
    }

    /**
     * Baja la app nueva y abre el instalador ("¿Querés actualizar esta app?"). La primera vez, Android tiene que dejar
     * que esta app instale actualizaciones: si todavía no puede, abre esa pantalla de ajustes y devuelve permiso=false.
     * Mientras baja, avisa el avance con el evento "progreso" ({ porcentaje }).
     */
    @PluginMethod
    public void instalar(PluginCall call) {
        String url = call.getString("url");
        if (url == null) {
            call.reject("Falta de dónde bajar la actualización.");
            return;
        }
        String paquete = getContext().getPackageName();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !getContext().getPackageManager().canRequestPackageInstalls()) {
            try {
                getActivity().startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + paquete)));
            } catch (Exception e) {
                getActivity().startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + paquete)));
            }
            JSObject r = new JSObject();
            r.put("permiso", false);
            call.resolve(r);
            return;
        }

        new Thread(() -> {
            HttpURLConnection conexion = null;
            try {
                File archivo = new File(getContext().getCacheDir(), "actualizacion.apk");
                conexion = (HttpURLConnection) new URL(url).openConnection();
                conexion.setConnectTimeout(20_000);
                conexion.setReadTimeout(60_000);
                int codigo = conexion.getResponseCode();
                if (codigo != 200) throw new Exception("el servidor respondió " + codigo);
                long total = conexion.getContentLengthLong();
                try (InputStream entrada = conexion.getInputStream(); OutputStream salida = new FileOutputStream(archivo)) {
                    byte[] buffer = new byte[64 * 1024];
                    long bajado = 0;
                    int ultimo = -1;
                    for (int n; (n = entrada.read(buffer)) > 0; ) {
                        salida.write(buffer, 0, n);
                        bajado += n;
                        int porcentaje = total > 0 ? (int) (bajado * 100 / total) : -1;
                        if (porcentaje != ultimo && porcentaje % 5 == 0) {
                            ultimo = porcentaje;
                            JSObject p = new JSObject();
                            p.put("porcentaje", porcentaje);
                            notifyListeners("progreso", p);
                        }
                    }
                }

                Uri uri = FileProvider.getUriForFile(getContext(), paquete + ".fileprovider", archivo);
                Intent instalar = new Intent(Intent.ACTION_VIEW)
                    .setDataAndType(uri, "application/vnd.android.package-archive")
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getActivity().startActivity(instalar);

                JSObject r = new JSObject();
                r.put("permiso", true);
                call.resolve(r);
            } catch (Exception e) {
                call.reject("No se pudo bajar la actualización (" + e.getMessage() + "). Revisá que tengas internet.");
            } finally {
                if (conexion != null) conexion.disconnect();
            }
        }).start();
    }
}
