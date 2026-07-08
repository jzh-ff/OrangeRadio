# 13 - 推荐系统与 LLM 接入技术文档

> 本文档记录 OrangeRadio 推荐系统的完整架构：本地画像打分基础 + BPM/上下文信号 + LLM 语义重排增强。

## 1. 推荐系统分层架构

```
┌─────────────────────────────────────────────────────────┐
│  前端：useAudioEngine.next() (懂你模式) / HomeView 推荐  │
└───────────────────────┬─────────────────────────────────┘
                        │ invoke("recommend_next", { llmConfig, mood })
                        ▼
┌─────────────────────────────────────────────────────────┐
│  recommend_next 命令（commands.rs）                      │
│  1. spawn_blocking: 画像聚合 + 播放历史 + 候选池          │
│  2. 推导上下文：时段→scene / mood 字符串→Mood enum       │
│  3. 按 llm_config 选择 recommender（local / with_llm）   │
└───────────────────────┬─────────────────────────────────┘
                        ▼
┌─────────────────────────────────────────────────────────┐
│  AiRecommendationEngine                                  │
│  ┌─────────────────────────────────────────────────┐    │
│  │ 第一层：本地画像打分 score()                     │    │
│  │  - artist/genre 加权 (+0.6/+0.4)                │    │
│  │  - skip 负反馈 (-0.5/-0.3/-1.0)                 │    │
│  │  - complete 正反馈 (+0.3/+0.2)                  │    │
│  │  - BPM 偏好匹配 (+0.2/-0.2)          ← 阶段2新增│    │
│  │  - 多样性（避免连续同艺人 -0.3）                 │    │
│  └────────────────────┬────────────────────────────┘    │
│                       ▼ 取 top-20                        │
│  ┌─────────────────────────────────────────────────┐    │
│  │ 第二层（可选）：LLM 语义重排          ← 阶段4新增│    │
│  │  - 构造 prompt（画像+候选+情绪+场景）            │    │
│  │  - LLM 从 20 首里选 1 首                         │    │
│  │  - 失败/未配置 → 回退本地 top1                   │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

## 2. 用户画像（UserProfile）

### 数据采集
- **播放历史**：`play_history` 表（track_id/played_at/played_secs/completed/skipped）
- **前端写入时机**：`useAudioEngine.onEnd` → `recordPlayback(true, false)`（听完=正反馈）；用户切歌 → `recordPlayback(false, true)`（跳过=负反馈）

### 聚合算法（`database.rs::aggregate_user_profile`）
- 取最近 2000 条播放历史
- 按行为赋权重：completed=1.0 / 未结束=0.5 / skipped=0.2
- 统计：
  - `top_artists` / `top_genres`（权重 top-20，归一化 [0,1]）
  - `hourly_activity[24]`（24 小时播放热度分布）
  - `skip_patterns` / `complete_patterns`（skip/complete 率 >0.5 的艺人/流派）
  - **`bpm_preference`**（按 BPM 分桶：<90=slow / 90-120=medium / 120-140=fast / >140=very_fast）← 阶段2新增

### BPM 探测
- **标签优先**：`metadata.rs` 用 lofty 读 `ItemKey::Bpm`（ID3v2 TBPM / VorbisComment BPM），零成本
- **音频分析兜底**：`analyze_track_bpm` 命令用 `orange_audio::decode_file + analyze_beatmap` 探测 BPM，写回 DB（延迟填充，不阻塞扫描）

## 3. 上下文信号（阶段3）

| 信号 | 来源 | 填充方式 |
|------|------|---------|
| **时段→场景** | `chrono::Utc::now()` | recommend_next 内推导：0-6/22+=Sleep，7-9=Commute，10-18=Work，18-22=Relax |
| **情绪** | 前端传 mood 字符串 | recommend_next 参数，转 Mood enum（happy/sad/calm/energetic/focused/romantic/nostalgic/melancholy） |
| **天气** | 预留 | 暂未实现（weather=None） |

打分加权：
- mood 命中（如 Energetic + 高 BPM 快歌）→ +0.25
- scene 命中（如 Sleep + slow/low-energy）→ +0.2
- hourly_activity 命中（当前小时历史播放多）→ +0.15

## 4. LLM 推荐接通（阶段4）

### Provider 抽象
- `LlmProvider` trait（`orange-ai/src/provider.rs`）：`chat()` + `chat_stream()`
- **`CloudLlmProvider`**：OpenAI 兼容协议（`POST {base}/chat/completions`），覆盖 GLM / OpenAI / DeepSeek / 通义千问
- **`MinimaxProvider`**：Anthropic 兼容协议（`POST {base}/v1/messages`）

### 配置传递（避免热替换 AppState）
**关键约束**：`AppState::default()` 跑在 localStorage 可见前，无法构造 LLM provider。

**方案**：`recommend_next` 命令加 `llm_config: Option<LlmConfig>` 参数
- 前端 `getLlmConfig()`（`lib/llmConfig.ts`）从 localStorage 读取
- 命令内：若 llm_config 有值且 api_key 非空，临时构造 `AiRecommendationEngine::with_llm(provider)`
- 不改 AppState 字段类型，不热替换

### LLM 重排逻辑
```
本地 score() 取 top-20 候选
  → 构造 prompt（画像 top_artists/top_genres + 候选列表 + mood/scene）
  → LLM 返回序号（temperature=0.3, max_tokens=16）
  → 解析序号选歌；失败回退本地 top1
