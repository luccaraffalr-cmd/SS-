package ar.remiseria.app;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.location.LocationManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/** Lo que la app web (src/ubicacionApp.js) puede pedirle a Android sobre la ubicación. */
@CapacitorPlugin(
    name = "Ubicacion",
    permissions = {
        @Permission(alias = "ubicacion", strings = { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }),
        @Permission(alias = "segundoPlano", strings = { Manifest.permission.ACCESS_BACKGROUND_LOCATION }),
        @Permission(alias = "notificaciones", strings = { Manifest.permission.POST_NOTIFICATIONS }),
    }
)
public class UbicacionPlugin extends Plugin {

    /** Cómo está todo: si comparte, los permisos, la batería, el GPS y el último envío. */
    private JSObject armarEstado() {
        Context c = getContext();
        SharedPreferences p = UbicacionService.prefs(c);
        JSObject e = new JSObject();
        e.put("activo", p.getBoolean("activo", false));

        boolean fina = ContextCompat.checkSelfPermission(c, Manifest.permission.ACCESS_FINE_LOCATION) == 0;
        boolean aproximada = ContextCompat.checkSelfPermission(c, Manifest.permission.ACCESS_COARSE_LOCATION) == 0;
        e.put("ubicacion", fina ? "precisa" : aproximada ? "aproximada" : "no");
        e.put("segundoPlano", Build.VERSION.SDK_INT < Build.VERSION_CODES.Q
            || ContextCompat.checkSelfPermission(c, Manifest.permission.ACCESS_BACKGROUND_LOCATION) == 0);
        e.put("notificaciones", NotificationManagerCompat.from(c).areNotificationsEnabled());

        PowerManager pm = (PowerManager) c.getSystemService(Context.POWER_SERVICE);
        e.put("bateria", pm.isIgnoringBatteryOptimizations(c.getPackageName()));

        LocationManager lm = (LocationManager) c.getSystemService(Context.LOCATION_SERVICE);
        e.put("gps", lm != null && lm.isProviderEnabled(LocationManager.GPS_PROVIDER));

        long ultimo = p.getLong("ultimoEnvio", 0);
        if (ultimo > 0) e.put("ultimoEnvio", ultimo);
        String error = p.getString("ultimoError", null);
        if (error != null) e.put("ultimoError", error);
        return e;
    }

    @PluginMethod
    public void estado(PluginCall call) {
        call.resolve(armarEstado());
    }

    @PluginMethod
    public void pedirUbicacion(PluginCall call) {
        if (getPermissionState("ubicacion") == PermissionState.GRANTED
            && (Build.VERSION.SDK_INT < 33 || getPermissionState("notificaciones") == PermissionState.GRANTED)) {
            call.resolve(armarEstado());
        } else if (Build.VERSION.SDK_INT >= 33) {
            requestPermissionForAliases(new String[] { "ubicacion", "notificaciones" }, call, "alResponder");
        } else {
            requestPermissionForAlias("ubicacion", call, "alResponder");
        }
    }

    /** "Permitir todo el tiempo": en Android 11 o más abre la pantalla de ajustes de ubicación de la app. */
    @PluginMethod
    public void pedirSegundoPlano(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q || getPermissionState("segundoPlano") == PermissionState.GRANTED) {
            call.resolve(armarEstado());
        } else {
            requestPermissionForAlias("segundoPlano", call, "alResponder");
        }
    }

    @PermissionCallback
    private void alResponder(PluginCall call) {
        call.resolve(armarEstado());
    }

    /** Pide "batería sin restricciones" (que Android no la frene para ahorrar batería). */
    @PluginMethod
    public void pedirBateria(PluginCall call) {
        try {
            Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                Uri.parse("package:" + getContext().getPackageName()));
            getActivity().startActivity(i);
        } catch (Exception e) {
            abrirAjustesDeLaApp();
        }
        call.resolve(armarEstado());
    }

    @PluginMethod
    public void abrirAjustes(PluginCall call) {
        abrirAjustesDeLaApp();
        call.resolve(armarEstado());
    }

    private void abrirAjustesDeLaApp() {
        Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
            Uri.parse("package:" + getContext().getPackageName()));
        getActivity().startActivity(i);
    }

    /** Empieza a compartir. Recibe la clave del celular y a dónde mandar. */
    @PluginMethod
    public void iniciar(PluginCall call) {
        String clave = call.getString("clave");
        String url = call.getString("url");
        String apikey = call.getString("apikey");
        if (clave == null || url == null || apikey == null) {
            call.reject("Faltan datos para compartir la ubicación.");
            return;
        }
        if (!UbicacionService.tienePermisoUbicacion(getContext())) {
            call.reject("Falta el permiso de ubicación.");
            return;
        }
        UbicacionService.prefs(getContext()).edit()
            .putString("clave", clave).putString("url", url).putString("apikey", apikey)
            .putBoolean("activo", true).apply();
        ContextCompat.startForegroundService(getContext(), new Intent(getContext(), UbicacionService.class));
        call.resolve(armarEstado());
    }

    @PluginMethod
    public void detener(PluginCall call) {
        UbicacionService.prefs(getContext()).edit().putBoolean("activo", false).apply();
        getContext().stopService(new Intent(getContext(), UbicacionService.class));
        call.resolve(armarEstado());
    }
}
