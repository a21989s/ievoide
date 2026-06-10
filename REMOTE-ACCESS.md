# 手机 / 外网远程访问

让手机（任意网络，4G/5G/WiFi）通过 Cloudflare Tunnel 安全访问本机引擎，全程 HTTPS，不暴露公网 IP、不需要路由器端口映射。

## 访问地址

```
https://dev.feioz.com/?token=<令牌>
```

- 令牌存放于：`data/server-token.txt`（当前为 32 位强令牌）
- 仅 `/api/*` 接口校验令牌；根页面 `/` 不校验（只是静态页）

## 架构

```
手机 → Cloudflare 边缘 → cloudflared 隧道(出站) → 本机 node server.mjs:8787
```

- 引擎：`node server.mjs`，监听 `8787`
- 隧道：cloudflared，隧道名 `claude-tools`，域名 `dev.feioz.com`
- 隧道为**出站**连接，无需端口映射，无需开放入站端口

## 持久化（三重保障，均为 Windows 计划任务，独立于任何对话）

| 任务名 | 作用 | 触发 |
|--------|------|------|
| `ClaudeEngine` | 跑 `_autostart-engine.vbs` → `_autostart-engine.cmd`（循环 node） | 登录时 |
| `ClaudeTunnel` | 跑 `_autostart-tunnel.vbs` → `_autostart-tunnel.cmd`（循环 cloudflared） | 登录时 |
| `ClaudeWatchdog` | 每 3 分钟检查 8787 与 cloudflared，挂了就重启对应任务 | 登录时 + 每 3 分钟 |

- `.cmd` 外层 `:loop` 循环：进程崩溃 3 秒自动重启
- 电源已设为**永不睡眠**（`powercfg /change standby-timeout-ac/dc 0`）

### 相关文件

- 引擎启动器：`_autostart-engine.cmd` / `_autostart-engine.vbs`（本项目目录）
- 隧道启动器：`C:\Users\a21989\.cloudflared\_autostart-tunnel.cmd` / `.vbs`
- 看门狗：`C:\Users\a21989\.cloudflared\_watchdog.ps1`（日志 `watchdog.log`）
- 隧道配置：`C:\Users\a21989\.cloudflared\config.yml`
- 隧道凭据：`C:\Users\a21989\.cloudflared\<tunnelID>.json`（保密）
- 账户证书：`C:\Users\a21989\.cloudflared\cert.pem`（仅管理用）

## 常用运维命令

```powershell
# 看三个任务状态
Get-ScheduledTask -TaskName "Claude*" | Select TaskName,State

# 手动重启
Start-ScheduledTask -TaskName "ClaudeEngine"
Start-ScheduledTask -TaskName "ClaudeTunnel"

# 检查本地端口与隧道连接
(netstat -ano | Select-String 'LISTENING' | Select-String ':8787').Count
cloudflared tunnel info claude-tools

# 公网连通测试
Invoke-WebRequest "https://dev.feioz.com/api/list?token=<令牌>" -UseBasicParsing

# 换令牌：改 data/server-token.txt 后重启引擎任务
```

## 排障速查

| 现象 | 排查 |
|------|------|
| 手机打不开、公网 530 | 隧道没连：`cloudflared tunnel info claude-tools` 看连接数；重启 `ClaudeTunnel` |
| 公网页面能开但操作 401 | 令牌不对，核对 `data/server-token.txt` |
| 页面打不开、本机也不行 | 引擎挂了：查 8787 是否监听；重启 `ClaudeEngine` |
| 重启电脑后全断 | 需登录 Windows 账户（任务为登录态运行）；登录后自动恢复 |

## 不可软件兜底的前提

- 电脑需保持开机（已设永不睡眠）
- 物理断网 / 断电无法兜底
- 注销 Windows 账户会停掉任务（锁屏无影响）

## 历史记录共享（桌面端 ↔ 手机端）

桌面端与手机端**共用同一份**历史文件 `data/claude-tools-conversations.json`，结构 `{ list:[{id,title,sessionId,html}], active }`。

- 服务端接口（server.mjs）：
  - `GET /api/convs` 读取整份历史
  - `POST /api/convs` 覆盖写入整份历史
- 手机端（mobile.html）：
  - `loadConvs` 优先从服务器加载，本地 `localStorage` 仅作离线兜底
  - `saveConvs` 防抖 0.8s 推送到服务器
  - 回到前台（visibilitychange）自动拉取最新，保持当前所在对话、回复中不打断
- 效果：一端开的对话另一端可见，且 `sessionId` 共享可直接续聊（resume）

**并发模型（共用同一份 / 后写为准）**：保存是整份覆盖。正常一次用一端没问题；桌面端每轮回复会把自己完整列表写回，具自愈性。**不要两端同时改同一批对话**。若日后需要无覆盖风险的实时双向同步，需另做文件监听+推送(SSE)+合并。

## 历史踩坑

- cloudflared 装成 **LocalSystem 服务会反复 flapping**（它去 `systemprofile\.cloudflared` 找配置，权限/路径不对）。已弃用服务，改用**登录态计划任务**，已 `sc delete Cloudflared`。
- `server.mjs` 默认监听 `0.0.0.0:8787`（IPv4+IPv6），局域网直连需放行 Windows 防火墙入站 8787（已加规则 `Claude Tools 8787`）。走隧道后非必需。
</content>