```

### SettingsModal 配置
- Provider 下拉：复用 MiniMax / OpenAI 兼容
- OpenAI 兼容：API Key + Base URL + Model 三栏
- localStorage 键：`orangeradio_llm_provider` / `orangeradio_llm_key` / `orangeradio_llm_base` / `orangeradio_llm_model`
- 未配置 api_key → 纯本地打分（开箱即用，降级）

## 5. 全网搜索（search_all）

### 源注册表机制（阶段1重构）
- `SourceRegistry`（`orange-sources/src/lib.rs`）：`Vec<Arc<dyn AudioSource>>`
- AppState 持有 `sources: Arc<SourceRegistry>`，构造时注册全部 9 个网络音源
- `search_all` 遍历 `registry.list()`，`JoinSet` 并发，5s 超时，本地库走 `spawn_blocking`
- 新增音源只改 AppState 构造 + register 一处

### 当前覆盖的音源
| 源 | 是否需登录 | 在 search_all |
|----|----------|--------------|
| 本地库 | 否 | ✅（spawn_blocking） |
| 网易云 | 是 | ✅（is_ready 门控） |
| QQ 音乐 | 是 | ✅ |
| Spotify | 是 | ✅（is_ready 门控） |
| 网络电台 | 否 | ✅ |
| 歌曲宝 | 否 | ✅ |
| 酷狗 | 否 | ✅ |
| **酷我** | 否 | ✅（阶段1新增） |
| 汽水 | 否 | ✅（空实现占位） |
| 播客 RSS | 否 | ✅（keyword 当 URL，普通搜索返回空） |

## 6. 文件清单

### Rust
- `crates/orange-core/src/source.rs` — SourceKind 枚举（+Kuwo）
- `crates/orange-core/src/recommendation.rs` — UserProfile/BpmPreference/RecommendContext/Mood/Scene
- `crates/orange-sources/src/kuwo.rs` — 酷我音源（新增）
- `crates/orange-sources/src/lib.rs` — SourceRegistry（Arc 重构）
- `crates/orange-library/src/metadata.rs` — lofty 读 BPM 标签
- `crates/orange-library/src/database.rs` — update_track_bpm / aggregate_user_profile（BPM 分桶）
- `crates/orange-ai/src/provider.rs` — CloudLlmProvider::chat()（OpenAI 兼容实现）
- `crates/orange-ai/src/recommend.rs` — AiRecommendationEngine（LLM 重排 + BPM 打分）
- `crates/orange-tauri/src/lib.rs` — AppState（+kuwo +sources 字段）
- `crates/orange-tauri/src/commands.rs` — kuwo_* 命令 / analyze_track_bpm / recommend_next（mood+llm_config+scene）

### 前端
- `frontend/src/lib/llmConfig.ts` — getLlmConfig（新增）
- `frontend/src/components/SettingsModal.tsx` — provider 选择 + OpenAI 配置区
- `frontend/src/features/player/useAudioEngine.ts` — recommend_next 传 llmConfig
- `frontend/src/features/player/HomeView.tsx` — recommend_next 传 llmConfig
- `frontend/src/components/Sidebar.tsx` — recommend_next 传 llmConfig
