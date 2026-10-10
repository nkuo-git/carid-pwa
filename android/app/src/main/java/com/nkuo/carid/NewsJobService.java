package com.nkuo.carid;

import android.app.job.JobParameters;
import android.app.job.JobService;

/** 系統大約每小時叫一次：在背景執行緒看有沒有新車訊（NewsCheck）。 */
public class NewsJobService extends JobService {

  @Override
  public boolean onStartJob(JobParameters params) {
    new Thread(() -> {
      try {
        NewsCheck.check(getApplicationContext());
      } finally {
        jobFinished(params, false);
      }
    }, "news-check").start();
    return true;
  }

  @Override
  public boolean onStopJob(JobParameters params) {
    return true;   // 被系統中斷（例如網路斷了）就等下次再跑
  }
}
