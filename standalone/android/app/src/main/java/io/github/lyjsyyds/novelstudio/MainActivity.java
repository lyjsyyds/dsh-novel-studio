package io.github.lyjsyyds.novelstudio;

import android.os.Bundle;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle state) {
        registerPlugin(NovelNative.class);
        super.onCreate(state);
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            private boolean checking;

            @Override
            public void handleOnBackPressed() {
                if (checking) return;
                checking = true;
                getBridge().getWebView().evaluateJavascript("""
                    (() => {
                        const dialog = Array.from(document.querySelectorAll('dialog:modal')).pop();
                        if (!dialog) return false;
                        dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
                        return true;
                    })()
                    """, result -> {
                        checking = false;
                        if ("true".equals(result) || isFinishing()) return;
                        setEnabled(false);
                        getOnBackPressedDispatcher().onBackPressed();
                        setEnabled(true);
                    });
            }
        });
    }
}
