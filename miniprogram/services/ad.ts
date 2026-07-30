/**
 * 激励视频广告工具
 * 封装 wx.createRewardedVideoAd，提供 Promise 化接口
 *
 * 使用方式：
 *   const result = await playRewardedAd();
 *   if (result === 'completed') 发放奖励
 */
import { REWARDED_VIDEO_AD_UNIT_ID } from '../config';

type AdResult = 'completed' | 'closed_early' | 'error';

let _adInstance: any = null;
const AD_TIMEOUT = 30000;

/**
 * 播放激励视频广告
 * @param timeout 超时时间（默认 30s）
 * @returns 'completed' 完整观看 / 'closed_early' 中途关闭 / 'error' 异常
 */
export function playRewardedAd(timeout: number = AD_TIMEOUT): Promise<AdResult> {
  return new Promise((resolve) => {
    // 1. 检查环境
    if (!wx.createRewardedVideoAd) {
      console.warn('[Ad] 当前环境不支持激励视频广告');
      resolve('error');
      return;
    }

    // 2. 获取或创建广告实例（单例）
    if (!_adInstance) {
      _adInstance = wx.createRewardedVideoAd({
        adUnitId: REWARDED_VIDEO_AD_UNIT_ID,
      });
    }
    const ad = _adInstance;

    // 3. 移除旧监听
    try { ad.offLoad(); } catch (_) {}
    try { ad.offError(); } catch (_) {}
    try { ad.offClose(); } catch (_) {}

    let settled = false;

    function finish(result: AdResult) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    }

    // 4. 超时保护
    const timer = setTimeout(() => {
      console.warn('[Ad] 广告超时');
      finish('error');
    }, timeout);

    // 5. 绑定事件
    ad.onLoad(() => {
      // 仅日志，不做 show（show 在外面统一调用）
    });

    ad.onError((err: any) => {
      console.warn('[Ad] 错误', err);
      finish('error');
    });

    ad.onClose((res: any) => {
      if (res && res.isEnded) {
        finish('completed');
      } else {
        finish('closed_early');
      }
    });

    // 6. 直接尝试显示（标准做法：show 失败再用 load+retry）
    //    不要等 onLoad，因为广告可能已缓存，onLoad 不会再触发
    ad.show().catch(() => {
      // show 失败 → 加载后再试
      ad.load().then(() => {
        ad.show().catch(() => finish('error'));
      }).catch(() => finish('error'));
    });
  });
}
