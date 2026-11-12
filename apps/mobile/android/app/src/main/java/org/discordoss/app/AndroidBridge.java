package org.discordoss.app;

import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import java.util.function.Predicate;

public class AndroidBridge {

    static final String NAME = "DiscordOSSAndroid";

    static final String PAGE_SCRIPT =
        "(() => {" +
        "  if (window.__discordOssAndroid) return;" +
        "  window.__discordOssAndroid = true;" +
        "  const live = new Set();" +
        "  const update = () => { try { DiscordOSSAndroid.setInCall(live.size > 0); } catch {} };" +
        "  const watch = (track) => {" +
        "    if (track.kind !== 'audio' || live.has(track)) return;" +
        "    live.add(track);" +
        "    track.addEventListener('ended', () => { live.delete(track); update(); });" +
        "    update();" +
        "  };" +
        "  const stop = MediaStreamTrack.prototype.stop;" +
        "  MediaStreamTrack.prototype.stop = function () { if (live.delete(this)) update(); return stop.call(this); };" +
        "  const devices = navigator.mediaDevices;" +
        "  if (devices && devices.getUserMedia) {" +
        "    const getUserMedia = devices.getUserMedia.bind(devices);" +
        "    devices.getUserMedia = async (constraints) => { const stream = await getUserMedia(constraints); stream.getAudioTracks().forEach(watch); return stream; };" +
        "  }" +
        "  if (!('Notification' in window)) {" +
        "    class AppNotification extends EventTarget {" +
        "      static get permission() { return DiscordOSSAndroid.notificationsAllowed() ? 'granted' : 'denied'; }" +
        "      static requestPermission(callback) { const result = AppNotification.permission; if (callback) callback(result); return Promise.resolve(result); }" +
        "      constructor(title, options = {}) {" +
        "        super();" +
        "        this.title = String(title); this.body = String(options.body ?? ''); this.tag = String(options.tag ?? '');" +
        "        this.onclick = null; this.onclose = null; this.onshow = null; this.onerror = null;" +
        "        if (!document.hasFocus()) DiscordOSSAndroid.notify(this.title, this.body, this.tag);" +
        "      }" +
        "      close() {}" +
        "    }" +
        "    window.Notification = AppNotification;" +
        "  }" +
        "  window.DiscordOSS = Object.freeze({ platform: 'android', openInstanceSwitcher: () => DiscordOSSAndroid.openSwitcher() });" +
        "})();";

    private final MainActivity activity;

    AndroidBridge(MainActivity activity) {
        this.activity = activity;
    }

    private void onPage(Predicate<String> allowed, Runnable action) {
        activity.runOnUiThread(() -> {
            WebView webView = activity.getBridge().getWebView();
            if (allowed.test(webView.getUrl())) action.run();
        });
    }

    @JavascriptInterface
    public void openInstance(String url) {
        onPage(activity::isAppPage, () -> activity.openInstance(url));
    }

    @JavascriptInterface
    public void removeInstance(String url) {
        onPage(activity::isAppPage, () -> activity.forgetInstance(url));
    }

    @JavascriptInterface
    public void openSwitcher() {
        onPage(activity::isInstancePage, () -> activity.openSwitcher(null, null));
    }

    @JavascriptInterface
    public void setInCall(boolean value) {
        onPage(activity::isInstancePage, () -> activity.setInCall(value));
    }

    @JavascriptInterface
    public boolean notificationsAllowed() {
        return Notifications.allowed(activity);
    }

    @JavascriptInterface
    public void notify(String title, String body, String tag) {
        onPage(activity::isInstancePage, () -> Notifications.show(activity, title, body, tag));
    }
}
