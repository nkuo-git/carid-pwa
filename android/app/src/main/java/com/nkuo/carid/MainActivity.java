package com.nkuo.carid;

import android.Manifest;
import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.provider.MediaStore;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.core.content.FileProvider;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import org.json.JSONObject;

import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

/**
 * 很薄的一層殼：整個畫面就是 WebView，載入 GitHub Pages 上的辨車網頁。
 * 這裡要自己處理的只有兩件事：網頁上的 <input type="file">（WebView 預設不會有反應，
 * 要自己把相簿與相機的 Intent 接起來），以及登入信的連結從瀏覽器跳回 App（carid://login）。
 * 另外有新車訊通知（NewsCheck）：按了通知會帶 carid://news/<id> 進來，打開那篇。
 */
public class MainActivity extends Activity {

  /** 網頁版的網址；改版只要重新部署網頁，App 不用重編。 */
  private static final String START_URL = "https://nkuo-git.github.io/carid-pwa/";

  private static final int REQ_FILE = 1001;
  private static final int REQ_NOTIFY = 1002;

  /** 按「車訊通知 開」的時候手機不准：問完還是不准，就帶去手機的通知設定。 */
  private boolean notifyFromToggle;

  private WebView web;
  private ValueCallback<Uri[]> pendingCallback;
  private Uri cameraOutputUri;

  /** 從瀏覽器跳回來的登入連結，先收著，等網頁準備好再交給它。 */
  private volatile String pendingLink;

