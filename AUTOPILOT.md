# Autopilot — 自驱动开发回路

这个项目跑一个"监控 → dry-run → 重启 → 改进 → 循环"的自驱动回路。本文件是每轮迭代的**标准流程与护栏**，自驱动循环每次迭代都应遵守。

## 运行机制（确定性部分，已就绪）

- `npm run dev` — 启动 `dev-watch.mjs`：监控 `main.js / preload.cjs / renderer/*.js / index.html`，
  保存即防抖 → `node --check` 语法校验（**dry-run 闸门**）→ 通过才重启 Electron；失败保留实例、打印错误。
- `npm run restart` — 单次重启（`dev-restart.sh`）。
- `npm run dryrun` — 仅做语法校验，不重启。
- Electron 日志：`/tmp/electron-tools.log`。

## 每轮迭代流程（我做的部分）

1. **找一个真实痛点**：bug、健壮性缺口、UX 不便、可精简处、性能问题。优先 bug 与 UX。
2. **核实**：动手前先用类型定义/源码/文档确认（例如 Electron API 签名），不靠记忆。
3. **最小改动**：一次只改一个聚焦点，匹配周围代码风格。
4. **dry-run**：`npm run dryrun` 必须通过（watcher 也会自动校验+重启验证）。
5. **单独 commit**：每个验证通过的改进一条 commit，**不 push**（可逐个回滚）。
6. **下一个**：重复，直到当前没有高把握的改进可做（loop-until-dry，别造无谓 churn）。

## 护栏

- **绝不** push、绝不改 git 历史、绝不动 `.git`。
- **绝不**为了"有产出"而制造无意义改动；没把握就停，并说明。
- 大重构 / 改外部行为 / 删功能：先说明再做，别默默来。
- 每条 commit 必须能 dry-run 通过；改坏了立即修或回滚。
- 范围限本项目源码；不碰 `node_modules`、锁文件、用户全局配置。

## 已完成（按时间倒序）

- 巡检接入联网需求采集：evolveAudit 在读源码外，用 WebSearch/WebFetch 调研竞品功能/用户痛点/趋势，统一注入 backlog（规则见 `COLLECTOR.md` / 种子见 `REQUIREMENTS.md`；超时提至 240s）
- 持续进化按 severity 优先取条目（high→medium→low，同级 id 升序），让高优先级需求先实现
- dev-watch 启动冒烟检查（按字节偏移扫日志，补 dry-run 抓不到的运行期错误）
- 修复 disposed-frame 刷屏（渲染帧销毁时中止流式查询）— 实跑 app 发现
- listDir 加错误兜底（无权限/已删目录返回空，不抛未捕获异常）
- 流式渲染用 rAF 合并（避免每 token 重解析全文 O(n²)）
- 工具结果摘要行转义（appendToolResult 的 summary，防输出中 `<`/`&` 破坏渲染）
- 文件树文件名转义（防特殊字符破坏渲染/注入）
- 修正渲染进程日志标签（Electron 37+ `console-message` 用 details 对象）
- 建立监控引擎 + dry-run 闸门 + 自动重启

> 经验：纯静态修改要尽早实跑 app（`bash dev-restart.sh` + 看 `/tmp/electron-tools.log`），
> 运行期 bug（disposed frame、未捕获异常）只有跑起来才暴露。冒烟检查已自动化这一步。
