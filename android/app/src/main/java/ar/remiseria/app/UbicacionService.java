package ar.remiseria.app;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.os.Build;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;

import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;

import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Servicio que manda la ubicación del chofer a Supabase, aunque la pantalla esté bloqueada
 * o la app esté cerrada. Mientras corre, Android muestra un aviso fijo ("compartiendo ubicación"):
 * eso es lo que evita que el sistema lo corte.
 */
public class UbicacionService extends Service {

    static final String PREFS = "ubicacion";
    private static final String CANAL = "ubicacion";
    private static final int ID_AVISO = 1;
    private static final long CADA_MS = 15_000;       // cada cuánto pide una ubicación nueva
    private static final long MINIMO_MS = 10_000;     // nunca más seguido que esto

    private FusedLocationProviderClient cliente;
    private LocationCallback alRecibir;
    private PowerManager.WakeLock wakeLock;
    private final ExecutorService envios = Executors.newSingleThreadExecutor();

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static boolean tienePermisoUbicacion(Context c) {
        return ContextCompat.checkSelfPermission(c, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
            || ContextCompat.checkSelfPermission(c, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // Si Android reinicia el servicio solo (START_STICKY), sigue solo si el chofer no lo apagó.
        if (!prefs(this).getBoolean("activo", false) || !tienePermisoUbicacion(this)) {
            stopSelf();
            return START_NOT_STICKY;
        }

        crearCanal();
        int tipo = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q ? ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION : 0;
        ServiceCompat.startForeground(this, ID_AVISO, armarAviso(), tipo);

        if (wakeLock == null) {
            PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "remiseria:ubicacion");
            wakeLock.setReferenceCounted(false);
            wakeLock.acquire();
        }

        if (alRecibir == null) empezarAPedirUbicacion();
        return START_STICKY;
    }

    @SuppressWarnings("MissingPermission") // se revisa en onStartCommand
    private void empezarAPedirUbicacion() {
        cliente = LocationServices.getFusedLocationProviderClient(this);
        LocationRequest pedido = new LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, CADA_MS)
            .setMinUpdateIntervalMillis(MINIMO_MS)
            .setWaitForAccurateLocation(false)
            .build();
        alRecibir = new LocationCallback() {
            @Override
            public void onLocationResult(LocationResult resultado) {
                Location ubicacion = resultado.getLastLocation();
                if (ubicacion != null) envios.execute(() -> enviar(ubicacion));
            }
        };
        cliente.requestLocationUpdates(pedido, alRecibir, Looper.getMainLooper());
    }

    private void enviar(Location ubicacion) {
        SharedPreferences p = prefs(this);
        String url = p.getString("url", null);
        String apikey = p.getString("apikey", null);
        String clave = p.getString("clave", null);
        if (url == null || apikey == null || clave == null) return;

        HttpURLConnection conexion = null;
        try {
            JSONObject cuerpo = new JSONObject();
            cuerpo.put("p_clave", clave);
            cuerpo.put("p_lat", ubicacion.getLatitude());
            cuerpo.put("p_lon", ubicacion.getLongitude());
            cuerpo.put("p_velocidad", ubicacion.hasSpeed() ? Math.round(ubicacion.getSpeed() * 3.6f) : 0);
            if (ubicacion.hasAccuracy()) cuerpo.put("p_precision", Math.round(ubicacion.getAccuracy()));

            conexion = (HttpURLConnection) new URL(url + "/rest/v1/rpc/reportar_mi_ubicacion").openConnection();
            conexion.setRequestMethod("POST");
            conexion.setConnectTimeout(15_000);
            conexion.setReadTimeout(15_000);
            conexion.setDoOutput(true);
            conexion.setRequestProperty("Content-Type", "application/json");
            conexion.setRequestProperty("apikey", apikey);
            conexion.setRequestProperty("Authorization", "Bearer " + apikey);
            try (OutputStream salida = conexion.getOutputStream()) {
                salida.write(cuerpo.toString().getBytes(StandardCharsets.UTF_8));
            }
            int codigo = conexion.getResponseCode();
            String respuesta = leer(codigo < 400 ? conexion.getInputStream() : conexion.getErrorStream());
            if (codigo >= 200 && codigo < 300) {
                p.edit().putLong("ultimoEnvio", System.currentTimeMillis()).remove("ultimoError").apply();
                // El servidor devuelve el estado del chofer: si terminó el día (o lo puso gestión), se apaga solo.
                if (respuesta.contains("fuera_de_servicio")) apagar();
            } else if (respuesta.contains("Clave incorrecta")) {
                apagar(); // usuario desactivado o clave vieja: la app pide una nueva al volver a abrirse
            } else {
                p.edit().putString("ultimoError", "El servidor respondió " + codigo).apply();
            }
        } catch (Exception e) {
            p.edit().putString("ultimoError", "Sin conexión: " + e.getClass().getSimpleName()).apply();
        } finally {
            if (conexion != null) conexion.disconnect();
        }
    }

    private void apagar() {
        prefs(this).edit().putBoolean("activo", false).apply();
        stopSelf();
    }

    private static String leer(InputStream entrada) {
        if (entrada == null) return "";
        try (InputStream e = entrada) {
            ByteArrayOutputStream salida = new ByteArrayOutputStream();
            byte[] buffer = new byte[1024];
            for (int n; (n = e.read(buffer)) > 0; ) salida.write(buffer, 0, n);
            return salida.toString("UTF-8");
        } catch (Exception ex) {
            return "";
        }
    }

    private void crearCanal() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel canal = new NotificationChannel(CANAL, "Ubicación", NotificationManager.IMPORTANCE_LOW);
            canal.setDescription("Aviso fijo mientras la app comparte tu ubicación");
            canal.setShowBadge(false);
            getSystemService(NotificationManager.class).createNotificationChannel(canal);
        }
    }

    private Notification armarAviso() {
        Intent abrir = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent alTocar = PendingIntent.getActivity(this, 0, abrir,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new NotificationCompat.Builder(this, CANAL)
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentTitle("Remisería")
            .setContentText("Compartiendo tu ubicación")
            .setOngoing(true)
            .setContentIntent(alTocar)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build();
    }

    @Override
    public void onDestroy() {
        if (cliente != null && alRecibir != null) cliente.removeLocationUpdates(alRecibir);
        alRecibir = null;
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        wakeLock = null;
        envios.shutdown();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
