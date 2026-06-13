# cloud/ — 进化大脑云服务（闭源，绝不随开源版/分发包外发）

开源拆分（open-core）的服务端：进化的「决策」留在这里，开源客户端只拿到
单条任务与对应提示词，执行在用户本机完成。

## 文件

| 文件 | 作用 | 是否进 git |
|------|------|-----------|
| `brain.mjs` | API 服务：出题 `/api/evolve/next`、收作业 `/api/evolve/report`、`/api/health` | 是 |
| `prompts.mjs` | 进化提示词单一来源（按客户端形态/版本下发，替代 main.js/server.mjs 里漂移的两份） | 是 |
| `pool.json` | 服务端需求池（种子来自 REQUIREMENTS.md；后续由云端巡检采集自动补充） | 是 |
| `keys.json` | 客户端 API key 与每日配额（首启自动生成 dev key） | **否** |
| `data/` | 运行时：发放台账、回报流水 `reports.jsonl`（数据飞轮）、配额 | **否** |

## 跑起来

```sh
node cloud/brain.mjs          # 默认 :8788，BRAIN_PORT 可改
```

## 协议（客户端视角）

```
POST /api/evolve/prompt        Authorization: Bearer <key>   # 不计配额
  body: { client: "desktop"|"server", version }
  200:  { evolveAppend }                                     # 手动进化用的系统提示词追加段

POST /api/evolve/audit-prompt  Authorization: Bearer <key>   # 不计配额
  body: { client, recent: [近期已做标题], open: [清单已有标题] }
  200:  { prompt, evolveAppend }                             # 巡检提示词（服务端渲染去重约束）

POST /api/evolve/next     Authorization: Bearer <key>
  body: { client: "desktop"|"server", version, recent: [近期已做标题], open: [清单已有标题] }
  200:  { taskId, title, requirement, severity, evolveAppend }   # evolveAppend = 进化系统提示词追加段
  200:  { empty: true }                                          # 池子无可发任务
  401 无效 key / 429 配额用完

POST /api/evolve/report   Authorization: Bearer <key>
  body: { taskId, status: applied|rolledback|nochange|error, summary, changed: [], error, costUsd }
  200:  { ok: true }   / 404 未知 taskId
```

## 后续（按拆分方案）

1. ~~客户端改造~~ 已完成：main.js / server.mjs 的内联提示词已移除，统一经 `brain-client.mjs`
   取用（本地缓存兜底；brainKey 未配置时开发仓自动用本目录 keys.json 的 dev key）。
2. 云端巡检采集：把 evolveAudit 的「渠道二·联网调研」搬到这里统一跑，结果写 `pool.json`
   ——所有用户共享，核心提示词不再下发，用户也不用各自烧 token 调研。
3. 上生产：HTTPS 反代 + 进程守护；key 发放与计费。
