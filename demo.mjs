import { query } from "@anthropic-ai/claude-agent-sdk";

// 本机已 `claude login`（Pro/Max 订阅）且未设 ANTHROPIC_API_KEY 时，
// 下面的调用会自动复用订阅额度，不走 API Key 计费。

const prompt = process.argv.slice(2).join(" ") || "用一句话介绍你自己";

const response = query({
  prompt,
  options: {
    cwd: process.cwd(),
    // 自动化场景：跳过逐条权限确认。这里只放开只读工具，避免误改文件 / 跑命令。
    permissionMode: "bypassPermissions",
    allowedTools: ["Read", "Grep", "Glob"],
  },
});

for await (const msg of response) {
  if (msg.type === "assistant") {
    for (const block of msg.message.content) {
      if (block.type === "text") process.stdout.write(block.text);
    }
  }
  if (msg.type === "result") {
    console.log("\n\n--- meta ---");
    console.log("session_id:", msg.session_id);
    console.log("duration_ms:", msg.duration_ms);
    console.log("total_cost_usd:", msg.total_cost_usd);
    console.log("usage:", JSON.stringify(msg.usage));
  }
}
