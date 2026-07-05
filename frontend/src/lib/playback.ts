import { invoke } from "@tauri-apps/api/core";
import { usePlayerStore } from "../stores/playerStore";

/**
 * 把"当前曲目的播放行为"写回后端 play_history，驱动用户画像 / 懂你模式。
 * - completed = 自然播完（audio ended）
 * - skipped = 用户主动切走（点下一首/上一首）
 * 二者可同时为 false（如应用关闭时中途未结束），但一般不同时为 true。
 *
 * trackId 用 currentTrack.id（Track 的 uuid 字符串，与 Rust 侧 t.id.0 对齐）。
 */
export function recordPlayback(completed: boolean, skipped: boolean): void {
  const s = usePlayerStore.getState();
  const t = s.currentTrack as { id?: string } | null;
  const id = t?.id;
  if (!id) return;
  void invoke("record_playback", {
    trackId: id,
    playedSecs: s.position,
    totalSecs: s.duration,
    completed,
    skipped,
  }).catch(() => {
    /* 忽略：记录失败不影响播放体验 */
  });
}
