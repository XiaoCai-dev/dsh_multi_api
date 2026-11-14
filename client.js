/**
 * dsh_multi_api — Client half.
 *
 * A left-sidebar page that manages relay channels and their model bindings.
 * Everything it shows comes from the Host half over the shared `/api` channel:
 * `state` for the snapshot, one POST route per mutation.
 */

window.__ModuleLoader__.load({
  id: 'dsh_multi_api',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const NS = 'channel-relay'
    const PANEL_ID = 'channel-relay'
    const API = 'api/dsh_multi_api/'

    // Flat keys: the locale service looks every key up verbatim, without walking dots.
    const zh = {
      'meta.title': '多渠道模型中继',
      'meta.description': '配置多个 OpenAI 兼容渠道与模型映射，额度耗尽或上游故障时自动切换备用渠道。',
      'sidebar.label': '多渠道模型中继',
      'panel.title': '多渠道模型中继',
      'panel.subtitle': '同一模型可绑定多个渠道；额度耗尽、限流或上游故障时自动切换到备用渠道，会话无感。',
      'panel.providerBadge': '提供商路由',
      'panel.providerHint': '在会话模型选择器的该分组下即可直接选用已配置的模型。',
      'panel.refresh': '刷新',
      'panel.refreshing': '刷新中…',
      'panel.loading': '正在加载渠道配置…',
      'panel.error': '无法加载渠道配置',
      'panel.retry': '重试',
      'panel.updated': '更新于 {time}',
      'panel.tabs.channels': '渠道管理',
      'panel.tabs.models': '模型路由表',
      'panel.tabs.logs': '调用与切换日志',
      'panel.stats.channels': '已启用渠道',
      'panel.stats.models': '已接入模型',
      'panel.stats.cooldown': '冷却/异常渠道',
      'panel.stats.failovers': '近期自动切换',
      'panel.stats.channelsHint': '共 {total} 个渠道',
      'panel.stats.modelsHint': '{count} 条渠道绑定',
      'panel.stats.cooldownHint': '健康优先，冷却后仍会兜底尝试',
      'panel.stats.failoversHint': '最近 {count} 条调用记录',
      'panel.banner.memory': '持久化存储不可用，本次运行的渠道配置只保存在内存中，重启即丢失。',
      'panel.banner.memoryReason': '（原因：{reason}）',
      'panel.channels.add': '新增渠道',
      'panel.channels.edit': '编辑',
      'panel.channels.newTitle': '新增渠道',
      'panel.channels.editTitle': '编辑渠道',
      'panel.channels.empty': '暂未配置任何渠道',
      'panel.channels.emptyHint': '填入 OpenAI 兼容的 Base URL 与密钥，并在「模型」一栏列出该渠道支持的模型。',
      'panel.channels.name': '渠道名称',
      'panel.channels.namePlaceholder': '例如：硅基流动 / OpenRouter / DeepSeek 官方',
      'panel.channels.baseUrl': '接口地址 Base URL（OpenAI 兼容）',
      'panel.channels.baseUrlPlaceholder': 'https://api.deepseek.com/v1',
      'panel.channels.apiKey': 'API Key 密钥',
      'panel.channels.apiKeyPlaceholder': 'sk-...',
      'panel.channels.apiKeyKeepPlaceholder': '留空则保留已保存的密钥',
      'panel.channels.priority': '优先级（数字越小越优先）',
      'panel.channels.weight': '同优先级权重',
      'panel.channels.timeoutMs': '超时时间 (ms)',
      'panel.channels.quickModels': '该渠道支持的模型（逗号或换行分隔，支持 逻辑模型名=上游模型名）',
      'panel.channels.quickModelsPlaceholder': 'deepseek-chat, deepseek-reasoner, gpt-4o=openai/gpt-4o',
      'panel.channels.quickModelsHint': '逻辑模型名会出现在 DSH 模型选择器里；保存后本渠道的模型绑定以此为准。',
      'panel.channels.reasoningEfforts': '上游支持的思考档位',
      'panel.channels.reasoningEffortsHint': '留空则按 low, high 发送（各家词表不同，DSH 的档位会自动映射进去）；填了就以这里为准，例如 low, high, max。',
      'panel.channels.enabled': '启用该渠道',
      'panel.channels.save': '保存渠道',
      'panel.channels.saving': '保存中…',
      'panel.channels.cancel': '取消',
      'panel.channels.delete': '删除',
      'panel.channels.deleteConfirm': '确认删除？',
      'panel.channels.test': '测试连通性',
      'panel.channels.testing': '测试中…',
      'panel.channels.testOk': '连通正常，上游返回 {count} 个模型（{ms} ms）',
      'panel.channels.testOkNoCount': '连通正常（{ms} ms）',
      'panel.channels.testFail': '连通失败：{detail}',
      'panel.channels.fetchModels': '拉取上游模型',
      'panel.channels.fetchingModels': '拉取中…',
      'panel.channels.fetchedModels': '上游模型（点击填入模型列表）',
      'panel.channels.resetHealth': '解除冷却',
      'panel.channels.keyConfigured': '密钥已配置',
      'panel.channels.keyMissing': '未配置密钥',
      'panel.channels.modelsBound': '已绑定 {count} 个模型',
      'panel.channels.models': '模型列表',
      'panel.channels.priorityShort': '优先级 {value}',
      'panel.channels.weightShort': '权重 {value}',
      'panel.models.add': '新增模型绑定',
      'panel.models.newTitle': '新增模型绑定',
      'panel.models.empty': '暂未绑定任何模型',
      'panel.models.emptyHint': '绑定后，该逻辑模型会出现在 DSH 模型选择器里；多个渠道绑定同一逻辑模型即构成故障切换池。',
      'panel.models.logicalModel': 'DSH 模型 ID（逻辑名）',
      'panel.models.logicalModelPlaceholder': '例如：deepseek-chat',
      'panel.models.displayName': '显示名称（选填）',
      'panel.models.displayNamePlaceholder': '例如：DeepSeek V3（多渠道中继）',
      'panel.models.channel': '所属渠道',
      'panel.models.upstreamModel': '上游真实模型 ID',
      'panel.models.upstreamModelPlaceholder': '留空则与 DSH 模型 ID 一致',
      'panel.models.contextWindow': '上下文窗口',
      'panel.models.maxTokens': '最大输出 Token',
      'panel.models.reasoning': '支持深度思考',
      'panel.models.vision': '支持图片输入',
      'panel.models.save': '保存绑定',
      'panel.models.delete': '移除',
      'panel.models.routeOrder': '故障切换链路',
      'panel.models.useInDsh': '可直接作为 DSH 模型调用',
      'panel.models.upstream': '上游模型',
      'panel.models.health': '状态',
      'panel.logs.clear': '清空日志',
      'panel.logs.cleared': '日志已清空',
      'panel.logs.empty': '暂无模型调用或故障切换记录',
      'panel.logs.emptyHint': '在会话里选用该提供商的模型后，这里会出现每次调用的渠道与耗时。',
      'panel.logs.outcomeSuccess': '调用成功',
      'panel.logs.outcomeFailover': '触发自动切换',
      'panel.logs.outcomeFailed': '全部失败',
      'panel.logs.attempts': '尝试明细',
      'panel.logs.duration': '总耗时 {ms} ms',
      'panel.logs.attempt': '第 {index} 次',
      'panel.logs.ms': '{ms} ms',
      'panel.health.healthy': '健康',
      'panel.health.cooldown': '冷却中',
      'panel.health.invalid': '密钥失效',
      'panel.health.disabled': '已停用',
      'panel.health.model': '模型不可用',
      'panel.health.unknown': '未调用',
      'panel.health.until': '{time} 后恢复',
      'panel.health.coolingUntil': '冷却至 {time}',
      'panel.notice.saved': '已保存',
      'panel.notice.deleted': '已删除',
      'panel.notice.reset': '已解除冷却',
      'panel.notice.bound': '已添加模型绑定',
      'panel.notice.enabled': '已启用',
      'panel.notice.disabled': '已停用',
      'panel.field.optional': '选填',
      'panel.common.on': '开',
      'panel.common.off': '关',
      'panel.common.confirm': '确认',
      'panel.common.cancel': '取消',
      'panel.crash': '面板渲染失败：{message}',
    }

    const en = {
      'meta.title': 'Channel relay',
      'meta.description': 'Route one logical model across several OpenAI-compatible channels with automatic failover.',
      'sidebar.label': 'Channel relay',
      'panel.title': 'Channel relay',
      'panel.subtitle': 'One model, several channels. Quota exhaustion, rate limits, or upstream failures switch to a backup channel without the conversation noticing.',
      'panel.providerBadge': 'Provider route',
      'panel.providerHint': 'Configured models appear under this group in the model picker.',
      'panel.refresh': 'Refresh',
      'panel.refreshing': 'Refreshing…',
      'panel.loading': 'Loading channel configuration…',
      'panel.error': 'Unable to load channel configuration',
      'panel.retry': 'Retry',
      'panel.updated': 'Updated {time}',
      'panel.tabs.channels': 'Channels',
      'panel.tabs.models': 'Model routes',
      'panel.tabs.logs': 'Calls & failover',
      'panel.stats.channels': 'Enabled channels',
      'panel.stats.models': 'Routed models',
      'panel.stats.cooldown': 'Cooling / broken',
      'panel.stats.failovers': 'Recent failovers',
      'panel.stats.channelsHint': '{total} channel(s) total',
      'panel.stats.modelsHint': '{count} channel binding(s)',
      'panel.stats.cooldownHint': 'Healthy first; cooling channels stay as a last resort',
      'panel.stats.failoversHint': '{count} recorded call(s)',
      'panel.banner.memory': 'Persistent storage is unavailable; this run keeps channels in memory and loses them on restart.',
      'panel.banner.memoryReason': '(reason: {reason})',
      'panel.channels.add': 'Add channel',
      'panel.channels.edit': 'Edit',
      'panel.channels.newTitle': 'Add channel',
      'panel.channels.editTitle': 'Edit channel',
      'panel.channels.empty': 'No channels configured',
      'panel.channels.emptyHint': 'Enter an OpenAI-compatible base URL and key, then list the models it serves.',
      'panel.channels.name': 'Channel name',
      'panel.channels.namePlaceholder': 'e.g. OpenRouter / DeepSeek official',
      'panel.channels.baseUrl': 'Base URL (OpenAI compatible)',
      'panel.channels.baseUrlPlaceholder': 'https://api.deepseek.com/v1',
      'panel.channels.apiKey': 'API key',
      'panel.channels.apiKeyPlaceholder': 'sk-...',
      'panel.channels.apiKeyKeepPlaceholder': 'Leave empty to keep the stored key',
      'panel.channels.priority': 'Priority (lower wins)',
      'panel.channels.weight': 'Weight within a priority',
      'panel.channels.timeoutMs': 'Timeout (ms)',
      'panel.channels.quickModels': 'Models this channel serves (comma or newline separated, `logical=upstream` supported)',
      'panel.channels.quickModelsPlaceholder': 'deepseek-chat, deepseek-reasoner, gpt-4o=openai/gpt-4o',
      'panel.channels.quickModelsHint': 'Logical names are what the model picker shows. Saving replaces this channel’s bindings.',
      'panel.channels.reasoningEfforts': 'Effort levels the endpoint accepts',
      'panel.channels.reasoningEffortsHint': 'Empty sends low or high (vocabularies differ; DSH levels are mapped in). Fill this to pin the list, e.g. low, high, max.',
      'panel.channels.enabled': 'Channel enabled',
      'panel.channels.save': 'Save channel',
      'panel.channels.saving': 'Saving…',
      'panel.channels.cancel': 'Cancel',
      'panel.channels.delete': 'Delete',
      'panel.channels.deleteConfirm': 'Confirm delete?',
      'panel.channels.test': 'Test connection',
      'panel.channels.testing': 'Testing…',
      'panel.channels.testOk': 'Reachable, {count} models advertised ({ms} ms)',
      'panel.channels.testOkNoCount': 'Reachable ({ms} ms)',
      'panel.channels.testFail': 'Unreachable: {detail}',
      'panel.channels.fetchModels': 'Fetch upstream models',
      'panel.channels.fetchingModels': 'Fetching…',
      'panel.channels.fetchedModels': 'Upstream models (click to fill the model list)',
      'panel.channels.resetHealth': 'Clear cooldown',
      'panel.channels.keyConfigured': 'Key stored',
      'panel.channels.keyMissing': 'No key',
      'panel.channels.modelsBound': '{count} model(s) bound',
      'panel.channels.models': 'Models',
      'panel.channels.priorityShort': 'priority {value}',
      'panel.channels.weightShort': 'weight {value}',
      'panel.models.add': 'Add model binding',
      'panel.models.newTitle': 'Add model binding',
      'panel.models.empty': 'No model bindings yet',
      'panel.models.emptyHint': 'A binding makes the logical model appear in the picker; binding one model to several channels builds the failover pool.',
      'panel.models.logicalModel': 'DSH model id (logical)',
      'panel.models.logicalModelPlaceholder': 'e.g. deepseek-chat',
      'panel.models.displayName': 'Display name (optional)',
      'panel.models.displayNamePlaceholder': 'e.g. DeepSeek V3 (relay)',
      'panel.models.channel': 'Channel',
      'panel.models.upstreamModel': 'Upstream model id',
      'panel.models.upstreamModelPlaceholder': 'Empty keeps the DSH model id',
      'panel.models.contextWindow': 'Context window',
      'panel.models.maxTokens': 'Max output tokens',
      'panel.models.reasoning': 'Reasoning',
      'panel.models.vision': 'Vision',
      'panel.models.save': 'Save binding',
      'panel.models.delete': 'Remove',
      'panel.models.routeOrder': 'Failover chain',
      'panel.models.useInDsh': 'Callable from DSH as a model',
      'panel.models.upstream': 'Upstream model',
      'panel.models.health': 'State',
      'panel.logs.clear': 'Clear log',
      'panel.logs.cleared': 'Log cleared',
      'panel.logs.empty': 'No calls recorded yet',
      'panel.logs.emptyHint': 'Pick this provider’s model in a conversation and each call shows up here with its channel and timing.',
      'panel.logs.outcomeSuccess': 'Success',
      'panel.logs.outcomeFailover': 'Failed over',
      'panel.logs.outcomeFailed': 'All channels failed',
      'panel.logs.attempts': 'Attempts',
      'panel.logs.duration': '{ms} ms total',
      'panel.logs.attempt': 'Attempt {index}',
      'panel.logs.ms': '{ms} ms',
      'panel.health.healthy': 'Healthy',
      'panel.health.cooldown': 'Cooling',
      'panel.health.invalid': 'Invalid key',
      'panel.health.disabled': 'Disabled',
      'panel.health.model': 'Model unavailable',
      'panel.health.unknown': 'Unused',
      'panel.health.until': 'recovers in {time}',
      'panel.health.coolingUntil': 'cooling until {time}',
      'panel.notice.saved': 'Saved',
      'panel.notice.deleted': 'Deleted',
      'panel.notice.reset': 'Cooldown cleared',
      'panel.notice.bound': 'Binding added',
      'panel.notice.enabled': 'Enabled',
      'panel.notice.disabled': 'Disabled',
      'panel.field.optional': 'Optional',
      'panel.common.on': 'On',
      'panel.common.off': 'Off',
      'panel.common.confirm': 'Confirm',
      'panel.common.cancel': 'Cancel',
      'panel.crash': 'The panel failed to render: {message}',
    }

    const css = `
.dcr-root{box-sizing:border-box;display:flex;flex-direction:column;width:100%;height:100%;min-height:0;overflow:hidden;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);font-family:inherit;font-size:14px;line-height:1.5}
.dcr-root *{box-sizing:border-box}
/* The head row is this page's window-drag geometry: its box reaches the window
   top (clearance included) and stays put while the body scrolls, so the strip
   above the content always drags the window. Controls opt out with no-drag. */
.dcr-head{flex:none;padding:calc(28px + var(--dsh-frame-top-clearance,0px)) clamp(24px,4vw,48px) 0;-webkit-app-region:drag}
.dcr-head button,.dcr-head a,.dcr-head input,.dcr-head select{-webkit-app-region:no-drag}
.dcr-headInner{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;width:100%;max-width:960px;margin:0 auto}
.dcr-scroll{flex:1;min-height:0;overflow:auto;padding:20px clamp(24px,4vw,48px) 48px}
.dcr-inner{display:flex;flex-direction:column;gap:20px;width:100%;max-width:960px;margin:0 auto}
.dcr-head h1{margin:0;font-size:22px;line-height:1.3;font-weight:650;letter-spacing:-.3px}
.dcr-sub{margin-top:4px;color:var(--dsw-alias-label-secondary);font-size:13px;max-width:62ch}
.dcr-headActions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dcr-provider{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 10px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-size:12px}
.dcr-provider code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--dsw-alias-label-primary);font-size:12px}
.dcr-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:32px;padding:0 12px;font:inherit;font-size:13px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;cursor:pointer;white-space:nowrap}
.dcr-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}
.dcr-btn:disabled{opacity:.5;cursor:default}
.dcr-btn.dcr-primary{background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary));border-color:transparent;color:var(--dsw-alias-label-primary-inverted,#fff)}
.dcr-btn.dcr-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,var(--dsw-alias-brand-primary))}
.dcr-btn.dcr-danger{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-border-l2)}
.dcr-btn.dcr-danger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger,var(--dsw-alias-bg-layer-2))}
.dcr-btn.dcr-ghost{background:transparent;border-color:transparent;color:var(--dsw-alias-label-secondary)}
.dcr-btn.dcr-ghost:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.dcr-btn.dcr-sm{min-height:28px;padding:0 10px;font-size:12px}
.dcr-root :focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.dcr-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
@media (max-width:760px){.dcr-stats{grid-template-columns:repeat(2,minmax(0,1fr))}}
.dcr-stat{padding:14px 16px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);min-width:0}
.dcr-statLabel{color:var(--dsw-alias-label-secondary);font-size:12px}
.dcr-statValue{margin-top:2px;font-size:24px;font-weight:650;letter-spacing:-.4px;font-variant-numeric:tabular-nums}
.dcr-statHint{margin-top:2px;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dcr-tabs{display:flex;gap:4px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.dcr-tab{position:relative;min-height:36px;padding:0 12px;font:inherit;font-size:13px;color:var(--dsw-alias-label-secondary);background:transparent;border:0;border-radius:8px 8px 0 0;cursor:pointer}
.dcr-tab:hover{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}
.dcr-tab[aria-selected="true"]{color:var(--dsw-alias-label-primary);font-weight:600}
.dcr-tab[aria-selected="true"]::after{content:"";position:absolute;left:8px;right:8px;bottom:-1px;height:2px;border-radius:2px;background:var(--dsw-alias-brand-primary)}
.dcr-section{display:flex;flex-direction:column;gap:12px}
.dcr-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.dcr-muted{color:var(--dsw-alias-label-secondary);font-size:12px}
.dcr-banner{padding:10px 12px;border-radius:10px;font-size:12.5px;border:1px solid var(--dsw-alias-state-warn-secondary,var(--dsw-alias-border-l1));color:var(--dsw-alias-state-warn-label,var(--dsw-alias-label-primary));background:var(--dsw-alias-state-warn-tertiary,var(--dsw-alias-bg-layer-1))}
.dcr-empty{padding:28px;border:1px dashed var(--dsw-alias-border-l2);border-radius:12px;text-align:center}
.dcr-empty strong{display:block;font-size:14px;margin-bottom:4px}
.dcr-empty span{color:var(--dsw-alias-label-secondary);font-size:12.5px}
.dcr-card{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);padding:14px 16px}
.dcr-cardHead{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap}
.dcr-cardTitle{display:flex;align-items:center;gap:8px;min-width:0;flex-wrap:wrap}
.dcr-cardTitle b{font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:34ch}
.dcr-url{color:var(--dsw-alias-label-secondary);font-size:12px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
.dcr-cardMeta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:8px}
.dcr-cardActions{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:12px}
.dcr-chip{display:inline-flex;align-items:center;gap:4px;height:22px;padding:0 8px;border-radius:999px;font-size:11.5px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary);white-space:nowrap}
.dcr-dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-idle-primary);flex:none}
.dcr-h-healthy .dcr-dot{background:var(--dsw-alias-state-success-primary)}
.dcr-h-healthy{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-secondary,var(--dsw-alias-border-l1))}
.dcr-h-cooldown .dcr-dot,.dcr-h-model .dcr-dot{background:var(--dsw-alias-state-warn-primary)}
.dcr-h-cooldown,.dcr-h-model{color:var(--dsw-alias-state-warn-label,var(--dsw-alias-label-primary));border-color:var(--dsw-alias-state-warn-secondary,var(--dsw-alias-border-l1))}
.dcr-h-invalid .dcr-dot{background:var(--dsw-alias-state-error-primary)}
.dcr-h-invalid{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-secondary,var(--dsw-alias-border-l1))}
.dcr-switch{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--dsw-alias-label-secondary);background:transparent;border:0;padding:0;cursor:pointer;font-family:inherit}
.dcr-switch i{position:relative;display:inline-block;width:28px;height:16px;border-radius:999px;background:var(--dsw-alias-border-l3,var(--dsw-alias-border-l2));transition:background .15s}
.dcr-switch i::after{content:"";position:absolute;top:2px;left:2px;width:12px;height:12px;border-radius:50%;background:var(--dsw-alias-switch-thumb,#fff);transition:transform .15s}
.dcr-switch[aria-checked="true"] i{background:var(--dsw-alias-brand-primary)}
.dcr-switch[aria-checked="true"] i::after{transform:translateX(12px)}
.dcr-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);padding:16px}
@media (max-width:720px){.dcr-form{grid-template-columns:minmax(0,1fr)}}
.dcr-formHead{grid-column:1/-1;display:flex;align-items:center;justify-content:space-between;gap:12px}
.dcr-formHead h2{margin:0;font-size:14px;font-weight:600}
.dcr-wide{grid-column:1/-1}
.dcr-field{display:flex;flex-direction:column;gap:5px;min-width:0}
.dcr-field > label,.dcr-field > span{font-size:12px;color:var(--dsw-alias-label-secondary)}
.dcr-field input[type="text"],.dcr-field input[type="password"],.dcr-field input[type="number"],.dcr-field select,.dcr-field textarea{width:100%;font:inherit;font-size:13px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:7px 10px;min-height:34px}
.dcr-field textarea{min-height:72px;resize:vertical;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;line-height:1.6}
.dcr-fieldHint{font-size:11.5px;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary))}
.dcr-formActions{grid-column:1/-1;display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end}
.dcr-inline{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dcr-notice{padding:8px 12px;border-radius:9px;font-size:12.5px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary)}
.dcr-notice.dcr-good{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-secondary,var(--dsw-alias-border-l1))}
.dcr-notice.dcr-bad{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-secondary,var(--dsw-alias-border-l1))}
.dcr-group{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);overflow:hidden}
.dcr-groupHead{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;border-bottom:1px solid var(--dsw-alias-border-l1);flex-wrap:wrap}
.dcr-groupHead b{font-size:13.5px;font-weight:600;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.dcr-chain{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:12px;color:var(--dsw-alias-label-secondary)}
.dcr-chain i{color:var(--dsw-alias-label-tertiary,var(--dsw-alias-border-l3));font-style:normal}
.dcr-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 16px;border-top:1px solid var(--dsw-alias-border-l1);flex-wrap:wrap}
.dcr-row:first-child{border-top:0}
.dcr-rowMain{display:flex;align-items:center;gap:8px;min-width:0;flex-wrap:wrap}
.dcr-rowMain b{font-size:13px;font-weight:600}
.dcr-rowActions{display:flex;align-items:center;gap:6px}
.dcr-mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
.dcr-log{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);padding:0}
.dcr-log > summary{display:flex;align-items:center;gap:10px;padding:11px 16px;cursor:pointer;list-style:none;flex-wrap:wrap}
.dcr-log > summary::-webkit-details-marker{display:none}
.dcr-log > summary:hover{background:var(--dsw-alias-bg-layer-2);border-radius:12px}
.dcr-caret{color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));font-size:11px;transition:transform .15s}
.dcr-log[open] .dcr-caret{transform:rotate(180deg)}
.dcr-logBody{border-top:1px solid var(--dsw-alias-border-l1);padding:10px 16px;display:flex;flex-direction:column;gap:8px}
.dcr-attempt{display:flex;align-items:center;gap:8px;font-size:12px;flex-wrap:wrap}
.dcr-tag{display:inline-flex;align-items:center;height:20px;padding:0 8px;border-radius:999px;font-size:11px;font-weight:600;white-space:nowrap}
.dcr-tag.dcr-ok{color:var(--dsw-alias-state-success-primary);background:var(--dsw-alias-state-success-tertiary,transparent);border:1px solid var(--dsw-alias-state-success-secondary,var(--dsw-alias-border-l1))}
.dcr-tag.dcr-warn{color:var(--dsw-alias-state-warn-label,var(--dsw-alias-label-primary));background:var(--dsw-alias-state-warn-tertiary,transparent);border:1px solid var(--dsw-alias-state-warn-secondary,var(--dsw-alias-border-l1))}
.dcr-tag.dcr-bad{color:var(--dsw-alias-state-error-primary);background:transparent;border:1px solid var(--dsw-alias-state-error-secondary,var(--dsw-alias-border-l1))}
.dcr-tag.dcr-idle{color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-border-l1)}
.dcr-crash{margin:calc(28px + var(--dsh-frame-top-clearance,0px)) clamp(24px,4vw,48px) 0;padding:24px;border:1px solid var(--dsw-alias-state-error-secondary,var(--dsw-alias-border-l1));border-radius:12px;color:var(--dsw-alias-state-error-primary);font-size:13px;background:var(--dsw-alias-bg-layer-1)}
`

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'channel-relay: dictionaries')
        const t = ctx.locale.bind(NS)

        const useLocale = () =>
          React.useSyncExternalStore(
            (listener) => ctx.locale.subscribe(listener),
            () => ctx.locale.getSnapshot(),
          )

        // --- transport -------------------------------------------------------

        const request = (route, body) =>
          (globalThis.__DSH_TRANSPORT__?.fetch ?? globalThis.fetch)(`${API}${route}`, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body ?? {}),
          }).then(async (response) => {
            let payload
            try {
              payload = await response.json()
            } catch {
              throw new Error(`HTTP ${response.status}`)
            }
            if (payload?.ok !== true) throw new Error(payload?.error?.message ?? `HTTP ${response.status}`)
            return payload.value
          })

        // --- helpers ---------------------------------------------------------

        const int = (value, fallback) => {
          const parsed = Number.parseInt(String(value ?? '').trim(), 10)
          return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback
        }

        const clock = (time) => {
          if (typeof time !== 'number' || time <= 0) return '—'
          return new Date(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }

        const relative = (until) => {
          const ms = until - Date.now()
          if (ms <= 0) return '—'
          const minutes = Math.ceil(ms / 60_000)
          if (minutes < 60) return `${minutes} min`
          const hours = Math.floor(minutes / 60)
          return `${hours} h ${minutes % 60} min`
        }

        const stateOf = (snapshot, channelId) =>
          (snapshot?.states ?? []).find((entry) => entry.channelId === channelId)

        const healthOf = (channel, snapshot) => {
          if (channel.enabled === false) return { key: 'disabled', until: 0 }
          const state = stateOf(snapshot, channel.id)
          if (state === undefined) return { key: 'unknown', until: 0 }
          if (state.status === 'ok') return { key: 'healthy', until: 0 }
          if (typeof state.until === 'number' && state.until > Date.now()) {
            return { key: state.status === 'invalid' ? 'invalid' : state.status === 'model' ? 'model' : 'cooldown', until: state.until }
          }
          return { key: 'unknown', until: 0 }
        }

        const healthChip = (channel, snapshot) => {
          const health = healthOf(channel, snapshot)
          const label = t(`panel.health.${health.key}`)
          const detail = health.until > 0 ? ` · ${t('panel.health.until', { time: relative(health.until) })}` : ''
          return h('span', { className: `dcr-chip dcr-h-${health.key}`, title: `${label}${detail}` }, h('i', { className: 'dcr-dot' }), label + detail)
        }

        const bindingsOf = (snapshot, channelId) =>
          (snapshot?.bindings ?? []).filter((binding) => binding.channelId === channelId)

        const quickModelsOf = (snapshot, channelId) =>
          bindingsOf(snapshot, channelId)
            .map((binding) => (binding.upstreamModel === binding.model ? binding.model : `${binding.model}=${binding.upstreamModel}`))
            .join('\n')

        const emptyChannel = (snapshot) => ({
          id: '',
          name: '',
          baseUrl: '',
          apiKey: '',
          priority: '100',
          weight: '0',
          timeoutMs: '120000',
          enabled: true,
          reasoningEfforts: '',
          quickModels: '',
          bindings: snapshot,
        })

        const emptyBinding = (channelId) => ({
          id: '',
          model: '',
          channelId,
          upstreamModel: '',
          name: '',
          reasoning: false,
          contextWindow: '',
          maxTokens: '',
        })

        // --- channel editor --------------------------------------------------

        function ChannelForm({ draft, setDraft, snapshot, onDone, run, busy }) {
          const existing = draft.id !== ''
          const [probe, setProbe] = React.useState(null)
          const [fetched, setFetched] = React.useState(null)
          const [localBusy, setLocalBusy] = React.useState('')

          const patch = (values) => setDraft((current) => ({ ...current, ...values }))

          const save = async () => {
            const models = draft.quickModels
              .split(/[\n,]/)
              .map((entry) => entry.trim())
              .filter((entry) => entry !== '')
            await run('save', async () => {
              await request('channel.save', {
                id: draft.id === '' ? undefined : draft.id,
                name: draft.name.trim(),
                baseUrl: draft.baseUrl.trim(),
                apiKey: draft.apiKey.trim() === '' ? undefined : draft.apiKey.trim(),
                enabled: draft.enabled,
                priority: int(draft.priority, 100),
                weight: int(draft.weight, 0),
                timeoutMs: int(draft.timeoutMs, 120_000),
                reasoningEfforts: draft.reasoningEfforts,
                models,
              })
              setDraft(null)
              onDone('panel.notice.saved')
            })
          }

          const test = async () => {
            setLocalBusy('test')
            setProbe(null)
            try {
              const result = await request('channel.test', { id: draft.id, baseUrl: draft.baseUrl.trim(), apiKey: draft.apiKey.trim() || undefined })
              setProbe(
                result.ok
                  ? {
                      good: true,
                      text:
                        typeof result.modelCount === 'number'
                          ? t('panel.channels.testOk', { count: result.modelCount, ms: result.ms })
                          : t('panel.channels.testOkNoCount', { ms: result.ms }),
                    }
                  : { good: false, text: t('panel.channels.testFail', { detail: result.detail ?? '—' }) },
              )
            } catch (error) {
              setProbe({ good: false, text: t('panel.channels.testFail', { detail: error?.message ?? String(error) }) })
            } finally {
              setLocalBusy('')
            }
          }

          const fetchModels = async () => {
            setLocalBusy('fetch')
            setFetched(null)
            try {
              const result = await request('channel.models', { id: draft.id, baseUrl: draft.baseUrl.trim(), apiKey: draft.apiKey.trim() || undefined })
              setFetched(Array.isArray(result?.models) ? result.models : [])
            } catch (error) {
              setProbe({ good: false, text: t('panel.channels.testFail', { detail: error?.message ?? String(error) }) })
            } finally {
              setLocalBusy('')
            }
          }

          const appendModel = (id) => {
            const current = draft.quickModels.split(/[\n,]/).map((entry) => entry.trim()).filter((entry) => entry !== '')
            const name = id.includes('=') ? id.split('=')[0].trim() : id
            const taken = current.some((entry) => (entry.includes('=') ? entry.split('=')[0].trim() : entry) === name)
            patch({ quickModels: taken ? current.join('\n') : [...current, id].join('\n') })
          }

          return h(
            'div',
            { className: 'dcr-form' },
            h(
              'div',
              { className: 'dcr-formHead' },
              h('h2', null, existing ? t('panel.channels.editTitle') : t('panel.channels.newTitle')),
              h('button', { type: 'button', className: 'dcr-btn dcr-ghost dcr-sm', onClick: () => setDraft(null) }, t('panel.channels.cancel')),
            ),
            h(
              'div',
              { className: 'dcr-field' },
              h('label', { htmlFor: 'dcr-name' }, t('panel.channels.name')),
              h('input', {
                id: 'dcr-name',
                type: 'text',
                value: draft.name,
                placeholder: t('panel.channels.namePlaceholder'),
                onChange: (event) => patch({ name: event.target.value }),
              }),
            ),
            h(
              'div',
              { className: 'dcr-field' },
              h('label', { htmlFor: 'dcr-key' }, `${t('panel.channels.apiKey')}${existing ? ` · ${draft.hasKey ? t('panel.channels.keyConfigured') : t('panel.channels.keyMissing')}` : ''}`),
              h('input', {
                id: 'dcr-key',
                type: 'password',
                autoComplete: 'off',
                spellCheck: false,
                value: draft.apiKey,
                placeholder: existing ? t('panel.channels.apiKeyKeepPlaceholder') : t('panel.channels.apiKeyPlaceholder'),
                onChange: (event) => patch({ apiKey: event.target.value }),
              }),
            ),
            h(
              'div',
              { className: 'dcr-field dcr-wide' },
              h('label', { htmlFor: 'dcr-base' }, t('panel.channels.baseUrl')),
              h('input', {
                id: 'dcr-base',
                type: 'text',
                spellCheck: false,
                value: draft.baseUrl,
                placeholder: t('panel.channels.baseUrlPlaceholder'),
                onChange: (event) => patch({ baseUrl: event.target.value }),
              }),
            ),
            h(
              'div',
              { className: 'dcr-field' },
              h('label', { htmlFor: 'dcr-priority' }, t('panel.channels.priority')),
              h('input', {
                id: 'dcr-priority',
                type: 'number',
                min: 0,
                step: 1,
                value: draft.priority,
                onChange: (event) => patch({ priority: event.target.value }),
              }),
            ),
            h(
              'div',
              { className: 'dcr-field' },
              h('label', { htmlFor: 'dcr-weight' }, t('panel.channels.weight')),
              h('input', {
                id: 'dcr-weight',
                type: 'number',
                min: 0,
                step: 1,
                value: draft.weight,
                onChange: (event) => patch({ weight: event.target.value }),
              }),
            ),
            h(
              'div',
              { className: 'dcr-field' },
              h('label', { htmlFor: 'dcr-timeout' }, t('panel.channels.timeoutMs')),
              h('input', {
                id: 'dcr-timeout',
                type: 'number',
                min: 1000,
                step: 1000,
                value: draft.timeoutMs,
                onChange: (event) => patch({ timeoutMs: event.target.value }),
              }),
            ),
            h(
              'div',
              { className: 'dcr-field dcr-wide' },
              h('label', { htmlFor: 'dcr-efforts' }, `${t('panel.channels.reasoningEfforts')} · ${t('panel.field.optional')}`),
              h('input', {
                id: 'dcr-efforts',
                type: 'text',
                spellCheck: false,
                value: draft.reasoningEfforts,
                placeholder: 'low, high, max',
                onChange: (event) => patch({ reasoningEfforts: event.target.value }),
              }),
              h('span', { className: 'dcr-fieldHint' }, t('panel.channels.reasoningEffortsHint')),
            ),
            h(
              'div',
              { className: 'dcr-field' },
              h('span', null, t('panel.channels.enabled')),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dcr-switch',
                  role: 'switch',
                  'aria-checked': draft.enabled,
                  onClick: () => patch({ enabled: !draft.enabled }),
                },
                h('i'),
                draft.enabled ? t('panel.common.on') : t('panel.common.off'),
              ),
            ),
            h(
              'div',
              { className: 'dcr-field dcr-wide' },
              h('label', { htmlFor: 'dcr-models' }, t('panel.channels.quickModels')),
              h('textarea', {
                id: 'dcr-models',
                value: draft.quickModels,
                placeholder: t('panel.channels.quickModelsPlaceholder'),
                onChange: (event) => patch({ quickModels: event.target.value }),
              }),
              h('span', { className: 'dcr-fieldHint' }, t('panel.channels.quickModelsHint')),
              fetched === null
                ? null
                : h(
                    'div',
                    { className: 'dcr-inline', style: { marginTop: 4 } },
                    h('span', { className: 'dcr-muted' }, `${t('panel.channels.fetchedModels')}:`),
                    fetched.length === 0
                      ? h('span', { className: 'dcr-muted' }, '—')
                      : fetched.slice(0, 200).map((model) =>
                          h(
                            'button',
                            {
                              key: model.id,
                              type: 'button',
                              className: 'dcr-chip',
                              title: model.id,
                              onClick: () => appendModel(model.id),
                            },
                            model.id,
                          ),
                        ),
                  ),
            ),
            probe === null ? null : h('div', { className: `dcr-notice dcr-wide ${probe.good ? 'dcr-good' : 'dcr-bad'}` }, probe.text),
            h(
              'div',
              { className: 'dcr-formActions' },
              existing
                ? h(
                    'button',
                    { type: 'button', className: 'dcr-btn dcr-sm', disabled: localBusy !== '' || busy, onClick: test },
                    localBusy === 'test' ? t('panel.channels.testing') : t('panel.channels.test'),
                  )
                : null,
              h(
                'button',
                { type: 'button', className: 'dcr-btn dcr-sm', disabled: localBusy !== '' || busy, onClick: fetchModels },
                localBusy === 'fetch' ? t('panel.channels.fetchingModels') : t('panel.channels.fetchModels'),
              ),
              h(
                'button',
                { type: 'button', className: 'dcr-btn dcr-primary dcr-sm', disabled: busy || draft.baseUrl.trim() === '', onClick: save },
                busy ? t('panel.channels.saving') : t('panel.channels.save'),
              ),
            ),
          )
        }

        // --- binding form ---------------------------------------------------

        function BindingForm({ draft, setDraft, snapshot, onDone, run, busy }) {
          const patch = (values) => setDraft((current) => ({ ...current, ...values }))
          const channels = (snapshot?.channels ?? []).filter((channel) => channel.enabled !== false)

          const save = async () => {
            await run('binding', async () => {
              await request('binding.save', {
                id: draft.id === '' ? undefined : draft.id,
                model: draft.model.trim(),
                channelId: draft.channelId,
                upstreamModel: draft.upstreamModel.trim(),
                name: draft.name.trim(),
                reasoning: draft.reasoning,
                enabled: true,
                contextWindow: draft.contextWindow === '' ? undefined : int(draft.contextWindow, undefined),
                maxTokens: draft.maxTokens === '' ? undefined : int(draft.maxTokens, undefined),
              })
              setDraft(null)
              onDone('panel.notice.bound')
            })
          }

          return h(
            'div',
            { className: 'dcr-form' },
            h(
              'div',
              { className: 'dcr-formHead' },
              h('h2', null, t('panel.models.newTitle')),
              h('button', { type: 'button', className: 'dcr-btn dcr-ghost dcr-sm', onClick: () => setDraft(null) }, t('panel.channels.cancel')),
            ),
            h(
              'div',
              { className: 'dcr-field' },
              h('label', { htmlFor: 'dcr-model' }, t('panel.models.logicalModel')),
              h('input', {
                id: 'dcr-model',
                type: 'text',
                spellCheck: false,
                value: draft.model,
                placeholder: t('panel.models.logicalModelPlaceholder'),
                onChange: (event) => patch({ model: event.target.value }),
              }),
            ),
            h(
              'div',
              { className: 'dcr-field' },
              h('label', { htmlFor: 'dcr-ch' }, t('panel.models.channel')),
              h(
                'select',
                { id: 'dcr-ch', value: draft.channelId, onChange: (event) => patch({ channelId: event.target.value }) },
                h('option', { value: '' }, '—'),
                ...channels.map((channel) => h('option', { key: channel.id, value: channel.id }, channel.name || channel.baseUrl)),
              ),
            ),
            h(
              'div',
              { className: 'dcr-field' },
              h('label', { htmlFor: 'dcr-up' }, t('panel.models.upstreamModel')),
              h('input', {
                id: 'dcr-up',
                type: 'text',
                spellCheck: false,
                value: draft.upstreamModel,
                placeholder: t('panel.models.upstreamModelPlaceholder'),
                onChange: (event) => patch({ upstreamModel: event.target.value }),
              }),
            ),
            h(
              'div',
              { className: 'dcr-field' },
              h('label', { htmlFor: 'dcr-display' }, t('panel.models.displayName')),
              h('input', {
                id: 'dcr-display',
                type: 'text',
                value: draft.name,
                placeholder: t('panel.models.displayNamePlaceholder'),
                onChange: (event) => patch({ name: event.target.value }),
              }),
            ),
            h(
              'div',
              { className: 'dcr-field' },
              h('label', { htmlFor: 'dcr-ctx' }, `${t('panel.models.contextWindow')} · ${t('panel.field.optional')}`),
              h('input', {
                id: 'dcr-ctx',
                type: 'number',
                min: 0,
                step: 1000,
                value: draft.contextWindow,
                onChange: (event) => patch({ contextWindow: event.target.value }),
              }),
            ),
            h(
              'div',
              { className: 'dcr-field' },
              h('label', { htmlFor: 'dcr-max' }, `${t('panel.models.maxTokens')} · ${t('panel.field.optional')}`),
              h('input', {
                id: 'dcr-max',
                type: 'number',
                min: 0,
                step: 1000,
                value: draft.maxTokens,
                onChange: (event) => patch({ maxTokens: event.target.value }),
              }),
            ),
            h(
              'div',
              { className: 'dcr-field' },
              h('span', null, t('panel.models.reasoning')),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dcr-switch',
                  role: 'switch',
                  'aria-checked': draft.reasoning,
                  onClick: () => patch({ reasoning: !draft.reasoning }),
                },
                h('i'),
                draft.reasoning ? t('panel.common.on') : t('panel.common.off'),
              ),
            ),
            h(
              'div',
              { className: 'dcr-formActions' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'dcr-btn dcr-primary dcr-sm',
                  disabled: busy || draft.model.trim() === '' || draft.channelId === '',
                  onClick: save,
                },
                busy ? t('panel.channels.saving') : t('panel.models.save'),
              ),
            ),
          )
        }

        // --- panel ----------------------------------------------------------

        function Panel() {
          useLocale()
          const [snapshot, setSnapshot] = React.useState(null)
          const [loading, setLoading] = React.useState(true)
          const [error, setError] = React.useState('')
          const [tab, setTab] = React.useState('channels')
          const [notice, setNotice] = React.useState('')
          const [busy, setBusy] = React.useState('')
          const [channelDraft, setChannelDraft] = React.useState(null)
          const [bindingDraft, setBindingDraft] = React.useState(null)
          const [armedDelete, setArmedDelete] = React.useState('')

          const load = React.useCallback(async (silent) => {
            if (!silent) setLoading(true)
            try {
              const value = await request('state')
              setSnapshot(value)
              setError('')
            } catch (cause) {
              setError(cause?.message ?? String(cause))
            } finally {
              if (!silent) setLoading(false)
            }
          }, [])

          React.useEffect(() => {
            load(false)
          }, [load])

          React.useEffect(() => {
            const timer = setInterval(() => {
              if (document.visibilityState === 'visible') load(true)
            }, 15_000)
            return () => clearInterval(timer)
          }, [load])

          React.useEffect(() => {
            if (notice === '') return undefined
            const timer = setTimeout(() => setNotice(''), 3200)
            return () => clearTimeout(timer)
          }, [notice])

          const run = async (key, work) => {
            setBusy(key)
            try {
              await work()
            } catch (cause) {
              setNotice(`⚠ ${cause?.message ?? String(cause)}`)
            } finally {
              setBusy('')
            }
          }

          const announce = (key) => setNotice(t(key))

          const channels = snapshot?.channels ?? []
          const bindings = snapshot?.bindings ?? []
          const logs = snapshot?.logs ?? []
          const modelIds = [...new Set(bindings.map((binding) => binding.model))]
          const enabledChannels = channels.filter((channel) => channel.enabled !== false)
          const broken = channels.filter((channel) => {
            const health = healthOf(channel, snapshot)
            return health.key === 'cooldown' || health.key === 'invalid' || health.key === 'model'
          })
          const failovers = logs.filter((entry) => entry.outcome === 'failover').length

          const startEdit = (channel) =>
            setChannelDraft({
              id: channel.id,
              name: channel.name ?? '',
              baseUrl: channel.baseUrl ?? '',
              apiKey: '',
              priority: String(channel.priority ?? 100),
              weight: String(channel.weight ?? 0),
              timeoutMs: String(channel.timeoutMs ?? 120_000),
              enabled: channel.enabled !== false,
              reasoningEfforts: (channel.reasoningEfforts ?? []).join(', '),
              quickModels: quickModelsOf(snapshot, channel.id),
              hasKey: channel.hasKey === true,
            })

          const removeChannel = async (channel) => {
            if (armedDelete !== channel.id) {
              setArmedDelete(channel.id)
              return
            }
            setArmedDelete('')
            await run('delete', async () => {
              await request('channel.delete', { id: channel.id })
              if (channelDraft?.id === channel.id) setChannelDraft(null)
              await load(true)
              announce('panel.notice.deleted')
            })
          }

          const toggleChannel = async (channel) => {
            await run(`toggle:${channel.id}`, async () => {
              await request('channel.save', { id: channel.id, enabled: channel.enabled === false })
              await load(true)
              announce(channel.enabled === false ? 'panel.notice.enabled' : 'panel.notice.disabled')
            })
          }

          const resetChannel = async (channel) => {
            await run(`reset:${channel.id}`, async () => {
              await request('channel.reset', { id: channel.id })
              await load(true)
              announce('panel.notice.reset')
            })
          }

          const removeBinding = async (binding) => {
            await run(`unbind:${binding.id}`, async () => {
              await request('binding.delete', { id: binding.id })
              await load(true)
              announce('panel.notice.deleted')
            })
          }

          const clearLogs = async () => {
            await run('logs', async () => {
              await request('logs.clear')
              await load(true)
              announce('panel.logs.cleared')
            })
          }

          const stats = [
            { key: 'channels', value: enabledChannels.length, hint: t('panel.stats.channelsHint', { total: channels.length }) },
            { key: 'models', value: modelIds.length, hint: t('panel.stats.modelsHint', { count: bindings.length }) },
            { key: 'cooldown', value: broken.length, hint: t('panel.stats.cooldownHint') },
            { key: 'failovers', value: failovers, hint: t('panel.stats.failoversHint', { count: logs.length }) },
          ]

          const header = h(
            'div',
            { className: 'dcr-head', 'data-window-drag': true },
            h(
              'div',
              { className: 'dcr-headInner' },
              h(
                'div',
                null,
                h('h1', null, t('panel.title')),
                h('div', { className: 'dcr-sub' }, t('panel.subtitle')),
              ),
              h(
                'div',
                { className: 'dcr-headActions' },
                snapshot === null
                  ? null
                  : h(
                      'span',
                      { className: 'dcr-provider', title: t('panel.providerHint') },
                      t('panel.providerBadge'),
                      h('code', null, snapshot.providerRoute),
                    ),
                h(
                  'button',
                  { type: 'button', className: 'dcr-btn dcr-sm', disabled: loading, onClick: () => load(false) },
                  loading ? t('panel.refreshing') : t('panel.refresh'),
                ),
              ),
            ),
          )

          const body = (() => {
            if (snapshot === null && loading) return h('div', { className: 'dcr-empty' }, h('strong', null, t('panel.loading')))
            if (snapshot === null) {
              return h(
                'div',
                { className: 'dcr-empty' },
                h('strong', null, t('panel.error')),
                h('span', null, error || '—'),
                h(
                  'div',
                  { style: { marginTop: 14 } },
                  h('button', { type: 'button', className: 'dcr-btn dcr-sm', onClick: () => load(false) }, t('panel.retry')),
                ),
              )
            }

            if (tab === 'channels') {
              return h(
                'div',
                { className: 'dcr-section' },
                snapshot.persistent === true
                  ? null
                  : h(
                      'div',
                      { className: 'dcr-banner' },
                      t('panel.banner.memory'),
                      snapshot.storageReason ? ` ${t('panel.banner.memoryReason', { reason: snapshot.storageReason })}` : '',
                    ),
                h(
                  'div',
                  { className: 'dcr-toolbar' },
                  h('span', { className: 'dcr-muted' }, t('panel.channels.modelsBound', { count: bindings.length })),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dcr-btn dcr-primary dcr-sm',
                      onClick: () => setChannelDraft(emptyChannel(snapshot)),
                    },
                    t('panel.channels.add'),
                  ),
                ),
                channelDraft === null
                  ? null
                  : h(ChannelForm, {
                      draft: channelDraft,
                      setDraft: setChannelDraft,
                      snapshot,
                      onDone: (key) => {
                        announce(key)
                        load(true)
                      },
                      run,
                      busy: busy !== '',
                    }),
                channels.length === 0 && channelDraft === null
                  ? h(
                      'div',
                      { className: 'dcr-empty' },
                      h('strong', null, t('panel.channels.empty')),
                      h('span', null, t('panel.channels.emptyHint')),
                    )
                  : null,
                channels.map((channel) =>
                      h(
                        'div',
                        { className: 'dcr-card', key: channel.id },
                        h(
                          'div',
                          { className: 'dcr-cardHead' },
                          h(
                            'div',
                            { style: { minWidth: 0 } },
                            h(
                              'div',
                              { className: 'dcr-cardTitle' },
                              h('b', { title: channel.name }, channel.name || channel.baseUrl),
                              healthChip(channel, snapshot),
                            ),
                            h('div', { className: 'dcr-url', title: channel.baseUrl }, channel.baseUrl),
                          ),
                          h(
                            'button',
                            {
                              type: 'button',
                              className: 'dcr-switch',
                              role: 'switch',
                              'aria-checked': channel.enabled !== false,
                              disabled: busy === `toggle:${channel.id}`,
                              onClick: () => toggleChannel(channel),
                              title: t('panel.channels.enabled'),
                            },
                            h('i'),
                            channel.enabled !== false ? t('panel.common.on') : t('panel.common.off'),
                          ),
                        ),
                        h(
                          'div',
                          { className: 'dcr-cardMeta' },
                          h('span', { className: 'dcr-chip' }, channel.hasKey === true ? t('panel.channels.keyConfigured') : t('panel.channels.keyMissing')),
                          h('span', { className: 'dcr-chip' }, t('panel.channels.priorityShort', { value: channel.priority ?? 100 })),
                          h('span', { className: 'dcr-chip' }, t('panel.channels.weightShort', { value: channel.weight ?? 0 })),
                          h('span', { className: 'dcr-chip' }, t('panel.channels.modelsBound', { count: bindingsOf(snapshot, channel.id).length })),
                        ),
                        h(
                          'div',
                          { className: 'dcr-cardActions' },
                          h(
                            'button',
                            { type: 'button', className: 'dcr-btn dcr-sm', onClick: () => startEdit(channel) },
                            t('panel.channels.edit'),
                          ),
                          h(
                            'button',
                            {
                              type: 'button',
                              className: 'dcr-btn dcr-sm',
                              disabled: busy === `reset:${channel.id}`,
                              onClick: () => resetChannel(channel),
                            },
                            t('panel.channels.resetHealth'),
                          ),
                          h(
                            'button',
                            {
                              type: 'button',
                              className: 'dcr-btn dcr-sm dcr-danger',
                              disabled: busy === 'delete',
                              onClick: () => removeChannel(channel),
                              onBlur: () => setArmedDelete(''),
                            },
                            armedDelete === channel.id ? t('panel.channels.deleteConfirm') : t('panel.channels.delete'),
                          ),
                        ),
                      ),
                    ),
              )
            }

            if (tab === 'models') {
              const groups = new Map()
              for (const binding of bindings) {
                if (!groups.has(binding.model)) groups.set(binding.model, [])
                groups.get(binding.model).push(binding)
              }
              const ordered = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))
              const channelOf = (id) => channels.find((channel) => channel.id === id)

              return h(
                'div',
                { className: 'dcr-section' },
                h(
                  'div',
                  { className: 'dcr-toolbar' },
                  h('span', { className: 'dcr-muted' }, t('panel.models.useInDsh') + (snapshot.providerRoute ? ` · ${snapshot.providerRoute}` : '')),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dcr-btn dcr-primary dcr-sm',
                      onClick: () => setBindingDraft(emptyBinding(enabledChannels[0]?.id ?? channels[0]?.id ?? '')),
                    },
                    t('panel.models.add'),
                  ),
                ),
                bindingDraft === null
                  ? null
                  : h(BindingForm, {
                      draft: bindingDraft,
                      setDraft: setBindingDraft,
                      snapshot,
                      onDone: (key) => {
                        announce(key)
                        load(true)
                      },
                      run,
                      busy: busy !== '',
                    }),
                ordered.length === 0
                  ? h(
                      'div',
                      { className: 'dcr-empty' },
                      h('strong', null, t('panel.models.empty')),
                      h('span', null, t('panel.models.emptyHint')),
                    )
                  : ordered.map(([model, rows]) => {
                      const chain = [...rows]
                        .map((binding) => ({ binding, channel: channelOf(binding.channelId) }))
                        .filter((entry) => entry.channel !== undefined)
                        .sort(
                          (a, b) =>
                            (a.channel.priority ?? 100) - (b.channel.priority ?? 100) ||
                            (b.channel.weight ?? 0) - (a.channel.weight ?? 0) ||
                            String(a.channel.name).localeCompare(String(b.channel.name)),
                        )
                      return h(
                        'div',
                        { className: 'dcr-group', key: model },
                        h(
                          'div',
                          { className: 'dcr-groupHead' },
                          h(
                            'div',
                            { style: { minWidth: 0 } },
                            h('b', null, model),
                            h(
                              'div',
                              { className: 'dcr-chain' },
                              t('panel.models.routeOrder'),
                              ': ',
                              ...chain.flatMap((entry, index) => [
                                index === 0 ? null : h('i', { key: `a${index}` }, '→'),
                                h('span', { key: `${entry.channel.id}-${index}` }, entry.channel.name || entry.channel.baseUrl),
                              ]),
                            ),
                          ),
                          chain.length > 1 ? h('span', { className: 'dcr-chip' }, `×${chain.length}`) : null,
                        ),
                        ...rows.map((binding) =>
                          h(
                            'div',
                            { className: 'dcr-row', key: binding.id },
                            h(
                              'div',
                              { className: 'dcr-rowMain' },
                              h('b', null, channelOf(binding.channelId)?.name ?? binding.channelId),
                              h('span', { className: 'dcr-mono dcr-muted' }, `→ ${binding.upstreamModel}`),
                              binding.reasoning === true ? h('span', { className: 'dcr-chip' }, 'reasoning') : null,
                              binding.contextWindow ? h('span', { className: 'dcr-chip' }, `ctx ${binding.contextWindow}`) : null,
                            ),
                            h(
                              'div',
                              { className: 'dcr-rowActions' },
                              h(
                                'button',
                                {
                                  type: 'button',
                                  className: 'dcr-btn dcr-ghost dcr-sm dcr-danger',
                                  disabled: busy === `unbind:${binding.id}`,
                                  onClick: () => removeBinding(binding),
                                },
                                t('panel.models.delete'),
                              ),
                            ),
                          ),
                        ),
                      )
                    }),
              )
            }

            const tagClass = (outcome) =>
              outcome === 'success' ? 'dcr-ok' : outcome === 'failover' ? 'dcr-warn' : 'dcr-bad'
            const tagText = (outcome) =>
              outcome === 'success'
                ? t('panel.logs.outcomeSuccess')
                : outcome === 'failover'
                  ? t('panel.logs.outcomeFailover')
                  : t('panel.logs.outcomeFailed')

            return h(
              'div',
              { className: 'dcr-section' },
              h(
                'div',
                { className: 'dcr-toolbar' },
                h('span', { className: 'dcr-muted' }, t('panel.stats.failoversHint', { count: logs.length })),
                h(
                  'button',
                  { type: 'button', className: 'dcr-btn dcr-sm', disabled: logs.length === 0 || busy === 'logs', onClick: clearLogs },
                  t('panel.logs.clear'),
                ),
              ),
              logs.length === 0
                ? h(
                    'div',
                    { className: 'dcr-empty' },
                    h('strong', null, t('panel.logs.empty')),
                    h('span', null, t('panel.logs.emptyHint')),
                  )
                : logs.map((entry) =>
                    h(
                      'details',
                      { className: 'dcr-log', key: entry.id },
                      h(
                        'summary',
                        null,
                        h('span', { className: `dcr-tag ${tagClass(entry.outcome)}` }, tagText(entry.outcome)),
                        h('span', { className: 'dcr-mono' }, entry.model),
                        h('span', { className: 'dcr-muted' }, clock(entry.time)),
                        h('span', { className: 'dcr-muted' }, t('panel.logs.duration', { ms: entry.durationMs ?? '—' })),
                        h(
                          'span',
                          { className: 'dcr-muted', style: { flex: 1, minWidth: 0 } },
                          (entry.attempts ?? []).map((attempt) => attempt.channelName || attempt.channelId).join(' → '),
                        ),
                        h('span', { className: 'dcr-caret', 'aria-hidden': true }, '▾'),
                      ),
                      h(
                        'div',
                        { className: 'dcr-logBody' },
                        (entry.attempts ?? []).map((attempt, index) =>
                          h(
                            'div',
                            { className: 'dcr-attempt', key: `${entry.id}-${index}` },
                            h('span', { className: `dcr-tag ${attempt.ok ? 'dcr-ok' : 'dcr-bad'}` }, attempt.ok ? 'OK' : attempt.code ?? 'FAIL'),
                            h('span', null, attempt.channelName || attempt.channelId),
                            h('span', { className: 'dcr-mono dcr-muted' }, attempt.model ?? ''),
                            typeof attempt.ms === 'number' ? h('span', { className: 'dcr-muted' }, t('panel.logs.ms', { ms: attempt.ms })) : null,
                            attempt.status ? h('span', { className: 'dcr-muted' }, `HTTP ${attempt.status}`) : null,
                            attempt.message ? h('span', { className: 'dcr-muted', title: attempt.message }, `· ${attempt.message}`) : null,
                          ),
                        ),
                      ),
                    ),
                  ),
            )
          })()

          const tabButton = (id, label) =>
            h(
              'button',
              {
                type: 'button',
                role: 'tab',
                className: 'dcr-tab',
                'aria-selected': tab === id,
                onClick: () => setTab(id),
              },
              label,
            )

          const content = h(
            'div',
            { className: 'dcr-inner' },
            h(
              'div',
              { className: 'dcr-stats' },
              ...stats.map((stat) =>
                h(
                  'div',
                  { className: 'dcr-stat', key: stat.key },
                  h('div', { className: 'dcr-statLabel' }, t(`panel.stats.${stat.key}`)),
                  h('div', { className: 'dcr-statValue' }, String(stat.value)),
                  h('div', { className: 'dcr-statHint', title: stat.hint }, stat.hint),
                ),
              ),
            ),
            h(
              'div',
              { className: 'dcr-tabs', role: 'tablist' },
              tabButton('channels', t('panel.tabs.channels')),
              tabButton('models', t('panel.tabs.models')),
              tabButton('logs', t('panel.tabs.logs')),
            ),
            notice === ''
              ? null
              : h('div', { className: `dcr-notice ${notice.startsWith('⚠') ? 'dcr-bad' : 'dcr-good'}`, role: 'status' }, notice),
            body,
          )

          return h(
            'div',
            { className: 'dcr-root', 'aria-busy': loading },
            h('style', null, css),
            header,
            h('div', { className: 'dcr-scroll' }, content),
          )
        }

        // A throwing panel blanks its slot entry, so keep the failure readable.
        class PanelBoundary extends React.Component {
          constructor(props) {
            super(props)
            this.state = { failed: false, message: '' }
          }

          static getDerivedStateFromError(error) {
            return { failed: true, message: error?.message ?? String(error) }
          }

          render() {
            if (this.state.failed) {
              return h(
                'div',
                { className: 'dcr-root' },
                h('style', null, css),
                h('div', { className: 'dcr-crash' }, t('panel.crash', { message: this.state.message })),
              )
            }
            return this.props.children
          }
        }

        function PanelEntry() {
          return h(PanelBoundary, null, h(Panel))
        }

        function PanelIcon({ size }) {
          useLocale()
          const edge = typeof size === 'number' ? size : 18
          return h(
            'svg',
            {
              width: edge,
              height: edge,
              viewBox: '0 0 24 24',
              fill: 'none',
              stroke: 'currentColor',
              strokeWidth: 1.7,
              strokeLinecap: 'round',
              strokeLinejoin: 'round',
              'aria-hidden': true,
            },
            h('path', { d: 'M4 7h5a3 3 0 0 1 3 3v4a3 3 0 0 0 3 3h5' }),
            h('path', { d: 'M18 3.5 21 7l-3 3.5' }),
            h('path', { d: 'M15.5 6.5 12 3 8.5 6.5' }),
          )
        }

        // `inject` waits for the owning declaration: the sidebar and the layout
        // load on their own schedule, and registrations are replayed when a
        // declaration collapses and returns.
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            { name: 'sidebar.panellist', id: PANEL_ID, order: 12, label: () => t('sidebar.label') },
            PanelIcon,
          ),
        )
        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: PANEL_ID }, PanelEntry),
        )
      },
    }
  },
})
