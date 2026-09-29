package ar.remiseria.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(UbicacionPlugin.class); // ubicación en segundo plano (UbicacionService)
        super.onCreate(savedInstanceState);
    }
}
