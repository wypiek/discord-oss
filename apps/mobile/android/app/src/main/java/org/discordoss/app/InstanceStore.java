package org.discordoss.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import java.util.HashSet;
import java.util.Set;

public class InstanceStore {

    private static final String SAVED = "saved";
    private static final String CURRENT = "current";

    private final SharedPreferences preferences;

    InstanceStore(Context context) {
        preferences = context.getSharedPreferences("instances", Context.MODE_PRIVATE);
    }

    static String origin(String url) {
        if (url == null) return null;
        Uri uri = Uri.parse(url.trim());
        String scheme = uri.getScheme();
        if (uri.getHost() == null || !("https".equals(scheme) || "http".equals(scheme))) return null;
        String origin = scheme + "://" + uri.getHost().toLowerCase();
        int port = uri.getPort();
        boolean defaultPort = port == -1 || ("https".equals(scheme) && port == 443) || ("http".equals(scheme) && port == 80);
        return defaultPort ? origin : origin + ":" + port;
    }

    boolean isSaved(String origin) {
        return origin != null && preferences.getStringSet(SAVED, new HashSet<>()).contains(origin);
    }

    String current() {
        String current = preferences.getString(CURRENT, null);
        return isSaved(current) ? current : null;
    }

    void setCurrent(String origin) {
        preferences.edit().putString(CURRENT, origin).apply();
    }

    void remember(String origin) {
        Set<String> saved = new HashSet<>(preferences.getStringSet(SAVED, new HashSet<>()));
        saved.add(origin);
        preferences.edit().putStringSet(SAVED, saved).putString(CURRENT, origin).apply();
    }

    void forget(String origin) {
        if (origin == null) return;
        Set<String> saved = new HashSet<>(preferences.getStringSet(SAVED, new HashSet<>()));
        saved.remove(origin);
        SharedPreferences.Editor editor = preferences.edit().putStringSet(SAVED, saved);
        if (origin.equals(preferences.getString(CURRENT, null))) editor.remove(CURRENT);
        editor.apply();
    }
}
