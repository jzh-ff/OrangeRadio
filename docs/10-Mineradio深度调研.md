# Mineradio 深度调研

> **对标项目实现剖析** · 调研日期 2026-07-05
> 调研对象:[XxHuberrr/Mineradio](https://github.com/XxHuberrr/Mineradio)(GPL-3.0,Electron)
> 调研目的:为 OrangeRadio 的音源接入与沉浸式视觉实现提供可借鉴的参照与差异判断。

---

## 0. 关键结论(先读这段)

1. Mineradio 是 **Electron + 原生 JS(无 React/Vue)+ 本地 Node HTTP 服务** 的桌面播放器,与 OrangeRadio(Tauri 2 + Rust + React)架构路线完全不同。
2. **它没有独立的"排行榜"功能,QQ 音乐也没有"每日推荐"** —— 这两点常被误传。它的"每日推荐"= 网易云 `recommend_songs`;双平台其实是「网易云做全套 + QQ 只补音源」的不对称设计。
3. Mineradio 真正的招牌是 **预计算节拍图谱驱动的电影运镜** —— 这是与 OrangeRadio 拉开视觉差距的核心,也是本调研第 3、4 章的重点。
4. OrangeRadio 在 **cookie 安全存储(AuthStore: AES-GCM + keyring)** 和 **架构可维护性(分层 Rust crate)** 上已完胜;差距集中在 **节拍驱动方式(实时 vs 预计算)**。

---

## 1. 整体架构:一个 167KB 的 `server.js` 扛下所有

```
desktop/main.js        ← Electron 主进程,起本地 server、管登录窗口
server.js (167KB)      ← http.createServer 手写路由(不用 express!),~50 个 /api 端点
public/index.html (1.35MB / 26879 行)  ← 前端单页,Three.js + GSAP 全内联
dj-analyzer.js (33KB)  ← 节奏/节拍图谱分析(server 端预计算)
public/vendor/         ← three.r128、gsap、music-tempo(BPM 库)
```

启动时主进程拉起 `server.js` 监听 `0.0.0.0:3000`,前端 `index.html` 通过 `fetch('/api/...')` 调本地服务,服务端再带着用户 cookie 去打网易云/QQ 的真实接口。**所有 cookie 存本机文件**(`./.cookie`、`./.qq-cookie`),不上传。

> ⚠️ **架构安全代价**:Electron 渲染进程 + 本地裸 HTTP 服务 + **明文 cookie 文件**。这正是 OrangeRadio 用 Tauri + Rust + AuthStore(keyring + AES-GCM)想要规避的。

---

## 2. 网易云 & QQ 音乐接入

### 2.1 网易云:直接用 `NeteaseCloudMusicApi` 这个 Node 库

`server.js` 顶部直接 require 了社区库 [Binaryify/NeteaseCloudMusicApi](https://github.com/Binaryify/NeteaseCloudMusicApi):

```js
const { login_qr_key, login_qr_create, login_qr_check, login_status,
  cloudsearch, song_detail, song_url_v1, song_url,
  personalized, recommend_resource, recommend_songs,   // 推荐 / 每日推荐
  playlist_detail, playlist_track_all,                  // 歌单
  dj_hot, dj_sublist, user_audio, dj_paygift,           // 播客
  lyric, lyric_new, comment_music, ... } = require('NeteaseCloudMusicApi');
```

Mineradio **完全没自己写 weapi 加密** —— 把这个脏活全交给库了。OrangeRadio 在 `crates/orange-sources/src/netease.rs` + `weapi.rs` 自己实现了 weapi 加密,工作量大但完全自主可控。

### 2.2 QQ 音乐:纯手写,直连 `musicu.fcg`

QQ 音乐没有可用开源库,Mineradio 自己手写了完整的 QQ 接口栈(`server.js` 2260–2860 行):

| 功能 | QQ 官方接口 |
|------|------------|
| 登录态 | 抓 `qm_keyst` / `qqmusic_key` / `music_key` / `wxskey` cookie |
| 用户资料 | `c.y.qq.com/rsc/fcgi-bin/fcg_get_profile_homepage.fcg` |
| 自建歌单 | `fcg_user_created_diss` |
| 收藏歌单 | `fcg_get_profile_order_asset.fcg` |
| 歌单详情 | `qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg` |
| **播放地址** | `u.y.qq.com/cgi-bin/musicu.fcg` → `vkey.GetVkeyServer` 拿 `purl` |
| 歌词 | `lyric/fcgi-bin/fcg_query_lyric_new.fcg` |
| 评论 | `base/fcgi-bin/fcg_global_comment_h5.fcg` |

**最关键的坑**(作者专门写了 `docs/QQ_MUSIC_INTERFACE_NOTES.md` 记录):

> `p_skey` 只能证明"网页 QQ 登录态",**不等于播放授权**;真正决定能不能拿到 `purl` 的是 `qm_keyst` / `qqmusic_key` / `music_key`。缺这些 key 时 `vkey` 会返回 `104003`,表现为"能看歌单但正式歌播不了"。

所以它的登录窗口拿到 `p_skey` 后不立即关闭,会继续 warmup 到 QQ 音乐播放器页等 `qm_keyst`。

> OrangeRadio 的 `qqmusic_stream` 走的是 `resolve_to_file`(代理下载到本地,绕 CDN CORS),而 Mineradio 是直接给前端 `purl` URL。两种思路都成立,OrangeRadio 的更适合 Tauri 的安全模型。

### 2.3 登录 / 歌单 / 排行榜 / 每日推荐 —— 具体端点对照

| 功能 | Mineradio 的实现 | 真相 |
|-----------|----------------|------|
| **网易云登录** | `/api/login/qr/key` + `/qr/create` + `/qr/check`(扫码轮询)+ `/api/login/cookie`(导入) | ✅ 扫码为主 |
| **网易云歌单** | `/api/user/playlists` → `user_playlist`;`/api/playlist/tracks` → `playlist_track_all` | ✅ |
| **网易云每日推荐** | 打包在 `/api/discover/home` 里 → `recommend_songs`(每日推荐)+ `personalized`(推荐歌单)+ `recommend_resource`(每日推荐歌单)+ `dj_hot`(热门播客) | ✅ 但**没有独立端点** |
| **网易云排行榜** | ❌ **没有**。`server.js` 全文搜不到 `toplist` 调用 | Mineradio 不做排行榜 |
| **QQ 登录** | `/api/qq/login/status` + `/api/qq/login/cookie`(读 `.qq-cookie`);真正的扫码登录窗口在 `desktop/main.js` 里(BrowserWindow 加载 QQ 官网抓 cookie) | ✅ |
| **QQ 歌单** | `/api/qq/user/playlists` → `fcg_user_created_diss` + `fcg_get_profile_order_asset` | ✅ |
| **QQ 每日推荐 / 排行榜** | ❌ **都没有**。QQ 在 Mineradio 里只是「搜索 + 登录态 + 取流地址」的**音源补充** | 官方没开放,逆向也不稳 |
| **跨源搜索** | `/api/search`(网易云 `cloudsearch`)+ `/api/qq/search`(QQ `smartbox_new.fcg`) | 缺失音源自动换源 |

**结论**:Mineradio 的「每日推荐」= 网易云 `recommend_songs`;「排行榜」它根本没做;「双平台」其实是**网易云做全套 + QQ 只补音源**的不对称设计。OrangeRadio 已经实现了网易云每日推荐(`netease_daily`),这块已和 Mineradio 持平。

---

## 3. 招牌视觉:粒子背景 + 电影级运镜 + 节奏震动

这是 Mineradio 真正花心思的地方,也是 `index.html` 有 26879 行的原因。

### 3.1 粒子背景 —— 双层渲染,不用 EffectComposer

它**没有用 Three.js 的后处理(UnrealBloomPass)**,而是用**同一份粒子几何画两遍**模拟辉光(`index.html:6359-6398`):

```js
// 第一层:bloom 辉光层(加色混合,大点)
var bloomParticles = new THREE.Points(geo, bloomMaterial);
//   blending: THREE.AdditiveBlending, depthTest: false
//   gl_PointSize 放大 uBloomSize 倍,alpha × uBloomStrength × 0.55
// 第二层:主体层(正常混合,清晰点)
var particles = new THREE.Points(geo, material);
//   blending: THREE.NormalBlending, renderOrder=1
```

**非常聪明的性能取舍**:后处理 bloom 要多一个 render target + 高斯模糊 pass,对低端机很重;双层粒子几乎零额外成本,视觉上"亮的地方自然发亮"。

**粒子形状有 7 种预设**:`emily cover`(封面像素化)/ `tunnel` / `orbit` / `void` / `vinyl` / `wallpaper` / `skull`(头骨点云,加载 `public/assets/skull-decimation-points.bin` 这个 1MB 的 3D 扫描点云)。封面预设的核心函数 `buildCoverParticleGeometry(grid)`(5711 行)是把专辑封面图片像素化成粒子坐标 —— **粒子就是被拆碎的封面**。

### 3.2 电影级运镜 —— 相机系统 v7.1

核心思想是**把用户的拖拽和「电影模式」的自动运镜分离叠加**(`index.html:3785`):

```js
// 最终相机角度 = 用户拖的目标 + 电影模式的微偏移
theta = userOrbit.theta + cinemaOffset.theta
```

这样即使用户在拖动,电影运镜的"呼吸感"也始终叠加。还有 `freeCamera`(WASD + 鼠标 第一人称)+ `focus`(hover 到 3D 歌单架/队列时镜头跟拍)。

### 3.3 节奏震动 —— 节拍驱动的镜头 ADSR 包络(最精华)

这是 Mineradio 视觉的灵魂,也是与 OrangeRadio **差距最大**的地方。**每个节拍触发一个镜头冲击**,精细到音色。

`scheduleBeatCamera()`(`index.html:4615`)为每个节拍生成一个冲击事件,带 attack / hold / release 三段包络(类似合成器的 ADSR):

```js
// 每个节拍按音色分模式:deep(低频/kick)、body(中频)、snap(高频/镲)
mode = snapTone > 0.42 ? 'snap' : bodyTone > 0.46 ? 'body' : 'deep'

// 不同模式 + 不同拍位(combo)给不同的镜头运动幅度:
combo: 'downbeat' | 'push' | 'drop' | 'rebound' | 'accent'
zoomAmp  = 0.070 + mass*0.190 + ...   // 推拉
phiAmp   = 俯仰
thetaAmp = 水平摇
rollAmp  = 滚动(snap 模式才明显)
```

`updateBeatCamera()`(`index.html:4893`)按当前播放时间回放这些事件:

```js
// downbeat(强拍):径向 zoom 冲击 + 轻微低头
radiusKick = leadPunch * zoomAmp;
phiKick    = -leadPunch * 0.0032;
// accent(重音):加滚动晃动
rollKick   = sign * leadPunch * rollAmp * (0.45 + snapFlick*0.30);
```

最后 `applyFreeCameraToCamera()`(`index.html:3921`)把这些 kick 按 `fx.cinemaShake`(0~1.8,用户可调)系数**叠到相机 rotation 和 FOV 上**:

```js
camera.rotation.set(
  pitch + beatCam.phiKick    * cameraShake * 0.45,   // 俯仰震动
  yaw   + beatCam.thetaKick  * cameraShake * 0.45,   // 水平震
  roll  + beatCam.rollKick   * cameraShake           // 滚动震(全幅)
);
camera.fov -= cameraPunch * 1.75;                     // FOV "punch" 缩放
```

**这就是"节奏震动"** —— 不是随机抖动,而是每个鼓点精确触发一次有包络的镜头冲击:强拍推镜头、重音滚动、镲片轻晃。`fx.cinemaShake=0` 时完全静止,1.8 时剧烈。

> OrangeRadio 现在 `useBeatDetector.ts` 是**实时频谱检测**驱动 `BeatParticles`。差别在于:Mineradio 是**预知整首歌每一拍的时间点**,所以能做到「鼓点未到镜头先蓄势、鼓点到的瞬间冲击」;实时检测只能「检测到能量变化 → 反应」,永远慢半拍且无法做 combo 编排。这是「能跟着律动」和「电影级精准卡点」的本质差距。

---

## 4. "AI 分析" —— 其实是 `dj-analyzer.js` 的节拍图谱预计算

Mineradio 宣传的「节奏分析 / AI 分析」**不是大模型 AI**,而是 `dj-analyzer.js` 里的**数字信号处理 + 节拍追踪算法**。流程:

```
1. mpg123-decoder 流式解码整首音频(Node 端,不是浏览器)
2. 双巴特沃斯滤波:高通 32Hz + 低通 178Hz → 只留 kick/bass 低频
3. 每 10ms 一帧,算 RMS(lowEnergy)+ peak(hitEnergy)
4. onset detection:滑动窗口(0.82s)内能量上升沿,自适应阈值 mean + std*1.66
5. 候选节拍 → 网格量化:用候选间隔直方图估计全局 step(BPM),clamp 到 0.32~0.86s/拍
6. 相位对齐:遍历找最佳 anchor,让网格和真实节拍最贴合
7. 每拍输出:{ time, impact, strength, low, body, snap, mass, sharpness, combo(downbeat/push/drop/rebound/accent) }
8. 缓存到 D:\MineradioCache\beatmaps,键 = 歌曲,下次秒读
```

**长音频(播客 / DJ,> 55 分钟)的分段采样策略**很巧妙(`analyzePodcastDjRangeSamples`,`dj-analyzer.js:520`):不全量解码,而是按 content-length 用 HTTP Range 抓 8~12 个 ~90s 的样本段,分别建图,再用相位投票拼成全局节拍图谱。这是为了播客 / DJ 模式不卡顿。

前端拿这个图谱后,`processRealtimeBeatEngine` 按 `audio.currentTime` 在图谱上推进,到点就触发 `scheduleBeatCamera`。**所以「电影级运镜」是预计算图谱 + 时间轴回放,不是实时反应。**

---

## 5. 对 OrangeRadio 的启示(重点)

把 Mineradio 的方案对照 OrangeRadio 现状,几个可操作的判断:

| 维度 | Mineradio | OrangeRadio 现状 | 建议 |
|------|-----------|-----------------|------|
| **节拍驱动** | 预计算整首图谱(server 解码 + 缓存),精准卡点 | 实时 `useBeatDetector` 频谱,粗粒度律动 | **最值得补的差距**。可在 Rust 侧(`orange-audio`)用 symphonia 解码 + DSP 算图谱,缓存到 `.orangeradio/beatmaps/`,前端按时间轴回放。这才是「电影级」的前提 |
| **bloom 视觉** | 双层粒子(主体 + 加色辉光层),零后处理成本 | `BeatParticles` + bloomStrength 参数 | 可借鉴双层粒子技巧,比 EffectComposer 轻 |
| **镜头震动** | beatCam:每拍 ADSR 包络 × combo × 音色,叠到 rotation + FOV | 暂无(只有粒子) | 抽象出 `beatCam {phiKick, thetaKick, rollKick, radiusKick, punch}`,在 `useAudioEngine` 的渲染循环里按图谱驱动 |
| **网易云加密** | 直接用 NeteaseCloudMusicApi 库 | 自己写 weapi(`weapi.rs`) | OrangeRadio 更自主,但工作量已在;可把 Mineradio / lib 的接口路径当对照参考 |
| **QQ 取流** | 直给前端 purl URL | `resolve_to_file` 代理下载本地 | OrangeRadio 更适合 Tauri;注意 Mineradio 那个 `qm_keyst` 授权坑迟早也会撞 |
| **cookie 存储** | 明文文件 `.qq-cookie` | AuthStore(AES-GCM + keyring) | **OrangeRadio 完胜**,这是 Tauri/Rust 的安全红利 |
| **排行榜** | 没做 | —— | 网易云 `toplist` 接口库里有,要做很容易,Mineradio 反而没做 |
| **框架** | 原生 JS 26879 行单文件 | React + 分层 Rust crate | OrangeRadio 架构清晰得多,长期可维护性碾压 |

### 最关键的一条建议

如果要让 OrangeRadio 在视觉上真正「超越 Mineradio」,**优先级最高的不是加更多粒子,而是把节拍从「实时检测」升级成「预计算图谱」**。Mineradio 整个视觉体系的根基就是 `dj-analyzer.js` 那套 DSP。OrangeRadio 的 `orange-audio` crate 现在还是 trait 骨架 —— **在这里落地一个 Rust 版的节拍图谱分析器(symphonia 解码 + 带通滤波 + onset + 网格量化),是 v0.3 / v0.4 最有战略价值的一步**。

---

## 6. 参考来源

- [GitHub - XxHuberrr/Mineradio](https://github.com/XxHuberrr/Mineradio)(源码,GPL-3.0)
- [Mineradio 功能详解 · 格律诗的软件世界](https://www.jamecling.com/archives/1900)
- [GitCode 镜像](https://gitcode.com/gh_mirrors/mi/Mineradio)
- [Binaryify/NeteaseCloudMusicApi](https://github.com/Binaryify/NeteaseCloudMusicApi)(Mineradio 用的网易云库)

---

## 附录:调研中直接阅读的 Mineradio 源码文件

| 文件 | 大小 | 作用 |
|------|------|------|
| `server.js` | 167KB | 所有音源 API、登录、cookie 持久化、天气电台、更新检测 |
| `dj-analyzer.js` | 33KB | 节拍图谱预计算(DSP + onset + 网格量化) |
| `public/index.html` | 1.35MB / 26879 行 | 前端单页,Three.js 粒子 + 相机运镜 + GSAP 全内联 |
| `desktop/main.js` | 50KB | Electron 主进程、QQ 扫码登录窗口 |
| `docs/QQ_MUSIC_INTERFACE_NOTES.md` | 2.7KB | QQ 音乐 `qm_keyst` 授权坑排障记录 |
| `public/assets/skull-decimation-points.bin` | 1MB | 头骨 3D 扫描点云(skull 预设的粒子数据) |