  /** 網頁要全螢幕（改車頁開車、比賽的時候，CaridApp.setFullscreen(true)）：狀態列、導覽列藏起來。 */
  private volatile boolean fullscreen;

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);

    web = new WebView(this);
    setContentView(web);

    WebSettings s = web.getSettings();
    s.setJavaScriptEnabled(true);
    s.setDomStorageEnabled(true);          // 金鑰存在 localStorage，沒有這個就存不住
    s.setUseWideViewPort(true);
    s.setLoadWithOverviewMode(true);
    s.setMediaPlaybackRequiresUserGesture(false);
    // 把外殼版號寫進 User-Agent，網頁才知道自己是跑在 App 裡、是哪一版，
    // 可以自己去比對 GitHub 上有沒有更新的 APK
    s.setUserAgentString(s.getUserAgentString() + " CaridApp/" + versionCode());
    web.addJavascriptInterface(new Bridge(), "CaridApp");

    web.setWebViewClient(new WebViewClient() {
      @Override
      public void onPageStarted(WebView view, String url, Bitmap favicon) {
        // 換頁、重新整理：新的頁面還沒說要全螢幕，狀態列、導覽列先放回來
        if (fullscreen) {
          fullscreen = false;
          applyFullscreen();
        }
      }

      @Override
      public void onPageFinished(WebView view, String url) {
        // 網頁通常會自己說 ready()，這裡是保險：載好了還有沒交出去的登入連結就交出去
        deliverLink();
      }

      @Override
      public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        Uri url = request.getUrl();
        String host = url.getHost();
        // 站內的連結留在 App 裡，站外的（例如 AI Studio 申請金鑰）丟給瀏覽器
        if (host != null && host.equals(Uri.parse(START_URL).getHost())) return false;
        try {
          startActivity(new Intent(Intent.ACTION_VIEW, url));
        } catch (Exception e) {
          return false;
        }
        return true;
      }
    });

    web.setWebChromeClient(new WebChromeClient() {
      @Override
      public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                       FileChooserParams params) {
        // 上一次沒收掉的 callback 要先結束，不然網頁的選檔會卡住
        if (pendingCallback != null) pendingCallback.onReceiveValue(null);
        pendingCallback = callback;
        cameraOutputUri = null;

        Intent camera = cameraIntent();
        Intent launch;
        if (params.isCaptureEnabled() && camera != null) {
          // 網頁上的「拍照」（capture）直接開相機，連拍好幾張時不用每次都先選 App
          launch = camera;
        } else {
          Intent pick = params.createIntent();
          // 網頁的相簿可以一次選好幾張（最多 5 張由網頁自己管）
          if (params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) {
            pick.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
          }
          List<Intent> extras = new ArrayList<>();
          if (camera != null) extras.add(camera);
          launch = Intent.createChooser(pick, "選車的照片");
          if (!extras.isEmpty()) {
            launch.putExtra(Intent.EXTRA_INITIAL_INTENTS, extras.toArray(new Intent[0]));
          }
        }

        try {
          startActivityForResult(launch, REQ_FILE);
        } catch (Exception e) {
          pendingCallback = null;
          Toast.makeText(MainActivity.this, "打不開相簿", Toast.LENGTH_SHORT).show();
          callback.onReceiveValue(null);
          return false;
        }
        return true;
      }
    });

    keepLink(getIntent());
    String news = newsId(getIntent());
    web.loadUrl(news != null ? START_URL + "#news/" + Uri.encode(news) : START_URL);

    // 新車訊通知：排好每小時看一次；Android 13 以上第一次打開問一次可不可以跳通知
    NewsCheck.schedule(this);
    if (Build.VERSION.SDK_INT >= 33 && NewsCheck.wanted(this) && !NewsCheck.allowed(this)
        && !NewsCheck.prefs(this).getBoolean("asked", false)) {
      NewsCheck.prefs(this).edit().putBoolean("asked", true).apply();
      requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIFY);
    }
  }

  /** 按通知進來的 carid://news/<id>，回傳那篇的 id；不是就回 null。 */
  private static String newsId(Intent intent) {
    Uri data = intent != null ? intent.getData() : null;
    if (data == null || !"carid".equals(data.getScheme()) || !"news".equals(data.getHost())) return null;
    String path = data.getPath();
    if (path == null || path.length() < 2) return null;
    String id = path.substring(1);
    return id.matches("[\\w-]{1,40}") ? id : null;
  }

  @Override
  public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
    super.onRequestPermissionsResult(requestCode, permissions, results);
    if (requestCode != REQ_NOTIFY) return;
    boolean fromToggle = notifyFromToggle;
    notifyFromToggle = false;
    if (fromToggle && !NewsCheck.allowed(this)
        && !shouldShowRequestPermissionRationale(Manifest.permission.POST_NOTIFICATIONS)) {
      // 之前按過「不允許」，手機不會再問了：直接打開手機設定裡這個 App 的通知
      openNotifySettings();
    }
    notifyWeb();
  }

  private void openNotifySettings() {
    Intent i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
    i.putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName());
    try {
      startActivity(i);
    } catch (Exception e) {
      try {
        startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName())));
      } catch (Exception ignored) {
        // 打不開就算了
      }
    }
  }

  /** 通知的開關可能變了（剛問完、從手機設定回來），叫網頁重畫設定那一行。 */
  private void notifyWeb() {
    if (web != null) web.evaluateJavascript("window.caridNotifyChanged&&window.caridNotifyChanged()", null);
  }

  @Override
  protected void onNewIntent(Intent intent) {
    super.onNewIntent(intent);
    setIntent(intent);
    // App 本來就開著（singleTask），點了登入信跳回來會走這裡
    if (keepLink(intent)) deliverLink();
    // 點了新車訊的通知
    String news = newsId(intent);
    if (news != null && web != null) web.loadUrl(START_URL + "#news/" + Uri.encode(news));
  }

  /** 是 carid://login?… 就收起來，回傳有沒有收到。 */
  private boolean keepLink(Intent intent) {
    Uri data = intent != null ? intent.getData() : null;
    if (data == null || !"carid".equals(data.getScheme()) || !"login".equals(data.getHost())) return false;
    pendingLink = data.toString();
    return true;
  }

  /**
   * 把收著的登入連結交給網頁的 window.caridLink()。用 evaluateJavascript 只會送進主頁面，
   * 頁面裡的 iframe（例如 reCAPTCHA）拿不到。網頁還沒準備好就先留著，等它說 ready() 再送。
   */
  private void deliverLink() {
    final String link = pendingLink;
    if (link == null || web == null) return;
    pendingLink = null;
    web.evaluateJavascript(
        "window.caridLink?(window.caridLink(" + JSONObject.quote(link) + "),'ok'):''",
        result -> {
          if (!"\"ok\"".equals(result) && pendingLink == null) pendingLink = link;
        });
  }

  /** 網頁可以呼叫的小功能，在網頁裡叫 window.CaridApp。 */
  private class Bridge {
    /** 網頁準備好接登入連結了。 */
    @JavascriptInterface
    public void ready() {
      runOnUiThread(MainActivity.this::deliverLink);
    }

    /**
     * 改車頁開車、比賽的時候 true（全螢幕）、回到車庫頁 false。
     * 舊版 APK 沒有這個，網頁會先看有沒有（typeof CaridApp.setFullscreen）才叫，沒有就只有網頁裡的全螢幕。
     */
    @JavascriptInterface
    public void setFullscreen(boolean on) {
      runOnUiThread(() -> {
        fullscreen = on;
        applyFullscreen();
      });
    }

    /**
     * 設定裡「車訊通知」那一行：on（開著、手機也准）、off（關掉了）、blocked（開著，但手機不准跳通知）。
     * 舊版 APK 沒有這個，網頁看到沒有就不顯示那一行。
     */
    @JavascriptInterface
    public String newsNotify() {
      if (!NewsCheck.wanted(MainActivity.this)) return "off";
      return NewsCheck.allowed(MainActivity.this) ? "on" : "blocked";
    }

    /** 開／關車訊通知。開的時候手機還不准：Android 13 以上先問，不然帶去手機的通知設定。 */
    @JavascriptInterface
    public void setNewsNotify(boolean on) {
      NewsCheck.setWanted(MainActivity.this, on);
      if (!on || NewsCheck.allowed(MainActivity.this)) return;
      runOnUiThread(() -> {
        if (Build.VERSION.SDK_INT >= 33) {
          notifyFromToggle = true;
          NewsCheck.prefs(MainActivity.this).edit().putBoolean("asked", true).apply();
          requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIFY);
        } else {
          openNotifySettings();
        }
      });
    }

    /** 網頁的車訊頁已經秀出這篇了，就不用再通知它。 */
    @JavascriptInterface
    public void newsSeen(String id, String date) {
      NewsCheck.seen(MainActivity.this, id, date);
    }

    /** 打開手機的信箱 App（通常是 Gmail），找不到就回 false。 */
    @JavascriptInterface
    public boolean openMail() {
      Intent mail = Intent.makeMainSelectorActivity(Intent.ACTION_MAIN, Intent.CATEGORY_APP_EMAIL);
      mail.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      try {
        startActivity(mail);
        return true;
      } catch (Exception e) {
        return false;
      }
    }
  }

  /**
   * 照 fullscreen 藏起／放回上面的狀態列和下面的導覽列。藏起來的時候從螢幕邊邊滑一下會暫時跑出來（蓋在畫面上），
   * 過一下又自己收回去，不會把網頁擠來擠去。
   */
  private void applyFullscreen() {
    WindowInsetsControllerCompat bars = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
    if (fullscreen) {
      bars.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
      bars.hide(WindowInsetsCompat.Type.systemBars());
    } else {
      bars.show(WindowInsetsCompat.Type.systemBars());
    }
  }

  @Override
  protected void onResume() {
    super.onResume();
    // 切到別的 App 再回來：狀態列、導覽列會跑出來，還在全螢幕就再藏一次
    if (fullscreen) applyFullscreen();
    // 可能剛從手機的通知設定回來
    notifyWeb();
  }

  @Override
  public void onWindowFocusChanged(boolean hasFocus) {
    super.onWindowFocusChanged(hasFocus);
    // 拉下通知欄、跳出對話框再回來也一樣
    if (hasFocus && fullscreen) applyFullscreen();
  }

  /** 這個 APK 的版號，對應 GitHub Release 的 apk-N。 */
  private int versionCode() {
    try {
      return getPackageManager().getPackageInfo(getPackageName(), 0).versionCode;
    } catch (PackageManager.NameNotFoundException e) {
      return 0;
    }
  }

  /** 相機的 Intent；沒有相機 App 或建不出暫存檔就回 null，只留相簿。 */
  private Intent cameraIntent() {
    Intent intent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
    PackageManager pm = getPackageManager();
    if (intent.resolveActivity(pm) == null) return null;

    try {
      File dir = new File(getCacheDir(), "shots");
      if (!dir.exists() && !dir.mkdirs()) return null;
      File shot = File.createTempFile("shot_", ".jpg", dir);
      cameraOutputUri = FileProvider.getUriForFile(
          this, getPackageName() + ".fileprovider", shot);
    } catch (IOException e) {
      return null;
    }

    intent.putExtra(MediaStore.EXTRA_OUTPUT, cameraOutputUri);
    intent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
    return intent;
  }

  @Override
  protected void onActivityResult(int requestCode, int resultCode, Intent data) {
    if (requestCode != REQ_FILE) {
      super.onActivityResult(requestCode, resultCode, data);
      return;
    }

    ValueCallback<Uri[]> callback = pendingCallback;
    pendingCallback = null;
    if (callback == null) return;

    if (resultCode != Activity.RESULT_OK) {
      // 使用者按了返回：一定要回 null，不然網頁那邊會一直等
      callback.onReceiveValue(null);
      return;
    }

    Uri[] result = null;
    // 相簿一次選好幾張時，照片放在 ClipData；系統的 parseResult 只看 getData()，只會拿到一張或拿不到
    ClipData clip = data != null ? data.getClipData() : null;
    if (clip != null && clip.getItemCount() > 0) {
      List<Uri> uris = new ArrayList<>();
      for (int i = 0; i < clip.getItemCount(); i++) {
        Uri u = clip.getItemAt(i).getUri();
        if (u != null) uris.add(u);
      }
      if (!uris.isEmpty()) result = uris.toArray(new Uri[0]);
    }
    if (result == null && data != null && data.getData() != null) {
      result = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
    }
    if (result == null && cameraOutputUri != null) {
      // 相機拍完通常不會帶 data 回來，照片在我們給它的那個 Uri
      result = new Uri[]{cameraOutputUri};
    }
    callback.onReceiveValue(result);
  }

  @Override
  public void onBackPressed() {
    if (fullscreen && web != null) {
      // 全螢幕玩的時候：返回鍵先離開全螢幕（跟按畫面右上角那個鈕一樣），不要一下就離開改車頁
      fullscreen = false;
      applyFullscreen();
      web.evaluateJavascript("window.caridExitFullscreen&&window.caridExitFullscreen()", null);
      return;
    }
    if (web != null && web.canGoBack()) web.goBack();
    else super.onBackPressed();
  }
}
