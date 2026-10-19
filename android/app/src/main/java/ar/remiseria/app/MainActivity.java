package ar.remiseria.app;

import android.os.Bundle;
import android.webkit.WebBackForwardList;
import android.webkit.WebView;

import androidx.activity.OnBackPressedCallback;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(UbicacionPlugin.class); // ubicación en segundo plano (UbicacionService)
        super.onCreate(savedInstanceState);

        // Botón atrás del celular (19/10/2026): si en la app hay algo abierto encima (un viaje, cargar el pago…), lo cierra
        // como el botón "Volver" (la página anota cada cosa que abre en su historial, ver src/atras.js). Si no, hace lo de
        // siempre (sale de la app).
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (hayAlgoAbierto()) {
                    getBridge().getWebView().goBack();
                } else {
                    setEnabled(false);
                    getOnBackPressedDispatcher().onBackPressed();
                    setEnabled(true);
                }
            }
        });
    }

    // Lo que abre la página queda en el historial con la misma dirección; así no vuelve a otra página (por ejemplo, a la
    // de "sin internet").
    private boolean hayAlgoAbierto() {
        if (getBridge() == null) return false;
        WebView pagina = getBridge().getWebView();
        if (pagina == null || !pagina.canGoBack()) return false;
        WebBackForwardList historial = pagina.copyBackForwardList();
        int actual = historial.getCurrentIndex();
        return actual > 0 && historial.getItemAtIndex(actual - 1).getUrl().equals(historial.getCurrentItem().getUrl());
    }
}
