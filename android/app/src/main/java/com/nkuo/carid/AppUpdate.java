package com.nkuo.carid;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * App 裡直接更新：網頁按「更新」→ 在這裡下載新版 APK（進度回報給網頁）→ 交給手機的安裝程式。
 * 手機一定會問一次「要更新這個應用程式嗎？」；第一次還要允許這個 App 安裝更新（安裝不明應用程式）。
 * 只下載這個 repo 的 Release 檔案，下載完再看一次套件名稱和版號，不對就不裝。
 */
final class AppUpdate {

  /** 只認這裡的檔案（GitHub Release 的下載網址，之後會轉到 GitHub 自己的檔案主機）。 */
  static final String ALLOWED_PREFIX = "https://github.com/nkuo-git/carid-pwa/releases/download/";
  private static final long MAX_BYTES = 80L * 1024 * 1024;

  interface Listener {
    /** state：dl（下載中，pct 0–100，-1＝不知道多大）、install（交給手機安裝）、allow（要先允許安裝）、error。 */
    void onState(String state, int pct);
  }

  private static final AtomicBoolean busy = new AtomicBoolean(false);

  private AppUpdate() {}

  static boolean allowedUrl(String url) {
    return url != null && url.startsWith(ALLOWED_PREFIX) && url.endsWith(".apk") && !url.contains("..");
  }

  static File apkFile(Context ctx) {
    File dir = new File(ctx.getCacheDir(), "updates");
    if (!dir.exists()) dir.mkdirs();
    return new File(dir, "carid-update.apk");
  }

  /** 背景下載；同時只跑一個。回傳 false＝網址不對或已經在下載。 */
  static boolean start(Context ctx, String url, Listener l) {
    if (!allowedUrl(url) || !busy.compareAndSet(false, true)) return false;
    final Context app = ctx.getApplicationContext();
    new Thread(() -> {
      try {
        File out = apkFile(app);
        download(url, out, l);
        if (!looksRight(app, out)) {
          out.delete();
          l.onState("error", 0);
          return;
        }
        l.onState("install", 100);
      } catch (Exception e) {
        l.onState("error", 0);
      } finally {
        busy.set(false);
      }
    }, "app-update").start();
    return true;
  }

  private static void download(String url, File out, Listener l) throws Exception {
    HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
    c.setInstanceFollowRedirects(true);
    c.setConnectTimeout(20000);
    c.setReadTimeout(30000);
    c.setRequestProperty("User-Agent", "CaridApp-update");
    try {
      if (c.getResponseCode() != 200) throw new Exception("HTTP " + c.getResponseCode());
      long total = c.getContentLengthLong();
      if (total > MAX_BYTES) throw new Exception("too big");
      l.onState("dl", total > 0 ? 0 : -1);
      try (InputStream in = c.getInputStream(); OutputStream o = new FileOutputStream(out)) {
        byte[] buf = new byte[64 * 1024];
        long got = 0;
        int lastPct = 0;
        int n;
        while ((n = in.read(buf)) > 0) {
          o.write(buf, 0, n);
          got += n;
          if (got > MAX_BYTES) throw new Exception("too big");
          if (total > 0) {
            int pct = (int) Math.min(99, got * 100 / total);
            if (pct != lastPct) {
              lastPct = pct;
              l.onState("dl", pct);
            }
          }
        }
      }
    } finally {
      c.disconnect();
    }
  }

  /** 之前已經下載好、而且還是比現在裝的新（剛剛沒裝成）：不用再下載一次。 */
  static boolean downloaded(Context ctx) {
    if (busy.get()) return false;
    File f = apkFile(ctx);
    return f.exists() && looksRight(ctx, f);
  }

  /** 下載下來的是不是這個 App、而且比現在裝的新。 */
  private static boolean looksRight(Context ctx, File apk) {
    try {
      PackageManager pm = ctx.getPackageManager();
      PackageInfo got = pm.getPackageArchiveInfo(apk.getPath(), 0);
      if (got == null || !ctx.getPackageName().equals(got.packageName)) return false;
      PackageInfo mine = pm.getPackageInfo(ctx.getPackageName(), 0);
      return got.versionCode > mine.versionCode;
    } catch (Exception e) {
      return false;
    }
  }

  /** Android 8 以上要使用者允許「安裝不明應用程式」；之前的版本沒有這一關。 */
  static boolean canInstall(Context ctx) {
    return Build.VERSION.SDK_INT < 26 || ctx.getPackageManager().canRequestPackageInstalls();
  }

  /** 打開手機設定裡「允許這個來源的應用程式」那一頁。 */
  static Intent allowIntent(Context ctx) {
    return new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + ctx.getPackageName()));
  }

  /** 叫手機的安裝程式（會問「要更新這個應用程式嗎？」）。 */
  static Intent installIntent(Context ctx) {
    Uri uri = FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".fileprovider", apkFile(ctx));
    Intent i = new Intent(Intent.ACTION_VIEW);
    i.setDataAndType(uri, "application/vnd.android.package-archive");
    i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
    return i;
  }
}
