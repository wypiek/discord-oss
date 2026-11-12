package org.discordoss.app;

import android.Manifest;
import android.app.DownloadManager;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.webkit.CookieManager;
import android.webkit.URLUtil;
import android.webkit.WebBackForwardList;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.Toast;
import androidx.activity.OnBackPressedCallback;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.splashscreen.SplashScreen;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.core.graphics.Insets;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

public class MainActivity extends BridgeActivity {

    static final String APP_ORIGIN = "https://localhost";
    private static final int BACKGROUND = Color.parseColor("#1a1a1e");

    private InstanceStore store;
    private boolean inCall;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        SplashScreen.installSplashScreen(this);
        super.onCreate(savedInstanceState);
        store = new InstanceStore(this);
        styleWindow();
        WebView webView = getBridge().getWebView();
        tuneWebView(webView);
        webView.addJavascriptInterface(new AndroidBridge(this), AndroidBridge.NAME);
        getBridge().setWebViewClient(new InstanceWebViewClient());
        webView.setDownloadListener(this::download);
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                goBack();
            }
        });
        requestNotificationPermission();
        handleIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        handleIntent(intent);
    }

    @Override
    public void onDestroy() {
        setInCall(false);
        super.onDestroy();
    }

    private void styleWindow() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        getWindow().getDecorView().setBackgroundColor(BACKGROUND);
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.setAppearanceLightStatusBars(false);
        controller.setAppearanceLightNavigationBars(false);
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.VANILLA_ICE_CREAM) {
            getWindow().setStatusBarColor(BACKGROUND);
            getWindow().setNavigationBarColor(BACKGROUND);
        }
        WebView webView = getBridge().getWebView();
        ViewCompat.setOnApplyWindowInsetsListener(webView, (view, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            Insets keyboard = insets.getInsets(WindowInsetsCompat.Type.ime());
            view.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, keyboard.bottom));
            return WindowInsetsCompat.CONSUMED;
        });
    }

    private void tuneWebView(WebView webView) {
        webView.setBackgroundColor(BACKGROUND);
        webView.setLayerType(WebView.LAYER_TYPE_HARDWARE, null);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setSupportMultipleWindows(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setOffscreenPreRaster(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setUserAgentString(settings.getUserAgentString().replace("; wv", ""));
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) webView.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false);
    }

    private void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, new String[] { Manifest.permission.POST_NOTIFICATIONS }, 1);
        }
    }

    private void handleIntent(Intent intent) {
        if (intent == null) return;
        if (Intent.ACTION_VIEW.equals(intent.getAction()) && intent.getData() != null) {
            openDeepLink(intent.getData());
        } else if ("org.discordoss.app.SWITCH_INSTANCE".equals(intent.getAction())) {
            openSwitcher(null, null);
        }
    }

    private void openDeepLink(Uri link) {
        if (!"discord-oss".equals(link.getScheme())) return;
        String requested = link.getQueryParameter("instance");
        String host = link.getHost() == null ? "" : link.getHost();
        String path = "open".equals(host) || host.isEmpty() ? link.getQueryParameter("path") : "/" + host + (link.getPath() == null ? "" : link.getPath());
        if (path == null || !path.startsWith("/") || path.startsWith("//")) path = "/channels/@me";
        if (requested != null) {
            String origin = InstanceStore.origin(requested);
            if (origin == null) return;
            if (!store.isSaved(origin)) {
                openSwitcher(origin, null);
                return;
            }
            store.setCurrent(origin);
            getBridge().getWebView().loadUrl(origin + path);
            return;
        }
        String current = store.current();
        if (current == null) openSwitcher(null, null);
        else getBridge().getWebView().loadUrl(current + path);
    }

    void openSwitcher(String prefill, String error) {
        Uri.Builder url = Uri.parse(APP_ORIGIN + "/").buildUpon().appendQueryParameter("switch", "1");
        if (prefill != null) url.appendQueryParameter("prefill", prefill);
        if (error != null) url.appendQueryParameter("error", error);
        getBridge().getWebView().loadUrl(url.build().toString());
    }

    void openInstance(String url) {
        String origin = InstanceStore.origin(url);
        if (origin == null) return;
        store.remember(origin);
        getBridge().getWebView().loadUrl(origin + "/channels/@me");
    }

    void forgetInstance(String url) {
        store.forget(InstanceStore.origin(url));
    }

    boolean isAppPage(String url) {
        return url != null && (url.equals(APP_ORIGIN) || url.startsWith(APP_ORIGIN + "/"));
    }

    boolean isInstancePage(String url) {
        String origin = InstanceStore.origin(url);
        return origin != null && store.isSaved(origin);
    }

    private void goBack() {
        WebView webView = getBridge().getWebView();
        String url = webView.getUrl();
        WebBackForwardList history = webView.copyBackForwardList();
        int index = history.getCurrentIndex();
        String previous = index > 0 ? history.getItemAtIndex(index - 1).getUrl() : null;
        if (url != null && !isAppPage(url) && (previous == null || isAppPage(previous))) {
            openSwitcher(null, null);
        } else if (webView.canGoBack()) {
            webView.goBack();
        } else {
            moveTaskToBack(true);
        }
    }

    void setInCall(boolean value) {
        if (value == inCall) return;
        inCall = value;
        if (value && ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            ContextCompat.startForegroundService(this, new Intent(this, VoiceCallService.class));
        } else if (!value) {
            stopService(new Intent(this, VoiceCallService.class));
        }
    }

    private void download(String url, String userAgent, String contentDisposition, String mimeType, long contentLength) {
        if (!URLUtil.isNetworkUrl(url)) return;
        String fileName = URLUtil.guessFileName(url, contentDisposition, mimeType);
        DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
        request.setMimeType(mimeType);
        request.addRequestHeader("User-Agent", userAgent);
        String cookies = CookieManager.getInstance().getCookie(url);
        if (cookies != null) request.addRequestHeader("Cookie", cookies);
        request.setTitle(fileName);
        request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
        request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName);
        DownloadManager manager = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
        manager.enqueue(request);
        Toast.makeText(this, getString(R.string.downloading, fileName), Toast.LENGTH_SHORT).show();
    }

    private class InstanceWebViewClient extends BridgeWebViewClient {

        InstanceWebViewClient() {
            super(getBridge());
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            String url = request.getUrl().toString();
            if (isAppPage(url)) return super.shouldOverrideUrlLoading(view, request);
            if (isInstancePage(url)) return false;
            String scheme = request.getUrl().getScheme();
            if ("discord-oss".equals(scheme)) {
                openDeepLink(request.getUrl());
                return true;
            }
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, request.getUrl()).addCategory(Intent.CATEGORY_BROWSABLE));
            } catch (Exception ignored) {}
            return true;
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            super.onPageFinished(view, url);
            if (isInstancePage(url)) view.evaluateJavascript(AndroidBridge.PAGE_SCRIPT, null);
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            super.onReceivedError(view, request, error);
            if (!request.isForMainFrame() || !isInstancePage(request.getUrl().toString())) return;
            setInCall(false);
            openSwitcher(null, getString(R.string.load_failed, request.getUrl().getHost(), String.valueOf(error.getDescription())));
        }
    }
}
