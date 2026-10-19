package ar.remiseria.app;

import android.Manifest;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.core.content.ContextCompat;

/**
 * Si el celular se reinicia (o se actualiza la app) mientras el chofer está trabajando, vuelve a mandar la ubicación
 * solo, sin tener que abrir la app (desde la versión 2, 19/10/2026). Si el chofer había terminado el día, no hace nada.
 */
public class ArranqueReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context c, Intent intent) {
        String accion = intent.getAction();
        if (!Intent.ACTION_BOOT_COMPLETED.equals(accion)
            && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(accion)
            && !"android.intent.action.QUICKBOOT_POWERON".equals(accion)) return;

        if (!UbicacionService.prefs(c).getBoolean("activo", false) || !UbicacionService.tienePermisoUbicacion(c)) return;
        // Sin "permitir todo el tiempo", Android no deja usar la ubicación si la app no se abrió: espera a que la abra.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
            && ContextCompat.checkSelfPermission(c, Manifest.permission.ACCESS_BACKGROUND_LOCATION) != PackageManager.PERMISSION_GRANTED) return;

        try {
            ContextCompat.startForegroundService(c, new Intent(c, UbicacionService.class));
        } catch (Exception e) {
            // Android no lo dejó arrancar ahora: vuelve a mandar cuando el chofer abra la app.
            UbicacionService.prefs(c).edit().putString("ultimoError", "No arrancó solo: " + e.getClass().getSimpleName()).apply();
        }
    }
}
