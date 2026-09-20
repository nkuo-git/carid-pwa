package com.nkuo.carid;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.provider.MediaStore;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.core.content.FileProvider;

import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

/**
 * 很薄的一層殼：整個畫面就是 WebView，載入 GitHub Pages 上的辨車網頁。
 * 這裡唯一要自己處理的是網頁上的 <input type="file">，WebView 預設不會有反應，
 * 要自己把相簿與相機的 Intent 接起來。
 */
public class MainActivity extends Activity {

  /** 網頁版的網址；改版只要重新部署網頁，App 不用重編。 */
  private static final String START_URL = "https://nkuo-git.github.io/carid-pwa/";

  private static final int REQ_FILE = 1001;

  private WebView web;
  private ValueCallback<Uri[]> pendingCallback;
  private Uri cameraOutputUri;

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

    web.setWebViewClient(new WebViewClient() {
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

        Intent pick = params.createIntent();

        List<Intent> extras = new ArrayList<>();
        Intent camera = cameraIntent();
        if (camera != null) extras.add(camera);

        Intent chooser = Intent.createChooser(pick, "選一張車的照片");
        if (!extras.isEmpty()) {
          chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, extras.toArray(new Intent[0]));
        }

        try {
          startActivityForResult(chooser, REQ_FILE);
        } catch (Exception e) {
          pendingCallback = null;
          Toast.makeText(MainActivity.this, "打不開相簿", Toast.LENGTH_SHORT).show();
          callback.onReceiveValue(null);
          return false;
        }
        return true;
      }
    });

    web.loadUrl(START_URL);
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
    if (data != null && (data.getData() != null || data.getClipData() != null)) {
      result = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
    } else if (cameraOutputUri != null) {
      // 相機拍完通常不會帶 data 回來，照片在我們給它的那個 Uri
      result = new Uri[]{cameraOutputUri};
    }
    callback.onReceiveValue(result);
  }

  @Override
  public void onBackPressed() {
    if (web != null && web.canGoBack()) web.goBack();
    else super.onBackPressed();
  }
}
