package com.nkuo.carid;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.job.JobInfo;
import android.app.job.JobScheduler;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * 新車訊通知。沒有伺服器推播：手機自己大約每小時去網站看一次 news/index.json，
 * 最新那篇是沒看過的就跳一個通知，按了打開那篇（carid://news/<id>）。
 * 第一次跑只記下現在最新的是哪篇，不會把舊的通知出來。
 */
final class NewsCheck {

  static final String NEWS_URL = "https://nkuo-git.github.io/carid-pwa/news/index.json";
  private static final String PREFS = "news";
  private static final String CHANNEL = "news";
  private static final int JOB_ID = 42;
  private static final int NOTE_ID = 1;
  private static final long EVERY = 60L * 60 * 1000;      // 大約每小時
  private static final long FLEX = 15L * 60 * 1000;

  private NewsCheck() {}

  static SharedPreferences prefs(Context ctx) {
    return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
  }

  /** 設定裡的「車訊通知」：預設開。 */
  static boolean wanted(Context ctx) {
    return prefs(ctx).getBoolean("notify", true);
  }

  static void setWanted(Context ctx, boolean on) {
    prefs(ctx).edit().putBoolean("notify", on).apply();
  }

  /** 手機准不准這個 App 跳通知（Android 13 以上要先問過）。 */
  static boolean allowed(Context ctx) {
    if (Build.VERSION.SDK_INT >= 33
        && ctx.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
      return false;
    }
    NotificationManager nm = ctx.getSystemService(NotificationManager.class);
    return nm == null || nm.areNotificationsEnabled();
  }

  /** 排每小時看一次；已經排好就不動它。關機重開也會繼續（setPersisted）。 */
  static void schedule(Context ctx) {
    JobScheduler js = ctx.getSystemService(JobScheduler.class);
    if (js == null) return;
    JobInfo have = js.getPendingJob(JOB_ID);
    if (have != null && have.getIntervalMillis() == EVERY) return;
    JobInfo job = new JobInfo.Builder(JOB_ID, new ComponentName(ctx, NewsJobService.class))
        .setPeriodic(EVERY, FLEX)
        .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
        .setPersisted(true)
        .build();
    try {
      js.schedule(job);
    } catch (Exception ignored) {
      // 排不進去就算了，下次打開 App 會再排一次
    }
  }

  /** 網頁已經把這篇秀出來了（打開車訊頁），就當作通知過了，不要再跳。 */
  static void seen(Context ctx, String id, String date) {
    if (id == null || id.isEmpty() || date == null) return;
    SharedPreferences p = prefs(ctx);
    String lastDate = p.getString("lastDate", "");
    if (date.compareTo(lastDate) >= 0) {
      p.edit().putString("lastId", id).putString("lastDate", date).apply();
    }
  }

  /** 背景跑：去網站看最新的一篇，沒看過就通知。不能在主執行緒呼叫。 */
  static void check(Context ctx) {
    try {
      JSONObject newest = newest(new JSONObject(fetchText(NEWS_URL + "?t=" + System.currentTimeMillis())));
      if (newest == null) return;
      String id = newest.optString("id");
      String date = newest.optString("date");
      SharedPreferences p = prefs(ctx);
      String lastId = p.getString("lastId", null);
      String lastDate = p.getString("lastDate", "");
      if (lastId == null) {
        // 第一次：只記起來
        p.edit().putString("lastId", id).putString("lastDate", date).apply();
        return;
      }
      if (id.equals(lastId) || date.compareTo(lastDate) < 0) return;
      p.edit().putString("lastId", id).putString("lastDate", date).apply();
      if (wanted(ctx) && allowed(ctx)) show(ctx, newest);
    } catch (Exception ignored) {
      // 沒網路、網站一時打不開：下一個小時再看
    }
  }

