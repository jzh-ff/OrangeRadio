import { EmptyStateIcon } from "../../components/EmptyState";

/** 汽水音乐视图（接口开发中，暂不可用） */
export function QishuiView() {
  return (
    <div className="library">
      <div className="section-title">
        <h3>汽水音乐</h3>
        <span className="section-title__sub">开发中</span>
      </div>

      <div className="library__empty">
        <div className="library__empty-icon"><EmptyStateIcon kind="music" /></div>
        <div className="library__empty-title">汽水音乐</div>
        <div className="library__empty-desc">
          汽水音乐（抖音系）接口需要复杂的签名加密和设备指纹，
          暂无法稳定接入。该功能正在开发中，敬请期待。
        </div>
      </div>
    </div>
  );
}
