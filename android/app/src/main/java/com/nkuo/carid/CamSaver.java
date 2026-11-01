package com.nkuo.carid;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;

import androidx.core.content.FileProvider;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * 行車錄影：網頁一邊錄、一邊把影片一小段一小段（base64）丟過來，這裡直接寫進手機相簿，
 * 不用整支影片先放在記憶體裡。Android 10 以上存在「相簿 › Movies › 大便龍行車」；
 * 更舊的手機存在 App 自己的影片資料夾（不用另外要權限），一樣可以分享、打開。
 */
final class CamSaver {
  static final String FOLDER = "大便龍行車";

  private final Context ctx;
  private Uri uri;
  private File file;
  private OutputStream out;
  private long bytes;

  CamSaver(Context ctx) { this.ctx = ctx.getApplicationContext(); }

  /** 開一個新的影片檔；mime 是 video/mp4 或 video/webm。回傳 false＝開不了。 */
  synchronized boolean begin(String mime) {
    abort();
    String type = mime != null && mime.startsWith("video/mp4") ? "video/mp4" : "video/webm";
    String ext = type.equals("video/mp4") ? ".mp4" : ".webm";
    String name = FOLDER + "_" + new SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(new Date()) + ext;
    try {
      if (Build.VERSION.SDK_INT >= 29) {
        ContentValues v = new ContentValues();
        v.put(MediaStore.Video.Media.DISPLAY_NAME, name);
        v.put(MediaStore.Video.Media.MIME_TYPE, type);
        v.put(MediaStore.Video.Media.RELATIVE_PATH, Environment.DIRECTORY_MOVIES + "/" + FOLDER);
        v.put(MediaStore.Video.Media.IS_PENDING, 1);
        ContentResolver cr = ctx.getContentResolver();
        uri = cr.insert(MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY), v);
        if (uri == null) return false;
        out = cr.openOutputStream(uri);
      } else {
        File dir = new File(ctx.getExternalFilesDir(Environment.DIRECTORY_MOVIES), FOLDER);
        if (!dir.exists() && !dir.mkdirs()) return false;
        file = new File(dir, name);
        out = new FileOutputStream(file);
        uri = FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".fileprovider", file);
      }
      bytes = 0;
      return out != null;
    } catch (Exception e) {
      abort();
      return false;
    }
  }

  /** 接一段（base64）。回傳 false＝寫不進去（例如手機滿了）。 */
  synchronized boolean chunk(String b64) {
    if (out == null || b64 == null) return false;
    try {
      byte[] data = Base64.decode(b64, Base64.DEFAULT);
      out.write(data);
      bytes += data.length;
      return true;
    } catch (Exception e) {
      return false;
    }
  }

  /** 錄完：keep＝true 收進相簿、回傳影片的網址（content://）；false 就刪掉，回傳空字串。 */
  synchronized String end(boolean keep) {
    if (out == null) return "";
    try {
      out.close();
    } catch (Exception ignored) {
      // 關不掉也沒辦法
    }
    out = null;
    if (!keep || bytes == 0) {
      abort();
      return "";
    }
    if (Build.VERSION.SDK_INT >= 29 && uri != null) {
      ContentValues v = new ContentValues();
      v.put(MediaStore.Video.Media.IS_PENDING, 0);
      ctx.getContentResolver().update(uri, v, null, null);
    }
    String u = uri == null ? "" : uri.toString();
    uri = null;
    file = null;
    return u;
  }

  long bytes() { return bytes; }

  private void abort() {
    try {
      if (out != null) out.close();
    } catch (Exception ignored) {
      // 不管
    }
    out = null;
    try {
      if (uri != null && Build.VERSION.SDK_INT >= 29) ctx.getContentResolver().delete(uri, null, null);
      if (file != null) //noinspection ResultOfMethodCallIgnored
        file.delete();
    } catch (Exception ignored) {
      // 不管
    }
    uri = null;
    file = null;
  }
}
