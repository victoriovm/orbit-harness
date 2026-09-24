/**
 * `model` namespace dictionaries.
 *
 * `trigger.selectAria` intentionally matches `trigger.fallback` but remains a
 * separate key: the visible fallback label and the accessible name of
 * an unset trigger are free to diverge per locale, and folding it into
 * `trigger.aria` would announce the degenerate "Select model, current Select
 * model".
 */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'command.label': '模型',
  'command.description': '选择本会话使用的模型',
  'option.loadError': '目录加载失败：{message}',
  'option.deepseekV4Flash.description': '快速、高效且经济；适合目标明确、常规或并行任务。',
  'option.deepseekV4Pro.description': '更强的自主编码、知识与复杂推理能力；适合复杂或质量优先的任务，但成本更高。',
  'trigger.fallback': '选择模型',
  'trigger.loading': '正在加载模型…',
  'trigger.selectAria': '选择模型',
  'trigger.aria': '选择模型，当前 {model}',
  'trigger.ariaEffort': '选择模型，当前 {model}，推理等级 {effort}',
  'dialog.title': '选择模型',
  'search.placeholder': '搜索模型…',
  'search.aria': '搜索模型',
  'list.aria': '可用模型',
  'manage.aria': '管理模型提供方',
  'auto.aria': '自动配置模型提供方',
  'auto.title': '自动配置模型',
  'auto.description': '读取所选提供方自己的模型列表，补齐名称、上下文窗口、输出上限与推理等级。',
  'auto.provider': '模型提供方',
  'auto.loading': '正在读取模型提供方…',
  'auto.empty': '此主机上没有可自动配置的模型提供方。',
  'auto.none': '无可用提供方',
  'auto.pickerAria': '模型提供方，当前 {provider}',
  'auto.confirm': '开始配置',
  'auto.running': '正在读取该提供方的模型…',
  'auto.doneTitle': '模型已配置',
  'auto.done': '已配置 {count} 个模型。',
  'auto.doneAll': '它们的名称、上下文容量与推理等级全部来自 models.dev 目录。',
  'auto.doneNone': 'models.dev 目录未描述其中任何一个，因此这 {count} 个模型全部依据提供方自身的列表配置，可能需要手动补充。',
  'auto.doneSplit': '其中 {enriched} 个的名称、上下文容量与推理等级来自 models.dev 目录；另外 {generic} 个仅来自提供方自身的列表，可能需要手动补充。',
  'effort.aria': '推理等级',
  'effort.providerDefault': 'Default',
  'status.loading': '正在刷新模型列表…',
  'error.action': '模型操作失败：{message}',
  'error.sessionInUse': '当前会话已被占用，可能是其他正在运行的 DSH 导致的（如其他 dsh web、桌面端），请退出其他正在运行的 DSH 后重试。',
  'warning.groupLoad': '{name} 加载失败：{message}',
  'empty.models': '没有可用的模型。',
  'empty.search': '没有匹配的模型。',
  'blocked.composer': '当前模型不可用，请先选择模型',
  'empty.efforts': '此模型不支持推理等级。',
} satisfies Record<string, string>

/** The model namespace key union. */
export type ModelKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'command.label': 'Model',
  'command.description': 'Select the model for this conversation',
  'option.loadError': 'Catalog failed to load: {message}',
  'option.deepseekV4Flash.description': 'Fast, efficient, and economical; suited to focused, routine, or parallel tasks.',
  'option.deepseekV4Pro.description': 'Stronger agentic coding, knowledge, and difficult reasoning; suited to complex or quality-critical tasks at higher cost.',
  'trigger.fallback': 'Select model',
  'trigger.loading': 'Loading models…',
  'trigger.selectAria': 'Select model',
  'trigger.aria': 'Select model, current {model}',
  'trigger.ariaEffort': 'Select model, current {model}, reasoning effort {effort}',
  'dialog.title': 'Select model',
  'search.placeholder': 'Search models…',
  'search.aria': 'Search models',
  'list.aria': 'Available models',
  'manage.aria': 'Manage model providers',
  'auto.aria': 'Auto-configure model providers',
  'auto.title': 'Auto-configure models',
  'auto.description': 'Reads the selected provider\'s own model list and fills in names, context windows, output caps, and reasoning levels.',
  'auto.provider': 'Provider',
  'auto.loading': 'Reading providers…',
  'auto.empty': 'No provider on this Host can be configured automatically.',
  'auto.none': 'No provider available',
  'auto.pickerAria': 'Provider, current {provider}',
  'auto.confirm': 'Auto-configure',
  'auto.running': 'Reading this provider\'s models…',
  'auto.doneTitle': 'Models configured',
  'auto.done': 'Configured {count} models.',
  'auto.doneAll': 'Every one of them was named, sized, and given reasoning levels by the models.dev catalog.',
  'auto.doneNone': 'The models.dev catalog describes none of them, so all {count} were configured from the provider\'s own listing and may need a manual pass.',
  'auto.doneSplit': '{enriched} of them were named, sized, and given reasoning levels by the models.dev catalog. The other {generic} came from the provider\'s own listing and may need a manual pass.',
  'effort.aria': 'Reasoning effort',
  'effort.providerDefault': 'Default',
  'status.loading': 'Refreshing model list…',
  'error.action': 'Model operation failed: {message}',
  'error.sessionInUse': 'This session is already in use, possibly by another running DSH instance (such as dsh web or the desktop app). Quit other running DSH instances and try again.',
  'warning.groupLoad': '{name} failed to load: {message}',
  'empty.models': 'No models available.',
  'empty.search': 'No matching models.',
  'blocked.composer': 'This model is unavailable — select one to continue',
  'empty.efforts': 'This model does not support reasoning effort.',
} satisfies Record<ModelKey, string>
