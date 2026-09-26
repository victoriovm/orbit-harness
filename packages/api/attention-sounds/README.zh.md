---
description: "注意力音效 Host 服务：从用户 .dsh/sounds 文件夹随机挑选一个音效（或内置兜底音效），交给浏览器在 Harness 窗口不在前台时播放。"
kind: "package-reference"
---

# @deepseek-ai/dsh-api-attention-sounds

[English](README.md) | 中文

## 概述

使用本包向浏览器交付一个注意力音效。`pick` 会列出用户的 `<Harness home>/sounds` 文件夹，均匀随机选择一个符合条件的声音文件并整体返回到 `attentionSounds` Remote 命名空间；当文件夹不存在、没有符合条件的文件、或文件在调用途中消失时，返回内置兜底音效。本服务只负责挑选与字节交付；[`dsh-client-ui-attention-sound`](../../client/ui-attention-sound/README.zh.md) 的浏览器半端决定何时请求、何时播放，因此同一选择同时服务于 Web 与桌面端。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在同样挂载 Typert Gateway 的 bundle 中挂载本包；web 组合将其放在 Session Controller 旁边，并由 `ui-attention-sound` 行消费。客户端调用 `remote.attentionSounds.pick()`，得到 `AttentionSoundPick { name, data }`：所选文件的基名以及完整的 `Uint8Array` 字节。该方法不会因用户内容原因失败：文件夹缺失、路径被文件占用、文件夹为空或全部不符合条件，都返回兜底音效，因此提醒绝不会因为用户缺少自定义音效而响亮失败。

| 方法 | 返回 | 用途 |
|---|---|---|
| `pick()` | `AttentionSoundPick { name, data }` | 一个音效，从用户文件夹随机选择，或内置兜底 |

### sounds 文件夹

文件夹是 `<Harness home>/sounds`，通过 [`dsh-home-paths`](../../util/home-paths/README.zh.md) 解析（除非配置，否则为 `$DSH_HOME` 或 `~/.dsh`）。条件只看文件夹的直接子项——不搜索嵌套文件夹——并保留小写扩展名为 `.aac`、`.flac`、`.m4a`、`.mp3`、`.oga`、`.ogg`、`.opus`、`.wav` 之一、且不超过 `maxSoundBytes` 上限的普通文件。在列出与大小检查之间消失的条目会被跳过；在选择与读取之间消失的文件会回落到内置音效。内置兜底为 `cavalo.mp3`，以 base64 形式硬编码在 `src/fallback-sound.ts` 中，并以 `cavalo.mp3` 这个名字上报，客户端可以依赖这个名字而无需接触文件夹。

### 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `dshHome` | `$DSH_HOME` 或 `~/.dsh` | 存放 `sounds/` 文件夹的 Harness home |
| `maxSoundBytes` | `10485760`（10 MiB） | 单个音效文件的字节上限；超限文件被跳过，绝不截断 |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-api-attention-sounds)是每个字段及其 JSDoc 的详尽来源。

<a id="understand-the-implementation"></a>
## 理解实现

条件筛选与随机选择是导出的纯函数（`eligibleSoundNames`、`pickSound`）；服务只负责解析文件夹、编排列表与交付字节。`pick` 在调用之间不持有状态，因此向文件夹添加音效后，下一次调用即可命中，无需重启。大小检查对每个候选项单独 `stat`，失败只按错误的 `code` 分类：`ENOENT` 与 `ENOTDIR` 表示"本次调用没有文件夹音效"，其余错误码照常上抛。

<a id="model-experience"></a>
## 模型体验

无；本服务向浏览器交付音频字节，不注册任何面向模型的内容。

#### KV Cache 影响

无；挑选不会改变模型请求。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与待办

- **条件筛选基于扩展名，而非内容** —— 改名或损坏但带有音效扩展名的文件会原样交付，播放质量由浏览器负责。每次调用的随机性使用 `Math.random`，对用户自己文件间的非安全选择而言已经足够。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文 —— 点击展开</summary>

无。

</details>
