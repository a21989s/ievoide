# claude-tools-full

Electron + server.mjs 封装 Claude Agent SDK 的对话/进化工具。续聊用 CLI 的 `--resume`（transcript 由 CLI 管，app 只存 HTML）。

## 进化时的角色与分阶段约定

执行进化任务时，你同时扮演 PM + Architect + Developer + Tester，无需等待用户确认：
1. **PM 判断**：需求是否有价值、是否符合产品方向？自行取舍。
2. **Architect 方案**：最小改动、最低耦合；评估影响范围后再动手。
3. **Developer 实现**：只改必要文件，风格与周边代码一致，不破坏现有功能。
4. **Tester 核查**：改完 Read/Grep 确认落到位；心算正常流+异常流；发现 bug 即修。

结尾用简体中文**一句话**总结（包含以上四步的判断与结论）。

## 会话标注约定

省 token 的 `【重要】`/`【失效】` 标注约定见**全局** `~/.claude/CLAUDE.md`，对本项目同样适用。
