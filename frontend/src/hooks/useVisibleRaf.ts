import { useEffect, useRef, useCallback } from "react";

export type RafCallback = (time: number, dt: number) => void;

export interface UseVisibleRafOptions {
  /** 是否启用 RAF，false 时暂停 */
  enabled?: boolean;
  /** 是否在 document.hidden 时暂停 */
  pauseOnHidden?: boolean;
  /** 是否在窗口失焦时暂停 */
  pauseOnBlur?: boolean;
  /** 降频到 targetFps；0 表示不限制（默认 60） */
  targetFps?: number;
}

/**
 * 可见性感知的 requestAnimationFrame hook。
 *
 * 默认行为：
 * - document.hidden 时自动暂停，恢复可见时自动继续
 * - enabled=false 时暂停
 * - 支持按 targetFps 降频
 *
 * 返回的 start/stop 可手动控制；组件卸载时自动清理。
 */
export function useVisibleRaf(
  callback: RafCallback,
  {
    enabled = true,
    pauseOnHidden = true,
    pauseOnBlur = false,
    targetFps = 0,
  }: UseVisibleRafOptions = {}
) {
  const rafRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const lastFrameTimeRef = useRef<number>(0);
  const pausedByHiddenRef = useRef(false);
  const pausedByBlurRef = useRef(false);
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  const minFrameInterval = targetFps > 0 ? 1000 / targetFps : 0;

  const tick = useCallback(
    (time: number) => {
      if (!enabled || pausedByHiddenRef.current || pausedByBlurRef.current) {
        rafRef.current = 0;
        return;
      }

      if (minFrameInterval > 0) {
        if (time - lastFrameTimeRef.current < minFrameInterval) {
          rafRef.current = requestAnimationFrame(tick);
          return;
        }
      }

      const last = lastTimeRef.current || time;
      const dt = time - last;
      lastTimeRef.current = time;
      lastFrameTimeRef.current = time;

      callbackRef.current(time, dt);

      rafRef.current = requestAnimationFrame(tick);
    },
    [enabled, minFrameInterval]
  );

  const start = useCallback(() => {
    if (rafRef.current) return;
    if (!enabled) return;
    if (pauseOnHidden && document.hidden) return;
    if (pauseOnBlur && !document.hasFocus()) return;
    lastTimeRef.current = 0;
    rafRef.current = requestAnimationFrame(tick);
  }, [enabled, pauseOnHidden, pauseOnBlur, tick]);

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
  }, []);

  useEffect(() => {
    if (enabled) start();
    else stop();
    return () => stop();
  }, [enabled, start, stop]);

  useEffect(() => {
    if (!pauseOnHidden) return;
    const onVisibility = () => {
      if (document.hidden) {
        pausedByHiddenRef.current = true;
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      } else {
        pausedByHiddenRef.current = false;
        start();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [pauseOnHidden, start]);

  useEffect(() => {
    if (!pauseOnBlur) return;
    const onBlur = () => {
      pausedByBlurRef.current = true;
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    };
    const onFocus = () => {
      pausedByBlurRef.current = false;
      start();
    };
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
    };
  }, [pauseOnBlur, start]);

  return { start, stop };
}

/**
 * 轻量版：只返回 start/stop，不自动监听 visibility。
 * 用于已有自己的 effect 逻辑的组件。
 */
export function useRaf(callback: RafCallback, enabled = true) {
  return useVisibleRaf(callback, { enabled, pauseOnHidden: false, pauseOnBlur: false });
}
