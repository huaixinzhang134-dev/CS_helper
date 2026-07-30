/**
 * 激励视频广告工具
 *
 * 按微信官方示例实现：
 *   1. 模块加载时创建广告实例（单例），绑定事件一次
 *   2. 每次调用 playRewardedAd 直接 show()，失败 load+retry
 *   3. 不做 offLoad/offError/offClose（官方示例没有）
 *   4. 队列机制：前一次播放未结束时，新调用排队等待
 */
import { REWARDED_VIDEO_AD_UNIT_ID } from '../config';

type AdResult = 'completed' | 'closed_early' | 'error';

/** 广告实例（单例，只创建一次） */
let ad: any = null;

/** 等待队列：前一次未结束时，新调用排队 */
let pendingQueue: Array<{ resolve: (r: AdResult) => void }> = [];
let isPlaying = false;

/** 创建广告实例并绑定事件（只执行一次） */
function ensureAd() {
  if (ad) return;
  if (!wx.createRewardedVideoAd) return;

  ad = wx.createRewardedVideoAd({
    adUnitId: REWARDED_VIDEO_AD_UNIT_ID,
  });

  // 只绑定一次，不做 off（与官方示例一致）
  ad.onLoad(() => {
    // 仅用于日志，不做任何操作
  });

  ad.onError((err: any) => {
    console.warn('[Ad] 加载/播放失败', err);
    // 通知所有等待中的调用
    flushQueue('error');
  });

  ad.onClose((res: any) => {
    if (res && res.isEnded) {
      flushQueue('completed');
    } else {
      flushQueue('closed_early');
    }
  });
}

/** 通知队列中所有等待的 Promise */
function flushQueue(result: AdResult) {
  const q = pendingQueue;
  pendingQueue = [];
  isPlaying = false;
  for (const item of q) {
    item.resolve(result);
  }
}

/**
 * 播放激励视频广告
 * @returns 'completed' 完整观看 / 'closed_early' 中途关闭 / 'error' 异常
 */
export function playRewardedAd(): Promise<AdResult> {
  return new Promise((resolve) => {
    ensureAd();

    if (!ad) {
      console.warn('[Ad] 环境不支持');
      resolve('error');
      return;
    }

    // 如果正在播放，排队等待
    if (isPlaying) {
      pendingQueue.push({ resolve });
      return;
    }

    // 标记播放中
    isPlaying = true;
    pendingQueue.push({ resolve });

    // 直接 show（标准做法）
    // 注意：不要等 onLoad，广告可能已缓存不会再触发 onLoad
    ad.show().catch(() => {
      // show 失败 → 加载后重试
      ad.load().then(() => {
        ad.show().catch(() => {
          flushQueue('error');
        });
      }).catch(() => {
        flushQueue('error');
      });
    });
  });
}
