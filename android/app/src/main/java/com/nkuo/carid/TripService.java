package com.nkuo.carid;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.IBinder;
import android.os.Looper;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileOutputStream;
import java.io.FileReader;
import java.io.IOException;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.nio.charset.StandardCharsets;

/**
 * 行車紀錄：在背景記 GPS 的前景服務。
 * 網頁（trip.js）按「開始記錄」→ MainActivity 把這個服務開起來，通知列會一直有一條「行車紀錄中」，
 * 螢幕關掉、切到別的 App 都會繼續記。每個點除了交給網頁（window.caridTrip("fix", …)），
 * 也會一行一行寫進檔案；App 被手機殺掉再開，網頁可以用 tripState／tripPoints 接回來繼續。
 * 通知上的「暫停／繼續」「結束」直接叫這個服務；網頁沒開著時按「結束」，整趟先存成 pending 檔，
 * 下次網頁打開再收走存進它自己的紀錄裡。
 */
public class TripService extends Service implements LocationListener {

  static final String ACT_START = "com.nkuo.carid.trip.START";
  static final String ACT_PAUSE = "com.nkuo.carid.trip.PAUSE";
  static final String ACT_RESUME = "com.nkuo.carid.trip.RESUME";
  static final String ACT_STOP = "com.nkuo.carid.trip.STOP";
  static final String EXTRA_MODE = "mode";

  private static final String CHANNEL = "trip";
  private static final int NOTE_ID = 2;
  private static final String META_FILE = "trip-active.json";
  private static final String POINTS_FILE = "trip-active.jsonl";
  private static final String PENDING_FILE = "trip-pending.json";

  /** 網頁那邊（MainActivity）接事件用；沒開著就是 null。 */
  interface Sink { void onEvent(String evt, String json); }
  static volatile Sink sink;
  /** 正在跑的那一個（同一個行程裡 MainActivity 直接拿）。 */
  static volatile TripService live;

  private String mode = "car";
  private long start;
  private boolean paused;
  private long pausedAt;
  private long pausedMs;
  private final JSONArray points = new JSONArray();
  private Writer pointsOut;
  private long lastNoteAt;
  private double dist;          // 公尺，只給通知看
  private Location lastLoc;
  private boolean listening;

  static final String[] PERMS = {Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION};

  static boolean hasLocation(Context ctx) {
    return ctx.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        || ctx.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
  }

  /** 檔案裡有沒有還在記的那一趟（App 被殺掉之前）。 */
  static boolean hasSaved(Context ctx) {
    return new File(ctx.getFilesDir(), META_FILE).exists();
  }

