/**
 * 激励视频广告工具
 * 封装 wx.createRewardedVideoAd，提供 Promise 化接口
 * 遵循微信官方文档：
 *   - onClose(res.isEnded) 判断是否完整观看
 *   - createRewardedVideoAd 返回单例，需管理事件监听避免重复绑定
 *
 * 使用方式：
 *   import { playRewardedAd } from '../../services/ad';
 *   const result = await playRewardedAd();
 *   if (result === 'completed') { /* 发奖励 */ }
 */
import { REWARDED_VIDEO_AD_UNIT_ID } from '../config';

type AdResult = 'completed' | 'closed_early' | 'error';

let adInstance: any = null;
let pendingPromise: { resolve: (r: AdResult) => void } | null = null;

/** 安全移除旧监听 */
function clearAdListeners(ad: any) {
  try {
    ad.offLoad();
    ad.offError();
    ad.offClose();
  } catch (_) { /* 低版本可能不支持 off */ }
}

/**
 * 播放激励视频广告
 * 在页面 onLoad 或点击按钮时调用
 * @returns 'completed' 完整观看 / 'closed_early' 中途关闭 / 'error' 异常
 */
export function playRewardedAd(): Promise<AdResult> {
  return new Promise((resolve) => {
    if (!wx.createRewardedVideoAd) {
      console.warn('[Ad] 当前环境不支持激励视频广告');
      resolve('error');
      return;
    }

    // 获取或创建广告实例（单例）
    if (!adInstance) {
      adInstance = wx.createRewardedVideoAd({
        adUnitId: REWARDED_VIDEO_AD_UNIT_ID,
      });
    }

    const ad = adInstance;

    // 先清除旧监听，再绑定新监听
    clearAdListeners(ad);

    // 广告加载成功 → 自动播放
    ad.onLoad(() => {
      ad.show().catch(() => {
        // show 失败，尝试重新加载
        ad.load().then(() => {
          ad.show().catch(() => {
            if (pendingPromise) {
              pendingPromise.resolve('error');
              pendingPromise = null;
            }
          });
        }).catch(() => {
          if (pendingPromise) {
            pendingPromise.resolve('error');
            pendingPromise = null;
          }
        });
      });
    });

    // 广告加载/播放出错
    ad.onError((err: any) => {
      console.warn('[Ad] 激励视频广告错误', err);
      if (pendingPromise) {
        pendingPromise.resolve('error');
        pendingPromise = null;
      }
    });

    // 广告关闭
    ad.onClose((res: any) => {
      const result: AdResult = (res && res.isEnded) ? 'completed' : 'closed_early';
      if (pendingPromise) {
        pendingPromise.resolve(result);
        pendingPromise = null;
      }
    });

    // 保存当前 Promise 回调
    pendingPromise = { resolve };

    // 加载广告
    ad.load();
  });
}
