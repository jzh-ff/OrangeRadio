/**
 * 一起听（Listen Together）WebSocket 客户端
 *
 * 连接社交后端（server crate，默认 ws://localhost:3847/ws/room/<id>），
 * 收发同步消息（play/pause/seek/track），实现跨端同步播放。
 *
 * 消息格式（JSON 字符串）：
 *   { action: "play" | "pause" | "seek" | "track", trackId?, source_kind?, position?, ts }
 */

export interface SyncMsg {
  action: "play" | "pause" | "seek" | "track";
  trackId?: string;
  source_kind?: string;
  position?: number;
  ts: number;
}

/** 默认社交后端地址（server crate 默认端口 3847） */
const DEFAULT_WS_BASE = "ws://localhost:3847";

let ws: WebSocket | null = null;
let currentRoom: string | null = null;
let handler: ((m: SyncMsg) => void) | null = null;

/** 设置远端同步消息处理（App 在 mount 时设） */
export function setSyncHandler(h: ((m: SyncMsg) => void) | null): void {
  handler = h;
}

/** 是否在房间中 */
export function isInRoom(): boolean {
  return ws !== null && ws.readyState === WebSocket.OPEN;
}

export function getCurrentRoom(): string | null {
  return currentRoom;
}

/** 加入房间 */
export function joinRoom(roomId: string): void {
  leaveRoom();
  const url = `${DEFAULT_WS_BASE}/ws/room/${encodeURIComponent(roomId)}`;
  try {
    ws = new WebSocket(url);
  } catch {
    ws = null;
    return;
  }
  currentRoom = roomId;
  ws.onmessage = (e) => {
    try {
      const m = JSON.parse(e.data) as SyncMsg;
      handler?.(m);
    } catch {
      /* 忽略非 JSON */
    }
  };
  ws.onclose = () => {
    ws = null;
  };
  ws.onerror = () => {
    /* 连接失败（server 未启动等） */
  };
}

/** 离开房间 */
export function leaveRoom(): void {
  if (ws) {
    try {
      ws.close();
    } catch {
      /* ignore */
    }
    ws = null;
  }
  currentRoom = null;
}

/** 广播一条同步消息给 room（其他客户端收到） */
export function sendSync(msg: SyncMsg): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* ignore */
    }
  }
}
