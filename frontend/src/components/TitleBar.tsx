import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "../styles/titlebar.css";

/**
 * 自定义窗口标题栏（对标 MineRadio #desktop-titlebar）
 *
 * Tauri 2 decorations:false 后，窗口失去系统边框，需自己实现：
 *   - 拖拽区（data-tauri-drag-region）
 *   - 最小化 / 最大化 / 关闭按钮
 *   - 最大化时去圆角（监听 isMaximized）
 *
 * 左侧显示 OrangeRadio logo + 标题，右侧窗口控件。
 * 高 38px，透明背景，叠在主内容上方。
 */
export function TitleBar() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const win = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    const sync = (max: boolean) => {
      setMaximized(max);
      document.body.classList.toggle("window-maximized", max);
    };
    win.isMaximized().then(sync).catch(() => {});
    win.onResized(() => win.isMaximized().then(sync).catch(() => {})).then((un) => (unlisten = un));
    return () => { unlisten?.(); document.body.classList.remove("window-maximized"); };
  }, []);

  const minimize = () => getCurrentWindow().minimize().catch(() => {});
  const toggleMax = () => getCurrentWindow().toggleMaximize().catch(() => {});
  const close = () => getCurrentWindow().close().catch(() => {});

  return (
    <div className={`titlebar ${maximized ? "titlebar--maximized" : ""}`}>
      <div className="titlebar__drag" data-tauri-drag-region>
        <span className="titlebar__logo">OrangeRadio</span>
        <span className="titlebar__title">沉浸式智能音乐播放器</span>
      </div>
      <div className="titlebar__controls">
        <button className="titlebar__btn" onClick={minimize} title="最小化">
          <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
        </button>
        <button className="titlebar__btn" onClick={toggleMax} title={maximized ? "还原" : "最大化"}>
          {maximized ? (
            <svg width="12" height="12" viewBox="0 0 12 12"><path d="M3 5V3h2M9 7V9H7M3 5l2-2M9 7l-2 2" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 12 12"><rect x="2.5" y="2.5" width="7" height="7" stroke="currentColor" strokeWidth="1.2" fill="none" rx="1" /></svg>
          )}
        </button>
        <button className="titlebar__btn titlebar__btn--close" onClick={close} title="关闭">
          <svg width="12" height="12" viewBox="0 0 12 12"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
        </button>
      </div>
    </div>
  );
}
