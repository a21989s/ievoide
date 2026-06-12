#!/usr/bin/env node
// 跨平台启动器：清掉 ELECTRON_RUN_AS_NODE 再拉起 Electron。
// 原 start 脚本用的 `env -u` 是 Unix 命令，Windows 下不存在。
import { spawn } from "node:child_process";
import electron from "electron"; // 在纯 node 下 import 得到的是 electron 可执行文件路径

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE; // 否则 electron 会当成纯 node 跑

const child = spawn(electron, ["."], { stdio: "inherit", env });
child.once("exit", (code) => process.exit(code ?? 0));
