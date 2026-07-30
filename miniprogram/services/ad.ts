/**
 * 激励视频广告工具
 *
 * 按微信官方示例实现：
 *   1. 模块加载时创建广告实例（单例），事件只绑定一次
 *   2. 以 onClose 作为最终判断依据，onError 仅打日志不判失败
 *      （实测 onError 常比 onClose 先触发，但广告仍正常播放完毕）
 *   3. 60s 超时兜底，防止 onClose 永不触发
 *   4. 队列机制防止重复点击
 */
import { REWARDED_VIDEO_AD_UNIT_ID } from '../config';

type AdResult = 'completed' | 'closed_early' | 'error';

let ad: any = null;
let pendingQueue: Array<{ resolve: (r: AdResult) => void }> = [];
let isPlaying = false;
let playTimer: any = null;

function ensureAd() {
  if (ad) return;
  if (!wx.createRewardedVideoAd) return;
  ad = wx.createRewardedVideoAd({ adUnitId: REWARDED_VIDEO_AD_UNIT_ID });

  ad.onLoad(() => {});
  ad.onError((err: any) => {
    // 仅打日志，不做决定。onError 可能比 onClose 先触发但广告正常播完
    console.warn('[Ad] 内部日志（非致命）', err);
  });
  ad.onClose((res: any) => {
    clearTimeout(playTimer);
    if (res && res.isEnded) {
      flushQueue('completed');
    } else {
      flushQueue('closed_early');
    }
  });
}

function flushQueue(result: AdResult) {
  if (!isPlaying && pendingQueue.length === 0) return;
  const q = pendingQueue;
  pendingQueue = [];
  isPlaying = false;
  playTimer = null;
  for (const item of q) item.resolve(result);
}

export function playRewardedAd(): Promise<AdResult> {
  return new Promise((resolve) => {
    ensureAd();
    if (!ad) { resolve('error'); return; }

    if (isPlaying) { pendingQueue.push({ resolve }); return; }

    isPlaying = true;
    pendingQueue.push({ resolve });

    // 60s 超时：onClose 可能因某些内部错误永不触发
    playTimer = setTimeout(() => {
      console.warn('[Ad] 播放超时');
      flushQueue('error');
    }, 60000);

    ad.show().catch(() => {
      ad.load().then(() => {
        ad.show().catch(() => {
          clearTimeout(playTimer);
          flushQueue('error');
        });
      }).catch(() => {
        clearTimeout(playTimer);
        flushQueue('error');
      });
    });
  });
}