  /** items 裡日期最新的一篇（同一天就拿 id 比較大的）。 */
  static JSONObject newest(JSONObject index) {
    JSONArray items = index.optJSONArray("items");
    if (items == null) return null;
    JSONObject best = null;
    for (int i = 0; i < items.length(); i++) {
      JSONObject it = items.optJSONObject(i);
      if (it == null || it.optString("id").isEmpty() || it.optString("title").isEmpty()) continue;
      if (best == null) { best = it; continue; }
      int c = it.optString("date").compareTo(best.optString("date"));
      if (c > 0 || (c == 0 && it.optString("id").compareTo(best.optString("id")) > 0)) best = it;
    }
    return best;
  }

  static String kindName(String kind) {
    switch (kind) {
      case "lux": return "週三汽車介紹";
      case "new": return "週六新車快訊";
      case "how": return "週日汽車原理";
      default: return "車訊";
    }
  }

  private static void show(Context ctx, JSONObject a) {
    NotificationManager nm = ctx.getSystemService(NotificationManager.class);
    if (nm == null) return;
    if (Build.VERSION.SDK_INT >= 26) {
      NotificationChannel ch = new NotificationChannel(CHANNEL, "新車訊", NotificationManager.IMPORTANCE_DEFAULT);
      ch.setDescription("週三、六、日有新車訊的時候通知");
      nm.createNotificationChannel(ch);
    }

    String id = a.optString("id");
    String make = a.optString("make");
    String title = a.optString("title");
    if (!make.isEmpty() && !title.contains(make)) title = make + " " + title;
    String lede = a.optString("lede");

    Intent open = new Intent(Intent.ACTION_VIEW, Uri.parse("carid://news/" + Uri.encode(id)), ctx, MainActivity.class);
    open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
    PendingIntent pi = PendingIntent.getActivity(ctx, 0, open,
        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

    Notification.Builder b = Build.VERSION.SDK_INT >= 26
        ? new Notification.Builder(ctx, CHANNEL)
        : new Notification.Builder(ctx);
    b.setSmallIcon(R.drawable.ic_stat_news)
        .setColor(0xFFFF6A1F)
        .setContentTitle("新車訊：" + kindName(a.optString("kind")))
        .setContentText(title)
        .setStyle(new Notification.BigTextStyle().bigText(lede.isEmpty() ? title : title + "\n" + lede))
        .setContentIntent(pi)
        .setAutoCancel(true)
        .setShowWhen(true);
    Bitmap pic = picture(a.optString("img"));
    if (pic != null) b.setLargeIcon(pic);
    nm.notify(NOTE_ID, b.build());
  }

  /** 文章的照片縮小當通知右邊的小圖；拿不到就不放。 */
  private static Bitmap picture(String url) {
    if (url == null || !url.startsWith("https://")) return null;
    try {
      byte[] data = fetchBytes(url, 4 * 1024 * 1024);
      BitmapFactory.Options o = new BitmapFactory.Options();
      o.inJustDecodeBounds = true;
      BitmapFactory.decodeByteArray(data, 0, data.length, o);
      int sample = 1;
      while (Math.min(o.outWidth, o.outHeight) / (sample * 2) >= 192) sample *= 2;
      BitmapFactory.Options o2 = new BitmapFactory.Options();
      o2.inSampleSize = sample;
      return BitmapFactory.decodeByteArray(data, 0, data.length, o2);
    } catch (Exception e) {
      return null;
    }
  }

  private static String fetchText(String url) throws Exception {
    return new String(fetchBytes(url, 2 * 1024 * 1024), "UTF-8");
  }

  private static byte[] fetchBytes(String url, int max) throws Exception {
    HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
    c.setConnectTimeout(15000);
    c.setReadTimeout(20000);
    c.setRequestProperty("User-Agent", "CaridApp-news");
    try {
      if (c.getResponseCode() != 200) throw new Exception("HTTP " + c.getResponseCode());
      try (InputStream in = c.getInputStream()) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) {
          out.write(buf, 0, n);
          if (out.size() > max) throw new Exception("too big");
        }
        return out.toByteArray();
      }
    } finally {
      c.disconnect();
    }
  }
}
