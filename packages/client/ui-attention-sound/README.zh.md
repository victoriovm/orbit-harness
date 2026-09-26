---
description: "注意力音效浏览器插件：当 Session 停止、等待交互或报错，且 Harness 窗口不在前台时，播放一个由 Host 挑选的音效。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-attention-sound

[English](README.md) | 中文

## 概述

注意力音效的浏览器半端。插件把 Session 状态快照与 Host 错误事件折叠成注意力时刻——Session 停止（任务完成）、出现待处理交互（批准、提问、计划评审）、或 Host 上报错误——并在浏览器窗口失焦且用户偏好允许时，播放一个从 [`dsh-api-attention-sounds`](../../api/attention-sounds/README.zh.md) 取回的音效。一次注意力突发最多播放一个音效，启动时便处于空闲或已有待处理 Session 的客户端保持静默，因为第一个观察到的状态是基线。通用设置页的开关行负责启用选择。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在 web 组合中挂载本包；其 bundle 行是 `ui-attention-sound`（本包）与 `attention-sounds`（Host 服务）并列。所需客户端服务：`remote`、`uiSession`、`configForms`、`slots`、`locale`。本包的 Host 半端声明 `ui-attention-sound` 设置命名空间的 live 字段 `enabled`，可从 `cordis.yml` 和本插件注册的通用设置行编辑；新安装默认启用。

当注意力时刻被观察到时 `document.hasFocus()` 为 true 即视为窗口持有焦点，因此切到其他窗口、其他标签页或最小化都会抑制播放，恢复焦点后重新生效。声音字节整体经 Remote 到达，通过临时 object URL 播放一次，播放结束、失败或被拒绝（自动播放策略的拒绝会静默结束本次尝试）时释放，MIME 类型由文件扩展名推导。

### enabled 偏好

偏好通过 `ctx.configForms` 读取共享设置文档：Host 提供 `ui-attention-sound` 命名空间时跟随已接受的值，在值到达前默认启用；在偏好保持进程本地的连接（memory 模式）上则保存浏览器本地选择。设置行的写入路径走同一命名空间持久化，被拒绝的写入会显示该行的错误文案。

<a id="understand-the-implementation"></a>
## 理解实现

`wiring.ts` 注册字典、注意力时刻订阅与通用设置行；`alerter.ts` 负责门控（播放互斥、偏好、焦点，以及让一次突发只响一声的合并窗口）；`player.ts` 负责播放。启用选择走 `ctx.configForms` 上共享的布尔偏好助手（`hostFallback` 与 `memoryStart` 均为开），在 Host 文档提供时跟随文档，在 memory 模式连接上保持浏览器本地。本插件绝不导入其他特性插件的值——协作经由 `configForms`、`uiSession`、`remote` 服务，设置行通过 `settings.general.item` 槽位渲染。

<a id="model-experience"></a>
## 模型体验

无；本包在浏览器中呈现音频，不注册任何面向模型的内容。

#### KV Cache 影响

无；播放不会改变模型请求。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与待办

- **焦点是整个窗口级的事实** —— 音效不区分用户正在阅读哪个 Session 或面板，窗口有焦点时后台 Session 同样静默。窗口失焦时，子代理 Session 的停止与顶层一样会提醒。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文 —— 点击展开</summary>

无。

</details>
