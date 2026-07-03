import { useEffect, useState, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import QRCode from "qrcode";
import { usePlayerStore } from "../../stores/playerStore";
import { engineRef } from "../../App";
import type { Track } from "../../stores/libraryStore";
import "../../styles/library.css";

type LoginMode = "menu" | "qrcode" | "cookie";

/** 网易云音乐视图 */
export function NeteaseView() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [mode, setMode] = useState<LoginMode>("menu");
  // 扫码
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [qrKey, setQrKey] = useState("");
  const [qrStatus, setQrStatus] = useState("");
  const [qrExpired, setQrExpired] = useState(false);
  const pollRef = useRef<number>(0);
  // cookie
  const [cookieInput, setCookieInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // 搜索
  const [tracks, setTracks] = useState<Track[]>([]);
  const [keyword, setKeyword] = useState("");
  const currentIndex = usePlayerStore((s) => s.currentIndex);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const setQueue = usePlayerStore((s) => s.setQueue);

  useEffect(() => {
    invoke<boolean>("netease_status").then(setLoggedIn).catch(() => {});
    return () => clearInterval(pollRef.current);
  }, []);

  // 生成二维码
  const startQrcode = useCallback(async () => {
    setError("");
    setQrExpired(false);
    setQrDataUrl(""); // 清空旧二维码，显示"生成中"
    setQrStatus("正在生成二维码…");
    setMode("qrcode"); // 关键：立即切到二维码界面
    try {
      const info = await invoke<{ key: string; qr_url: string }>("netease_qrcode_create");
      setQrKey(info.key);
      // 用 qrcode 库把 URL 渲染成 data URL
      const dataUrl = await QRCode.toDataURL(info.qr_url, { width: 220, margin: 1 });
      setQrDataUrl(dataUrl);
      setQrStatus("请用网易云音乐 APP 扫码");
      // 开始轮询
      startPolling(info.key);
    } catch (e: any) {
      setError(e?.message || "生成二维码失败");
    }
  }, []);

  const startPolling = useCallback((key: string) => {
    clearInterval(pollRef.current);
    pollRef.current = window.setInterval(async () => {
      try {
        const r = await invoke<{ code: number; message: string }>("netease_qrcode_check", { key });
        setQrStatus(r.message);
        if (r.code === 800) {
          clearInterval(pollRef.current);
          setQrExpired(true);
        } else if (r.code === 802) {
          setQrStatus("已扫码，请在手机确认登录");
        } else if (r.code === 803) {
          clearInterval(pollRef.current);
          setLoggedIn(true);
          setMode("menu");
        }
      } catch (e: any) {
        clearInterval(pollRef.current);
        setError(e?.message || "查询扫码状态失败");
      }
    }, 2000);
  }, []);

  const doCookieLogin = async () => {
    if (!cookieInput.trim()) return;
    setLoading(true); setError("");
    try {
      await invoke("netease_login", { cookie: cookieInput });
      setLoggedIn(true); setMode("menu"); setCookieInput("");
    } catch (e: any) { setError(e?.message || String(e)); }
    finally { setLoading(false); }
  };

  const doSearch = async () => {
    if (!keyword.trim()) return;
    setLoading(true); setError("");
    try {
      const list = await invoke<Track[]>("netease_search", { keyword });
      setTracks(list); setQueue(list);
    } catch (e: any) { setError(e?.message || String(e)); }
    finally { setLoading(false); }
  };

  const handlePlay = async (track: Track, index: number) => {
    try {
      const url = await invoke<string>("netease_stream", { trackId: track.source_track_id });
      usePlayerStore.getState().setCurrent(track, index);
      engineRef.playPath(url);
    } catch (e: any) { setError(e?.message || "获取播放地址失败（可能需要VIP）"); }
  };

  // ===== 未登录：登录界面 =====
  if (!loggedIn) {
    return (
      <div className="library__empty">
        <div className="library__empty-icon">🎵</div>
        {mode === "menu" && (
          <>
            <div className="library__empty-title">登录网易云音乐</div>
            <div className="library__empty-desc" style={{ marginBottom: 20 }}>
              绑定你的账号，使用自己的权益听歌
            </div>
            <button className="btn-scan" onClick={startQrcode}>📱 扫码登录（推荐）</button>
            <button className="btn-scan" style={{ background: "#333", marginTop: 10 }} onClick={() => setMode("cookie")}>
              🍪 Cookie 登录
            </button>
          </>
        )}

        {mode === "qrcode" && (
          <div style={{ textAlign: "center" }}>
            <div className="library__empty-title" style={{ marginBottom: 16 }}>扫码登录</div>
            {qrExpired ? (
              <>
                <div style={{ color: "#ff6b6b", marginBottom: 16 }}>二维码已过期</div>
                <button className="btn-scan" onClick={startQrcode}>重新生成</button>
              </>
            ) : qrDataUrl ? (
              <>
                <img src={qrDataUrl} alt="二维码" style={{ borderRadius: 12, boxShadow: "0 4px 20px rgba(0,0,0,0.4)" }} />
                <div style={{ marginTop: 16, color: "#9a9ab0", fontSize: 13 }}>{qrStatus}</div>
              </>
            ) : (
              <div style={{ width: 220, height: 220, background: "#1a1a2a", borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", color: "#5a5a70" }}>生成中…</div>
            )}
            <div style={{ marginTop: 16 }}>
              <button className="btn-scan" style={{ background: "#333" }} onClick={() => { clearInterval(pollRef.current); setMode("menu"); }}>返回</button>
            </div>
          </div>
        )}

        {mode === "cookie" && (
          <div style={{ maxWidth: 500, width: "100%", textAlign: "left" }}>
            <p style={{ fontSize: 12, color: "#9a9ab0", marginBottom: 8, lineHeight: 1.6 }}>
              1. 浏览器打开 music.163.com 并登录<br />
              2. F12 → Application → Cookies → 复制 <code style={{ color: "#ff9248" }}>MUSIC_U</code> 的值<br />
              3. 粘贴到下方（格式：<code>MUSIC_U=xxxxx</code>）
            </p>
            <textarea className="library__search-input" style={{ height: 70, paddingTop: 10, resize: "none", fontFamily: "monospace" }}
              placeholder="MUSIC_U=你的cookie值" value={cookieInput} onChange={(e) => setCookieInput(e.target.value)} />
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button className="btn-scan" onClick={doCookieLogin} disabled={loading}>{loading ? "登录中…" : "确认登录"}</button>
              <button className="btn-scan" style={{ background: "#333" }} onClick={() => setMode("menu")}>返回</button>
            </div>
          </div>
        )}
        {error && (
          <div style={{ marginTop: 16, padding: 12, color: "#ff6b6b", fontSize: 13, background: "rgba(255,80,80,0.08)", borderRadius: 8, maxWidth: 500 }}>
            ⚠️ {error}
          </div>
        )}
      </div>
    );
  }

  // ===== 已登录：搜索界面 =====
  return (
    <div className="library">
      <div className="library__toolbar">
        <div className="library__search">
          <svg className="library__search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none">
            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
            <path d="m21 21-4.3-4.3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <input className="library__search-input" placeholder="搜索网易云歌曲…" value={keyword}
            onChange={(e) => setKeyword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && doSearch()} />
        </div>
        <button className="btn-scan" style={{ background: "#333" }} onClick={async () => { await invoke("netease_logout"); setLoggedIn(false); setTracks([]); }}>退出</button>
      </div>
      {error && <div style={{ padding: 12, color: "#ff6b6b", fontSize: 13, background: "rgba(255,80,80,0.08)", borderRadius: 8, marginBottom: 16 }}>⚠️ {error}</div>}
      {tracks.length === 0 ? (
        <div className="library__empty"><div className="library__empty-icon">🎵</div>
          <div className="library__empty-title">搜索网易云音乐</div>
          <div className="library__empty-desc">实验性 · 依赖网易云接口</div></div>
      ) : (
        <div className="library__list">
          <div className="lib-header"><span className="col-i">#</span><span className="col-title">标题</span>
            <span className="col-artist">艺术家</span><span className="col-album">专辑</span><span className="col-dur">时长</span></div>
          <div className="lib-rows">
            {tracks.map((t, i) => {
              const active = currentIndex === i;
              const d = t.meta.duration_secs;
              return (
                <div key={t.id} className={`lib-row ${active ? "lib-row--active" : ""}`} onDoubleClick={() => handlePlay(t, i)}>
                  <span className="col-i">{active && isPlaying ? <span className="eq-bars"><i></i><i></i><i></i></span> : <><span className="idx">{i + 1}</span><svg className="play-hover" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg></>}</span>
                  <span className="col-title" onClick={() => handlePlay(t, i)}><span className="col-title__txt">{t.meta.title}</span><span className="q-badge q-high">NE</span></span>
                  <span className="col-artist">{t.meta.artist}</span>
                  <span className="col-album">{t.meta.album || "—"}</span>
                  <span className="col-dur">{d ? `${Math.floor(d/60)}:${Math.floor(d%60).toString().padStart(2,"0")}` : "—"}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
