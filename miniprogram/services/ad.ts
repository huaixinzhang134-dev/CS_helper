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

/** 播放广告的超时时间（ms），防止广告一直无回调 */
const AD_TIMEOUT = 30000;

/**
 * 播放激励视频广告
 * 每次调用重用单例，但重新绑定事件
 * @param timeout 等待广告结果超时（默认 30s）
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

    // 3. 安全移除旧监听，避免重复绑定
    try { ad.offLoad(); } catch (_) {}
    try { ad.offError(); } catch (_) {}
    try { ad.offClose(); } catch (_) {}

    let settled = false;

    function finish(result: AdResult) {
      if (settled) return;
      settled = true;
      resolve(result);
    }

    // 4. 超时保护
    const timer = setTimeout(() => {
      console.warn('[Ad] 广告超时（30s）');
      finish('error');
    }, timeout);

    // 5. 加载成功
    ad.onLoad(() => {
      ad.show().catch(() => {
        // show 失败，重试一次
        ad.load().then(() => {
          ad.show().catch(() => finish('error'));
        }).catch(() => finish('error'));
      });
    });

    // 6. 加载/播放失败
    ad.onError((err: any) => {
      console.warn('[Ad] 广告错误', err);
      finish('error');
    });

    // 7. 广告关闭（关键：判断是否完整观看）
    ad.onClose((res: any) => {
      clearTimeout(timer);
      if (res && res.isEnded) {
        finish('completed');
      } else if (res === undefined) {
        // 极低版本兼容：res 可能 undefined，保守不给奖励
        finish('closed_early');
      } else {
        finish('closed_early');
      }
    });

    // 8. 开始加载
    ad.load();
  });
}
