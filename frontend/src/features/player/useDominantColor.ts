import { useEffect } from "react";
import { getCoverUrl, extractDominantColor } from "./useCover";
import { usePlayerStore } from "../../stores/playerStore";
import type { Track } from "../../stores/libraryStore";

/**
 * 封面主色提取副作用 hook
 *
 * 监听当前 track 的封面 URL，提取主色写入 playerStore.dominantColor。
 * 切歌/换封面时重新提取；无封面或 CORS 失败时写 null（auto 主题退回橙色默认）。
 */
export function useDominantColor(track: Track | null) {
  const setDominantColor = usePlayerStore((s) => s.setDominantColor);
  const cover = getCoverUrl(track);

  useEffect(() => {
    if (!cover) {
      setDominantColor(null);
      return;
    }
    let cancelled = false;
    void extractDominantColor(cover).then((c) => {
      if (!cancelled) setDominantColor(c);
    });
    return () => {
      cancelled = true;
    };
  }, [cover, setDominantColor]);
}