  static void start(Context ctx, String mode) {
    Intent i = new Intent(ctx, TripService.class).setAction(ACT_START).putExtra(EXTRA_MODE, mode);
    if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i); else ctx.startService(i);
  }

  static void send(Context ctx, String action) {
    ctx.startService(new Intent(ctx, TripService.class).setAction(action));
  }

  @Override
  public IBinder onBind(Intent intent) { return null; }

  @Override
  public void onCreate() {
    super.onCreate();
    live = this;
    NotificationManager nm = getSystemService(NotificationManager.class);
    if (nm != null && Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null) {
      NotificationChannel ch = new NotificationChannel(CHANNEL, "行車紀錄", NotificationManager.IMPORTANCE_LOW);
      ch.setDescription("記錄中的時候，通知列會一直有一條，螢幕關掉也會繼續記。");
      ch.setShowBadge(false);
      nm.createNotificationChannel(ch);
    }
  }

  @Override
  public int onStartCommand(Intent intent, int flags, int startId) {
    String action = intent != null ? intent.getAction() : null;
    if (action == null) {
      // 被手機殺掉又拉起來（START_STICKY）：從檔案把那趟接回來
      if (!restore()) { stopSelf(); return START_NOT_STICKY; }
      goForeground();
      listen();
      return START_STICKY;
    }
    switch (action) {
      case ACT_START: {
        String m = intent.getStringExtra(EXTRA_MODE);
        begin(m != null ? m : "car");
        goForeground();
        listen();
        return START_STICKY;
      }
      case ACT_PAUSE:
        if (start == 0 && !restore()) { stopSelf(); return START_NOT_STICKY; }
        if (!paused) { paused = true; pausedAt = System.currentTimeMillis(); writeMeta(); }
        note(true);
        emit("paused", "{\"at\":" + pausedAt + "}");
        return START_STICKY;
      case ACT_RESUME:
        if (start == 0 && !restore()) { stopSelf(); return START_NOT_STICKY; }
        if (paused) { pausedMs += System.currentTimeMillis() - pausedAt; paused = false; writeMeta(); }
        note(true);
        emit("resumed", "{\"at\":" + System.currentTimeMillis() + "}");
        return START_STICKY;
      case ACT_STOP: {
        if (start == 0 && !restore()) { stopSelf(); return START_NOT_STICKY; }
        String json = finish();
        Sink s = sink;
        if (s != null) s.onEvent("stopped", json);
        else writeFile(PENDING_FILE, json);     // 網頁沒開著：先放著，下次打開再收
        clearFiles();
        stopForeground(true);
        stopSelf();
        return START_NOT_STICKY;
      }
      default:
        return START_NOT_STICKY;
    }
  }

  private void begin(String m) {
    mode = m;
    start = System.currentTimeMillis();
    paused = false;
    pausedAt = 0;
    pausedMs = 0;
    dist = 0;
    lastLoc = null;
    while (points.length() > 0) points.remove(points.length() - 1);
    closePoints();
    new File(getFilesDir(), POINTS_FILE).delete();
    writeMeta();
  }

  private void goForeground() {
    Notification n = note(false);
    if (Build.VERSION.SDK_INT >= 29) {
      startForeground(NOTE_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
    } else {
      startForeground(NOTE_ID, n);
    }
  }

  private void listen() {
    if (listening) return;
    if (!hasLocation(this)) return;
    LocationManager lm = getSystemService(LocationManager.class);
    if (lm == null) return;
    try {
      lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000, 0f, this, Looper.getMainLooper());
      listening = true;
    } catch (SecurityException | IllegalArgumentException e) {
      // 沒有 GPS（平板）就試網路定位，至少有個大概
      try {
        lm.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 1000, 0f, this, Looper.getMainLooper());
        listening = true;
      } catch (Exception ignored) {
        // 真的沒有就算了，網頁會一直顯示「正在抓 GPS 訊號」
      }
    }
  }

  @Override
  public void onLocationChanged(Location loc) {
    if (paused || loc == null) return;
    long t = System.currentTimeMillis();
    double v = loc.hasSpeed() ? loc.getSpeed() : -1;
    double acc = loc.hasAccuracy() ? loc.getAccuracy() : -1;
    JSONArray p = new JSONArray();
    try {
      p.put(t);
      p.put(Math.round(loc.getLatitude() * 1e6) / 1e6);
      p.put(Math.round(loc.getLongitude() * 1e6) / 1e6);
      p.put(v < 0 ? -1 : Math.round(v * 10) / 10.0);
      p.put(acc < 0 ? -1 : Math.round(acc));
    } catch (Exception e) {
      return;   // NaN 之類的怪值（JSONArray.put(double) 會丟），這個點不要
    }
    points.put(p);
    appendPoint(p);
    if (lastLoc != null && (acc < 0 || acc <= 60)) {
      float d = lastLoc.distanceTo(loc);
      if (d >= Math.max(3, acc * 0.5)) dist += d;
    }
    if (acc < 0 || acc <= 60) lastLoc = loc;
    if (t - lastNoteAt > 2000) { lastNoteAt = t; note(true); }
    Sink s = sink;
    if (s != null) {
      s.onEvent("fix", "{\"t\":" + t + ",\"lat\":" + loc.getLatitude() + ",\"lon\":" + loc.getLongitude()
          + ",\"v\":" + (v < 0 ? -1 : v) + ",\"acc\":" + (acc < 0 ? -1 : acc) + "}");
    }
  }

  @Override public void onStatusChanged(String provider, int status, Bundle extras) {}
  @Override public void onProviderEnabled(String provider) {}
  @Override public void onProviderDisabled(String provider) {}

  /** 現在的狀態給網頁看（tripState）。 */
  String stateJson() {
    try {
      JSONObject o = new JSONObject();
      o.put("active", start != 0);
      o.put("mode", mode);
      o.put("start", start);
      o.put("paused", paused);
      o.put("pausedAt", pausedAt);
      o.put("pausedMs", pausedMs);
      o.put("n", points.length());
      return o.toString();
    } catch (Exception e) {
      return "null";
    }
  }

  /** 第 from 個以後的點（tripPoints）。 */
  String pointsJson(int from) {
    JSONArray out = new JSONArray();
    for (int i = Math.max(0, from); i < points.length(); i++) out.put(points.opt(i));
    return out.toString();
  }

  /** 整趟打包：{ mode, start, end, pausedMs, points }。 */
  private String finish() {
    LocationManager lm = getSystemService(LocationManager.class);
    if (lm != null && listening) { try { lm.removeUpdates(this); } catch (Exception ignored) {} }
    listening = false;
    long now = System.currentTimeMillis();
    if (paused) { pausedMs += now - pausedAt; paused = false; }
    try {
      JSONObject o = new JSONObject();
      o.put("mode", mode);
      o.put("start", start);
      o.put("end", now);
      o.put("pausedMs", pausedMs);
      o.put("points", points);
      return o.toString();
    } catch (Exception e) {
      return "null";
    } finally {
      start = 0;
    }
  }

  /** 網頁按「結束」（tripStop）：直接拿整趟回去，服務收掉。 */
  String stopNow() {
    String json = finish();
    clearFiles();
    stopForeground(true);
    stopSelf();
    return json;
  }

  /* ---------- 通知 ---------- */

  private Notification note(boolean post) {
    Intent open = new Intent(this, MainActivity.class).setData(Uri.parse("carid://trip"))
        .setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
    int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
    PendingIntent tap = PendingIntent.getActivity(this, 0, open, flags);
    PendingIntent toggle = PendingIntent.getService(this, 1,
        new Intent(this, TripService.class).setAction(paused ? ACT_RESUME : ACT_PAUSE), flags);
    PendingIntent stop = PendingIntent.getService(this, 2,
        new Intent(this, TripService.class).setAction(ACT_STOP), flags);

    String modeName = "bike".equals(mode) ? "腳踏車" : "run".equals(mode) ? "跑步" : "開車";
    long elapsed = Math.max(0, (paused ? pausedAt : System.currentTimeMillis()) - start - pausedMs);
    String body;
    if (paused) {
      body = "暫停了・已經 " + km(dist) + " km";
    } else {
      double v = lastLoc != null && lastLoc.hasSpeed() ? lastLoc.getSpeed() * 3.6 : -1;
      body = (v >= 0 ? Math.round(v) + " km/h・" : "") + "已經 " + km(dist) + " km";
    }

    Notification.Builder b = Build.VERSION.SDK_INT >= 26
        ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
    b.setSmallIcon(R.drawable.ic_stat_trip)
        .setContentTitle((paused ? "行車紀錄暫停了・" : "行車紀錄中・") + modeName)
        .setContentText(body)
        .setSubText(hms(elapsed))
        .setContentIntent(tap)
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setShowWhen(false)
        .setCategory(Notification.CATEGORY_SERVICE)
        .setVisibility(Notification.VISIBILITY_PUBLIC)
        .addAction(new Notification.Action.Builder(null, paused ? "繼續" : "暫停", toggle).build())
        .addAction(new Notification.Action.Builder(null, "結束", stop).build());
    if (Build.VERSION.SDK_INT >= 31) b.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE);
    Notification n = b.build();
    if (post) {
      NotificationManager nm = getSystemService(NotificationManager.class);
      if (nm != null) { try { nm.notify(NOTE_ID, n); } catch (Exception ignored) {} }
    }
    return n;
  }

  private static String km(double m) {
    return String.format(java.util.Locale.ROOT, m < 10000 ? "%.2f" : "%.1f", m / 1000);
  }

  private static String hms(long ms) {
    long s = ms / 1000;
    return String.format(java.util.Locale.ROOT, "%02d:%02d:%02d", s / 3600, (s / 60) % 60, s % 60);
  }

  /* ---------- 檔案：被殺掉也接得回來 ---------- */

  private void writeMeta() {
    try {
      JSONObject o = new JSONObject();
      o.put("mode", mode);
      o.put("start", start);
      o.put("paused", paused);
      o.put("pausedAt", pausedAt);
      o.put("pausedMs", pausedMs);
      writeFile(META_FILE, o.toString());
    } catch (Exception ignored) {}
  }

  private void appendPoint(JSONArray p) {
    try {
      if (pointsOut == null) {
        pointsOut = new OutputStreamWriter(new FileOutputStream(new File(getFilesDir(), POINTS_FILE), true), StandardCharsets.UTF_8);
      }
      pointsOut.write(p.toString());
      pointsOut.write('\n');
      pointsOut.flush();
    } catch (IOException ignored) {
      closePoints();
    }
  }

  private void closePoints() {
    if (pointsOut != null) { try { pointsOut.close(); } catch (IOException ignored) {} pointsOut = null; }
  }

  private boolean restore() {
    String meta = readFile(META_FILE);
    if (meta == null) return false;
    try {
      JSONObject o = new JSONObject(meta);
      mode = o.optString("mode", "car");
      start = o.optLong("start", 0);
      paused = o.optBoolean("paused", false);
      pausedAt = o.optLong("pausedAt", 0);
      pausedMs = o.optLong("pausedMs", 0);
      if (start == 0) return false;
    } catch (Exception e) {
      return false;
    }
    while (points.length() > 0) points.remove(points.length() - 1);
    dist = 0;
    lastLoc = null;
    File f = new File(getFilesDir(), POINTS_FILE);
    if (f.exists()) {
      try (BufferedReader r = new BufferedReader(new FileReader(f))) {
        String line;
        while ((line = r.readLine()) != null) {
          if (line.isEmpty()) continue;
          try { points.put(new JSONArray(line)); } catch (Exception ignored) {}
        }
      } catch (IOException ignored) {}
    }
    return true;
  }

  private void clearFiles() {
    closePoints();
    new File(getFilesDir(), META_FILE).delete();
    new File(getFilesDir(), POINTS_FILE).delete();
  }

  /** 網頁沒開著時按通知的「結束」存下來的那趟；拿走後要叫 clearPending。 */
  static String pending(Context ctx) {
    File f = new File(ctx.getFilesDir(), PENDING_FILE);
    if (!f.exists()) return "";
    String s = readFile(ctx, PENDING_FILE);
    return s == null ? "" : s;
  }

  static void clearPending(Context ctx) {
    new File(ctx.getFilesDir(), PENDING_FILE).delete();
  }

  private void writeFile(String name, String text) {
    try (Writer w = new OutputStreamWriter(new FileOutputStream(new File(getFilesDir(), name)), StandardCharsets.UTF_8)) {
      w.write(text);
    } catch (IOException ignored) {}
  }

  private String readFile(String name) { return readFile(this, name); }

  private static String readFile(Context ctx, String name) {
    File f = new File(ctx.getFilesDir(), name);
    if (!f.exists()) return null;
    try (BufferedReader r = new BufferedReader(new FileReader(f))) {
      StringBuilder sb = new StringBuilder();
      char[] buf = new char[8192];
      int n;
      while ((n = r.read(buf)) > 0) sb.append(buf, 0, n);
      return sb.toString();
    } catch (IOException e) {
      return null;
    }
  }

  private void emit(String evt, String json) {
    Sink s = sink;
    if (s != null) s.onEvent(evt, json);
  }

  @Override
  public void onDestroy() {
    LocationManager lm = getSystemService(LocationManager.class);
    if (lm != null && listening) { try { lm.removeUpdates(this); } catch (Exception ignored) {} }
    listening = false;
    closePoints();
    if (live == this) live = null;
    super.onDestroy();
  }
}
