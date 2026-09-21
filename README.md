# 会场发言计时联屏（Venue Countdown）

一款用于会场发言计时、议程推演与**后台提示**的 Web 应用：一个**控制台**维护有序议程
（环节名称、计划开始时间、时长、固定开始标记）并设定当前环节，开始 / 暂停 / 继续 / 重置；
当前环节**提前结束或超时**后自动推演后续偏差，多块大屏打开**投屏页**实时联播倒计时、
当前/下一环节及其预计开始时间；进入 60 秒与归零时切换醒目状态。控制台还可向**一块、多块
或全部在线投屏**全屏推送“请上场／加快／结束”或不超过 30 字的自定义提示，按屏幕实时查看
未送达 / 已显示 / 已确认。控制台还提供**现场标记**：持有控制权时在当前环节记录带名称的
事件（发言切换、设备故障等），服务端以单调时钟固化发生时刻、归属环节与相对计划偏差，
按时间线展示、可删除最近一条并按本场会话导出 CSV（投屏不显示任何标记）。

- **后端**：Node.js 原生 HTTP + [`ws`](https://github.com/websockets/ws) WebSocket
- **前端**：React 18 + Vite（控制台 `/console`、投屏 `/display`）
- **部署**：单容器单端口（静态文件与 WebSocket 同端口），Docker / Compose 一键启动

## 快速开始（单条命令：构建镜像并启动）

需要 Docker 与 Docker Compose v2：

```bash
docker compose up --build
```

启动后访问（容器对外端口 **3000**）：

| 页面 | 地址 | 说明 |
| --- | --- | --- |
| 首页 | <http://localhost:3000/> | 入口导航 |
| 控制台 | <http://localhost:3000/console> | 维护议程、设定当前环节、开始/暂停/继续/结束本环节（同一时刻仅一个可操作） |
| 投屏页 | <http://localhost:3000/display> | 大屏展示当前环节、下一环节及其预计开始时间，可在任意多块屏幕同时打开 |

### Docker / Compose 启动说明

**方式一：Docker Compose（推荐，仓库已带 `docker-compose.yml`）**

```bash
docker compose up --build        # 前台启动（看日志，Ctrl+C 停止容器）
docker compose up --build -d     # 后台启动
docker compose logs -f           # 跟踪后台容器日志
docker compose down              # 停止并移除容器
docker compose restart venue-countdown   # 重启（内存中的提示/标记随之清空）
```

修改宿主机映射端口（容器内始终监听 3000）：

```bash
PORT=8080 docker compose up --build      # 之后访问 http://localhost:8080
# 或持久化：在仓库根目录创建 .env，写入一行  PORT=8080
```

**方式二：直接用 Docker（不依赖 Compose）**

```bash
docker build -t venue-countdown .
docker run --rm -p 3000:3000 --name venue-countdown venue-countdown
# 后台运行加 -d；换宿主机端口：-p 8080:3000；查看日志：docker logs -f venue-countdown
```

> 计时锚点、后台提示与现场标记均只保存在服务进程内存中，不挂卷、无外部依赖；
> 容器 / 服务重启即恢复初始议程，未确认提示与本场标记清空（投屏屏幕 ID 在浏览器本地保留）。

也可不使用 Docker，直接使用根目录 npm 脚本（等价于 Compose）：`npm run up`、`npm run up:detached`、`npm run down`。

### 典型操作入口（控制台页内）

1. 在 **议程偏差推演** 面板逐行维护有序环节：名称、计划开始（`HH:MM`）、时长（分钟）、
   勾选 📌 表示**固定环节**；可用 ↑↓ 排序、增删行，完成后点 **保存议程并同步投屏**。
2. 点某一行的 **设为当前** 载入该环节并开始倒计时；运行中可暂停/继续，
   点 **结束本环节 / 进入下一环节** 按实际结束点固化偏差并自动开始下一环节。
3. 投屏页无需任何操作，即同步显示当前环节名称、倒计时、下一环节与预计开始时间。

### 后台提示（cue）

1. 在每块大屏用浏览器打开 `/display`：**首次打开自动生成该屏唯一 ID 并持久化**
   （localStorage），刷新页面 / 重开浏览器仍是同一块屏；点左下角 **设置显示名**
   可起一个好认的名字（如“主席台主屏”“分会场侧屏”）。
2. 在控制台 **后台提示** 面板勾选目标：一块、多块，或勾选 **全选在线**；
   也可勾选当前离线的屏幕，其提示会排队，待其重新连接后自动补发。
3. 点 **请上场 / 加快 / 结束** 预设，或输入 **不超过 30 字** 的自定义提示后发送。
4. 目标投屏立即全屏显示提示（绿/琥珀/红三种醒目配色），现场人员点 **✓ 确认收到** 收起。
5. 面板按屏幕实时显示每块屏最新提示的状态：**未送达 / 已显示 / 已确认**。
   新提示覆盖旧提示；对同一块屏重发只会显示最新一条；非目标屏不显示、不能代为确认。
6. 提示仅需控制台持有者发送（与计时/议程同一把唯一控制权锁）。

> 提示状态保存在服务端内存中（不引入数据库或第三方服务）：服务进程重启后未确认提示会清空，
> 但投屏的屏幕 ID 与显示名在浏览器本地保留，重开后自动重新注册。

### 现场标记（marker）

1. 在控制台 **现场标记** 面板输入名称（不超过 **30 字**，如“发言切换”“设备故障”）后回车，
   或点 **发言切换 / 设备故障 / 提示上场 / 现场干扰** 预设一键记录；运行、暂停、超时、
   待开始等任意计时状态下均可记录。
2. 每条标记在**记录瞬间**由服务端固化：单调时钟发生时刻（含会话内相对时间 `T+` 与本地挂钟时间）、
   **归属环节**（名称/序号快照）、记录时该环节已用时长、计时状态与**相对计划偏差**
   （进入当前环节时的顺延量 + 本环节超时累积，固定环节顺延量恒为 0）。
3. 面板按 **seq 升序时间线** 展示本场全部标记；可 **删除最近一条**
   （仅删 seq 最大者，可连续撤销），或点 **导出 CSV** 下载本场会话全部标记
   （UTF-8 BOM，Excel 直接打开中文不乱码，列：序号/发生时刻/会话内时间/环节序号/环节名称/环节已用秒数/相对计划偏差秒数/计时状态/标记名称）。
4. **投屏不显示标记**：标记消息只推送给控制台类连接，投屏注册后不接收任何标记更新。
5. 暂停计时、断线重连、进入下一环节或整体改写议程，**历史标记的顺序与归属均保持不变**
   （旧标记仍挂在记录时的环节名下）。标记仅持有者可新增 / 删除；导出无需控制权。
6. “本场会话”= 一个服务进程生命周期：服务 / 容器重启即清空并开始新会话（带新的 `sessionId`）；
   数据只存服务端内存，不引入数据库或文件。

### 设备巡检门禁（inspection）

开始当前计时前，可用“设备巡检门禁”强制完成逐项设备检查：

1. 在控制台 **设备巡检门禁** 面板点 **维护巡检项**，维护最多 **30 项**巡检项：
   每项含**名称**（如“无线麦”）、**区域**（如“主席台”，可空）与 **必检** 标记，保存后同步。
2. 持有者在登记态对每项逐项登记：**✓ 通过**，或填写**故障备注**（1~100 字，必填）后登记 **✕ 故障**。
   面板每项实时显示 **待检（灰）/ 通过（绿）/ 故障（红）**，顶部汇总各项计数。
3. 门禁由**服务端权威判定**：仅当**全部必检项均为通过**、且放行所依据的巡检清单版本未变化时，
   “开始”才会被服务端接受；否则服务端拒绝并返回 `INSPECTION_GATE`，控制台“开始”按钮同步置灰并提示原因。
4. **任一必检项被改回故障**，门禁**立即失效**并向所有控制台连接广播原因（面板顶部红条即时提示）；
   **编辑清单**（增删项、改名称/区域/必检）保存后全部登记重置为待检、巡检版本递增、门禁立即失效，
   需逐项重新登记、全部必检复检通过后才再次放行。内容无变化的保存不会使门禁失效。
5. **非必检项**不参与门禁：其待检 / 故障状态不拦截开始。没有任何必检项时门禁不启用、不拦截开始。
6. 门禁只拦截“从零开始”（待开始 / 超时后重新开始）；**暂停后的“继续”**以及
   “结束本环节 / 进入下一环节”的自动连续计时不受门禁限制，巡检中途出故障不会掐断正在进行的发言。
7. 巡检数据仅存服务端内存（服务 / 容器重启即清空），仅持有者可维护与登记；**投屏不显示任何巡检信息**。

投屏页建议按 **F11** 全屏。另起一台电脑/平板做控制台时，把 `localhost` 换成本机局域网 IP 即可。

## 本地开发（不用 Docker）

一条命令安装全部 workspace 依赖：

```bash
npm install                 # 安装 server 与 client 全部依赖
npm run dev:server          # 终端 1：服务端 http://localhost:3000（--watch 热重启）
npm run dev:client          # 终端 2：Vite 开发服务器 http://localhost:5173（/ws 自动代理到 3000）
```

开发时控制台/投屏请使用 Vite 地址 <http://localhost:5173/console>、<http://localhost:5173/display>。

生产方式本地运行（单条命令完成依赖安装、构建并启动）：

```bash
npm install && npm run build && npm start
# → http://localhost:3000
```

可通过环境变量 `PORT` 修改服务端口（默认 3000）。

## 功能与状态

- 议程维护：有序环节，每项含名称、计划开始时间（`HH:MM`）、时长与可选的 📌 **固定开始** 标记。
- 当前环节：任意一项可设为当前环节（自动载入其时长），支持开始 / 暂停 / 继续 / 重置。
- **偏差推演**：
  - 当前环节提前结束（手动进入下一环节）为负偏差、超时为正偏差；后续**普通环节**按偏差整体顺延/提前；
  - **固定环节**始终保留计划开始时间；若前序推演与其重叠，自动压缩固定环节前**最后一个普通环节**
    （可能就是当前环节），并在控制台与投屏上标红 **“时间不足”**；
  - 归零后不自动跳环节：超时量逐秒累积、后续预计开始持续后移，由控制台决定何时结束本环节。
- 投屏联播：当前环节名称、倒计时、**下一环节及其预计开始时间**；60 秒琥珀警示、归零红色全屏告警。
- 投屏断线重连：重连首包即收到权威快照（含完整议程与推演结果），恢复**同一剩余时间与同一议程视图**。
- 顶部横幅提示重连过程；重连期间数字不跳变、旧消息不会让画面回滚。
- **后台提示**：
  - 每块投屏首次打开生成并持久化**不可重复的屏幕 ID**（刷新沿用），可设置显示名；
  - 控制台向**一块、多块或全部在线投屏**推送“请上场／加快／结束”及 ≤30 字自定义提示；
    每次发送生成**全服务单调递增 `cueSeq`**，同一次群发共用同一序号；
  - 目标投屏**全屏显示**当前提示，现场可“确认收到”；控制台按屏实时列出
    **未送达 / 已显示 / 已确认**；
  - 新提示覆盖旧提示；迟到的旧确认、旧提示一律按 `cueSeq` 丢弃，**不改新提示状态**；
    非目标屏收不到、也不能代为确认；
  - 离线（或断线重连中）的目标屏，其未确认最新提示在重新注册后**自动补发**；
    状态只存服务端内存，无任何第三方服务。
- **现场标记**：
  - 持有者在任意计时状态记录 ≤30 字的命名事件（预设一键记录或自定义）；
  - 服务端在记录瞬间以单调时钟固化发生时刻（挂钟时间 + 会话内 `T+`）、归属环节（id/名称/序号快照）、
    该环节已用时长、计时状态与相对计划偏差（顺延量 + 本环节超时量）；
  - 控制台按 seq 时间线展示，支持删除最近一条与按本场会话导出 CSV（含 UTF-8 BOM）；
  - 标记消息仅推送给控制台类连接，**投屏永不显示**；
  - 暂停、重连、进入下一环节、改写议程都不改变历史标记的顺序与归属；
    仅存服务端内存，服务 / 容器重启即开启新会话（新 `sessionId`）。
- **设备巡检门禁**：
  - 持有者维护最多 **30 项**巡检项（名称 / 区域 / **必检**标记），逐项登记**通过**或带备注的**故障**；
  - 服务端仅在**全部必检项为通过**且放行所依据的巡检版本（`seq`）未变化时接受“开始当前计时”，
    否则拒绝（`INSPECTION_GATE`），控制台开始按钮置灰并提示原因（故障 / 待检 / 清单变更需重检）；
  - 任一必检项被改回故障、或清单被编辑（状态全部重置、版本递增），门禁**立即失效并广播原因**；
    重新逐项登记、全部必检复检通过后才再次放行；
  - 非必检项不参与门禁；无必检项时门禁不启用；暂停后的“继续”与“进入下一环节”不受门禁限制；
  - 巡检消息按连接角色过滤，**投屏永不显示**；仅存服务端内存，服务 / 容器重启即清空。

## 设计要点（对应可靠性要求）

1. **单调时钟唯一状态**：服务端用 `process.hrtime`（单调时钟）定锚。
   运行中不存“剩余秒数”，而存截止时刻 `deadlineMono`，剩余时间随时钟现算，
   不受系统时钟回拨影响；暂停时冻结剩余毫秒。议程的“已用时长/超时”用同一单调时钟度量，
   计划开始时间用与 Date/时区无关的**虚拟议程时钟**（毫秒 of-day），容器与浏览器结果一致。
2. **推演为服务端权威纯函数**：偏差顺延、固定点压缩全部在服务端 `projectAgenda` 计算后随快照下发，
   投屏/控制台不各自猜测；客户端仅在两份快照之间对超时外推做平滑插值。暂停、重连、
   控制权接管后都从同一份权威快照恢复，推演结果必然一致。
3. **递增版本快照**：每次广播的快照带严格递增的 `version` 与服务进程 `epoch`。
   投屏只接受 `version` 更高且 `epoch` 一致的快照，过期/乱序消息直接丢弃，画面永不回滚；
   `epoch` 用于区分服务端重启后的新基线。议程内容另有单调 `agenda.seq`，
   控制台保存后据此与权威快照对账，不会覆盖接管者的修改。
4. **重连恢复**：WebSocket 连接（含重连）后服务端立即发送完整快照，
   投屏以权威剩余时间为准；运行中客户端在两份快照之间用本地时钟插值平滑显示。
5. **唯一控制台 + 失联释放**：控制权是全服务唯一租约，第二个控制台申请会被拒绝；
   持有者每 5 秒发送心跳，超过 15 秒未续租即判定失联并**自动释放**，
   连接关闭同样立即释放，之后其他控制台可接管。控制台自身断线重连后会自动重新申请，
   议程草稿以重连后收到的权威快照为准。
6. **后台提示独立于计时通道**：提示消息（`cue`）不混在周期快照里，采用与快照相同的
   **epoch + 单调 seq 守卫**——服务端重启（新 epoch）或更小 `cueSeq` 的迟到消息直接丢弃，
   新提示（seq 更大）覆盖旧提示，seq 相等视为重连同一条补发（幂等重新上屏）。
   每屏内存只保存**最新一条**提示及其三态（未送达→已显示→已确认），
   投屏注册/重连时若最新提示未确认则单播补发；确认只接受“该屏当前连接、且 seq 等于最新提示”，
   从机制上杜绝替别人确认与旧确认回滚。
7. **现场标记只增快照、事后不可变**：标记不是计时状态，不进入 200ms 周期快照；
   新增 / 删除时才单独下发整体替换的 `markers` 消息（带 epoch 守卫）。每条标记的归属与偏差
   在产生瞬间用当时的 `projectAgenda` 视图固化为普通数据快照，因此暂停、重连、`advance`
   甚至整体改写议程都不会回写历史标记。发生时刻同时记录单调时钟（会话内 `T+`，不受挂钟回拨影响）
   与 ISO 挂钟时间（供人读与导出）。消息按连接角色过滤：已注册为投屏的连接不接收标记更新，
   从通道层面保证投屏不显示标记。
8. **巡检门禁为服务端权威的版本化放行**：门禁判定（`server/src/inspection.js` 纯函数）只依据
   必检项状态与放行锚点 `armedSeq`——全部必检项通过时在当前清单版本 `seq` 上锚定放行；
   必检项被登记回故障立即清除锚点，编辑清单则版本递增、全部状态重置为待检并清除锚点。
   客户端按钮置灰只是体验优化，真正的开始动作由服务端再次判定（纵深防御），任何绕过界面的
   `start` 同样会被拒绝。门禁状态翻转（放行↔失效）才单独广播 `inspection_gate`（含原因），
   普通登记只下发整体替换的 `inspection` 消息；两类消息均带 epoch 守卫且不发给投屏连接。

## WebSocket 协议（`/ws`）

客户端 → 服务端：

```jsonc
{ "command": "acquire" }                     // 申请控制权
{ "command": "heartbeat" }                   // 租约心跳（5s）
{ "command": "release" }                     // 主动释放
{ "command": "set_duration", "durationMs": 300000 }
{ "command": "start" }
{ "command": "pause" }
{ "command": "resume" }
{ "command": "reset", "durationMs": 300000 } // durationMs 可省略

// 议程偏差推演（同样仅持有者可调用）
{ "command": "agenda_set", "items": [
    { "id": "a-1", "name": "开场致辞", "startMs": 33300000, // 09:15，虚拟议程时钟 ms-of-day
      "durationMs": 600000, "fixed": false } ] }            // 整体替换有序议程
{ "command": "agenda_current", "id": "a-1" } // 设定当前环节（载入其时长，回到待开始）
{ "command": "advance" }                      // 结束当前环节（提前/超时），按偏差进入下一环节

// 现场标记（仅持有者；运行/暂停/超时/待开始均可记录）
{ "command": "mark_add", "name": "发言切换" } // 1~30 字；记录瞬间固化时刻/归属/偏差
{ "command": "mark_delete_latest" }           // 删除本场会话最近一条（seq 最大者）

// 设备巡检门禁（均仅持有者；投屏不接收巡检消息）
{ "command": "inspection_set", "items": [     // 整体替换巡检清单（最多 30 项）；实际编辑后全部重置为待检
    { "id": "i-mic1", "name": "无线麦", "area": "主席台", "required": true },
    { "id": "i-exit", "name": "消防通道", "area": "出口", "required": false } ] }
{ "command": "inspection_check", "id": "i-mic1", "status": "pass" }              // 逐项登记通过
{ "command": "inspection_check", "id": "i-mic1", "status": "fault",
  "note": "开机无声" }                      // 故障必填 1~100 字备注；必检项故障立即使门禁失效
// start 在 idle/finished 下受门禁拦截：全部必检通过且 armedSeq===seq 才接受（否则 INSPECTION_GATE）；
// 暂停后的 resume 与 advance 的自动连续计时不经过门禁

// 后台提示（投屏身份/改名/上报无需控制权；cue_send 仅持有者）
{ "command": "screen_register", "screenId": "s-<uuid>", "name": "主席台主屏" } // 投屏每次连接/重连注册
{ "command": "screen_rename", "screenId": "s-<uuid>", "name": "新显示名" }
{ "command": "cue_send", "targets": ["s-...", "s-..."], "cueType": "stage" }  // 一块/多块
{ "command": "cue_send", "targets": "*", "cueType": "custom", "text": "中场休息 10 分钟" }
// cueType: stage（请上场）| hurry（加快）| finish（结束）| custom（text 必填，trim 后 1~30 字）
{ "command": "cue_displayed", "screenId": "s-...", "cueSeq": 7 } // 目标投屏上屏后自动上报
{ "command": "cue_ack", "screenId": "s-...", "cueSeq": 7 }       // 目标投屏人工确认
```

服务端 → 客户端：

```jsonc
{ "type": "hello", "clientId": "c-xxxx", "epoch": "..." }
{ "type": "snapshot", "version": 42, "epoch": "...", "serverTimeMono": 0,
  "phase": "running",         // idle | running | paused | finished
  "durationMs": 300000, "remainingMs": 123456,
  "warning": false, "finished": false,
  "locked": true, "holderId": "c-xxxx",
  "agenda": {
    "seq": 3, "currentId": "a-1", "elapsedMs": 45000, "deviationMs": -15000,
    "items": [ { "id": "a-1", "name": "开场致辞", "startMs": 33300000,
                 "durationMs": 600000, "fixed": false,
                 "status": "current",   // planned | done | current | future
                 "projStartMs": 33285000, "projEndMs": 33885000,
                 "effDurationMs": 600000, "insufficient": false } ] } }
{ "type": "control", "granted": true, "targetId": "c-xxxx" }
{ "type": "control", "granted": false, "reason": "locked|released|disconnected|timeout",
  "targetId": "c-xxxx", "holderId": "c-yyyy" }
{ "type": "heartbeat_ack" }
{ "type": "error", "code": "NOT_CONTROLLER", "message": "..." }
// 议程相关错误码：BAD_AGENDA（时间/时长非法或条目超限）、NOT_FOUND、NO_CURRENT

// 后台提示相关
{ "type": "screen_hello", "screen": { "id": "s-...", "name": "主席台主屏", "online": true,
    "cue": { "seq": 7, "type": "stage", "text": "请上场", "status": "displayed" } } }
{ "type": "screens", "epoch": "...", "screens": [ /* 全部屏幕，整体替换；
    cue.status: pending（未送达）| displayed（已显示）| acknowledged（已确认）*/ ] }
{ "type": "cue", "epoch": "...", "cueSeq": 7, "cueType": "stage", "text": "请上场" } // 仅单播给目标屏
{ "type": "screen_conflict", "screenId": "s-...", "reason": "replaced" } // 同 ID 被新连接顶替

// 现场标记（整体替换；连接首包下发一次，之后仅新增/删除时下发；已注册投屏的连接不收）
{ "type": "markers", "epoch": "...", "sessionId": "m-...", "markers": [
  { "seq": 1, "name": "发言切换",
    "wallTime": "2026-09-21T01:23:45.678Z", // ISO8601 挂钟时间（人读/导出）
    "sessionElapsedMs": 183000,             // 相对本场会话起点（单调时钟）
    "phase": "running",                     // 记录瞬间计时状态 idle|running|paused|finished
    "itemId": "a-1", "itemName": "开场致辞", "itemIndex": 0, // 归属环节快照；无当前环节时为 null
    "itemElapsedMs": 45000,                 // 记录瞬间该环节已用时长（暂停冻结）；无环节为 null
    "deviationMs": -2000 } ] }              // 记录瞬间相对计划偏差（顺延量+本环节超时量）
// 错误码：BAD_MARK（名称为空或超 30 字）、MARK_LIMIT（本场超过 1000 条）、NO_MARK（空列表删除）

// 设备巡检门禁（整体替换；连接首包下发一次，清单编辑/逐项登记后下发；已注册投屏的连接不收）
{ "type": "inspection", "epoch": "...", "seq": 2, "armedSeq": 2,
  "gate": { "enabled": true, "armed": true, "reason": null, "requiredTotal": 2 },
  // 未放行时 reason: pending（有待检）| fault（必检项故障，带 reasonItem{id,name,note}）
  //                | recheck / version_changed（放行锚点缺失或版本已变）
  "items": [ { "id": "i-mic1", "name": "无线麦", "area": "主席台", "required": true,
               "status": "pass", "note": "" } ] } // status: pending | pass | fault
// 门禁放行状态翻转时单独广播（普通登记不打扰）；失效带原因与人读文案
{ "type": "inspection_gate", "epoch": "...", "seq": 2, "armed": false,
  "reason": "fault", "reasonText": "存在必检项故障", "gate": { /* 同 inspection.gate */ } }
// 开始被门禁拦截：{ "type": "error", "code": "INSPECTION_GATE", "message": "巡检门禁未放行：…" }
// 错误码：BAD_INSPECTION（清单非法/超 30 项/故障缺备注）、NOT_FOUND（巡检项已被编辑删除）、
//         INSPECTION_GATE（必检未全部通过或巡检版本变化时开始）
// 错误码：BAD_SCREEN（屏幕 ID 非法）、BAD_CUE（类型/文案/目标非法）、
//         BAD_TARGET（目标屏幕不存在）、NO_SCREEN（全发时无在线屏）、
//         NOT_YOUR_SCREEN（替别的屏幕改名/确认）、NOT_SCREEN（未注册即改名）
```

## 目录结构

```
.
├── Dockerfile               # 多阶段构建：Vite 构建 + Node 运行
├── docker-compose.yml       # 一键启动，映射 3000 端口
├── package.json             # npm workspaces 根清单
├── server/
│   └── src/
│       ├── index.js         # HTTP 静态服务 + WebSocket 状态机/租约 + 屏幕与后台提示 + 现场标记 + 巡检门禁
│       ├── agenda.js        # 议程偏差推演纯函数（顺延 / 固定点压缩 / 校验）
│       └── inspection.js    # 巡检门禁纯函数（清单校验 / 逐项登记 / 版本化放行判定）
└── client/
    ├── vite.config.js       # 开发代理 /ws -> localhost:3000
    └── src/
        ├── useSocket.js     # 自动重连、版本防回滚（快照+提示）、心跳续租、屏幕注册、标记/巡检列表
        ├── time.js          # 单调时钟插值、议程时钟格式化、挂钟时间/CSV 工具
        ├── guard.js         # 快照版本守卫 + 提示 cueSeq 守卫
        ├── screen.js        # 投屏持久屏幕 ID / 显示名（localStorage）
        └── pages/           # ConsolePage / DisplayPage / HomePage / AgendaPanel / CuePanel / MarkerPanel / InspectionPanel
```

## 测试

```bash
npm test
# guard.test.mjs       快照版本守卫 + 提示 cueSeq 守卫纯函数
# agenda.test.mjs      议程偏差推演纯函数（提前/超时/固定点压缩）
# cue.test.mjs         后台提示端到端（注册/三态/覆盖/旧确认丢弃/补发/群发/校验，自带独立实例）
# marker.test.mjs      现场标记端到端（权限/校验/归属固化/暂停冻结/重连/advance/超时偏差/投屏不收，自带独立实例）
# inspection.test.mjs  设备巡检门禁端到端（权限/校验/放行拦截/故障立即失效广播/编辑版本重置/继续不拦截/投屏不收，自带独立实例）
# e2e.mjs              WebSocket 端到端冒烟（需先启动服务端，默认端口 3000，可用 PORT 覆盖）
# lease.test.mjs       失联自动释放与接管（自带独立测试实例）
```
