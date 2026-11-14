# dsh_multi_api 设计方案 v0.1

状态：已实现，见 [README](README.md)。本文保留最初的方案与取舍记录——哪些假设成立、哪些被推翻，读代码前先看这里能省不少时间。
日期：2026-11-14（实现 2026-11-15）

---

## 0. 一句话概括

在 DSH 里注册一个"虚拟模型供应商"。用户在插件页面里配置若干**上游渠道**（名称 / 协议 / BaseURL / 密钥 / 模型映射 / 优先级 / 权重），DSH 的模型选择器里出现的是**你自己定义的逻辑模型名**；请求进来后由插件挑渠道发出，当某个渠道**额度耗尽或不可用**时，自动切换到同一逻辑模型的其它渠道。

本质：把 new-api 的"渠道 + 模型 + 故障转移"这一层，做成 DSH 的一个 LLM adapter。

---

## 1. 目标与非目标

### 目标

- **G1 多渠道路由**：同一逻辑模型（如 `gpt-5`、`claude-sonnet-4-5`）可绑定多个渠道；请求按优先级 / 权重 / 健康度选一条发出。
- **G2 自动故障转移**：额度耗尽、鉴权失效、上游 5xx、超时、该渠道没有该模型时，自动改走同逻辑模型的其它渠道，用户无感。
- **G3 额度熔断**：某个渠道被判定额度耗尽后进入冷却，后续请求不再选它；到期或手动恢复后重新参与。
- **G4 在 DSH 里直接用**：配好的逻辑模型出现在会话模型选择器 / `/model` 里，选中即用。
- **G5 可视化管理**：渠道增删改、模型映射、状态（健康 / 冷却 / 禁用）、测试连通性、调用日志。
- **G6 不污染 DSH 核心**：不动会话日志格式，不往模型可见内容里塞东西，不依赖 DSH 私有内部实现。

### 非目标（至少 v1 不做）

- **N1** 不做多租户 / 令牌分发 / 计费体系（new-api 的"令牌"那一层）。
- **N2** 不做对外提供 OpenAI 兼容 HTTP 端点（那是 new-api 服务端的形态；我们是被 DSH 进程内调用的 adapter）。
- **N3** 不做跨进程 / 多实例共享渠道状态（DSH 桌面是单进程，见 §11）。
- **N4** 不替代 `dsh-llm-retry` 的瞬时重试职责（见 §4-D10）。

---

## 2. DSH 侧能力盘点（决定方案边界的既成事实）

以下均为对当前安装版本 (`DSH_PROFILE=desktop`，`/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/...`) 的只读核对结果，不是凭记忆。

| 事实 | 出处 | 对我们的意义 |
|---|---|---|
| `ctx.llm` 是 provider 无关的模型调用服务，唯一入口 `ctx.llm.stream(options)` | `dsh-llm/README.md` | 我们只需在这一个方法里做文章 |
| 适配器通过 `ctx.llm.registerAdapter(providers: string[], adapter: LlmAdapter)` 注册；同一路由重复注册抛 `DUPLICATE_ADAPTER`（全有或全无） | `LlmRuntime` 服务契约 | 我们占用一个自己的路由名（如 `relay`），不与他人冲突 |
| `LlmAdapter` 里**只有 `stream()` 是 abstract**；`listModels` / `resolveModel` / `providerInfo` / `providerRetryPolicy` / `prepareCall` 等有默认实现 | `LlmAdapter` 声明 | 最小实现只要 3–4 个方法 |
| 请求形态：`GenerateOptions { provider, model, messages, system?, tools?, toolHistory?, temperature?, maxTokens?, stop?, signal?, sessionId?, purpose? }`；**loop 构造的请求是 deep-frozen，监听器只能读不能改** | `GenerateOptions` 声明 + `llm/stream` 事件契约 | 我们不改请求，只改"发给谁" |
| 输出协议：`StreamChunk` = `block-start` / `text-delta` / `reasoning-delta` / `tool-call-delta` / `block-end` / `usage` / `finish{reason: stop\|tool-calls\|max-tokens\|aborted\|error}`，且**必须以唯一一个 `finish` 收尾** | `StreamChunk` 声明 | 上游 SSE 必须逐块翻译成这套协议 |
| 失败码是稳定字符串：`NO_ADAPTER` `MISSING_CREDENTIAL` `INVALID_CREDENTIAL` `AUTH` `RATE_LIMIT` `QUOTA` `ACCOUNT_QUOTA` `SERVER` `TIMEOUT` `TRANSPORT` `EMPTY_RESPONSE` `MALFORMED_RESPONSE` `CONTEXT_WINDOW_EXCEEDED` `INVALID_REQUEST` `UNKNOWN_MODEL` `UNSUPPORTED_OPTION` `IMAGE_OFFLOAD_REQUIRED` `HTTP_<status>` | `dsh-llm/README.md` | 换渠道的判据就建立在这套码上（§9） |
| `QUOTA` = provider 无关的"额度耗尽"；`ACCOUNT_QUOTA` 专指可充值的一方账户余额 | 同上 | 我们的核心触发条件映射到 `QUOTA` |
| **一次 `stream` = 一次 provider 尝试**；服务本身从不重跑请求，重跑由 `dsh-llm-retry` 在 `agent/request-error` 瀑布上、以"先落盘再等待"的方式在 agent step 边界执行 | `dsh-llm/README.md`、`dsh-llm-retry/README.md` | 这是本方案最大的设计张力点，见 §4-D3 |
| `dsh-llm-retry` 默认只重试 `EMPTY_RESPONSE` `RATE_LIMIT` `SERVER` `TIMEOUT` `TRANSPORT`；**`QUOTA` 不在默认集合里**；always 模式会无限重试包括永久失败 | `dsh-llm-retry/README.md` | 默认配置下额度耗尽会"快速失败到用户"，正好是我们要接管的情形 |
| `llm/stream` 是瀑布事件：`(options, next) => AsyncIterable<StreamChunk>`，可包裹、可短路 | `llm/stream` 事件契约 | 方案备选 B（§4-D3） |
| 每条路由注册时**捕获**自己的 `retryPolicy`；`dsh-llm-retry` 从路由上取策略 | `dsh-llm/README.md` | 我们的路由可以声明"本路由可重试哪些码" |
| GUI 里的模型选择**要求模型出现在适配器广告的目录里**：适配器必须实现 `listModels` 并返回可用模型 | `dsh-llm/README.md`（"The GUI requires catalog membership"） | G4 的硬性前提；这也是最高优先级的待验证点（§10 阶段 0） |
| 目录变化时适配器广播 `llm/models-updated(provider)`，客户端重新加载整个目录 | 同上 | 用户改渠道/改模型后，模型选择器要能刷新 |
| 模型目录项可带 `badge`（文案 + `neutral/info/success/warning` 四档语气） | 同上 | 可以用来标"渠道池""降级中" |
| 模型选择器按 provider 分组，组内是模型；每组是独立的 provider 分组 | `dsh-client-ui-model-selection/README.md` | 我们的路由 = 选择器里的一个 provider 分组 |
| 选择器提供 `conversation.input.model.label` slot（composer 触发器 / 菜单当前值 / 每个选项三处），owner props 给出 `provider:{id,name}`、`model`、`placement`、`selected` | 同上 | 可以用来显示"当前走的渠道" |
| 会话事实里记录的 provider/model 来自**请求头**（`ModelMessageSource`），`ReplayEnvelope` 由适配器自己解释 | `AssistantProviderMetadata` 声明 | 换渠道对会话日志是"隐形"的，必须在插件自己的日志里可见（§4-D11） |
| 凭证：`ctx.credentials`（`set` / `describe` / `unset` / `readRecord` / `modifyRecord` / `listRecords` / `deleteRecord`），本地实现是 `$DSH_HOME/.credentials.yaml`，`refs` 按环境变量名存值，`records` 按 `<owner>/<id>` 存结构化凭证（`kind: api-key` 或 `grant`） | `dsh-credentials-local/README.md` | 密钥不进配置文件，走凭证层；`describe` 永不返回值本身 |
| 持久化：`defineDomain({name, version, tables})` + `ctx.storageDomain.open(spec)`，读同步、写先落盘后返回、写序发 `domain/changed` | `dsh-storage-domain/README.md` | 渠道表 / 状态 / 日志的落点 |
| 插件自身配置改动一般会**重启该插件**，除非字段声明 `.volatile()`；`ctx.configEditor.edit(entry, change)` 是插件改写自己配置的唯一正途 | `references/configuration.md` | 渠道表若放配置里，每改一次就重启插件 → 所以渠道表应放 storage domain（§4-D8） |
| 插件形态：bundle（Host 半 + Client 半 + patch + locale + 图标 + 详情文档），用 `plugin_manager install_bundle` 安装，或用界面 **Plugins > Add plugin** 装本地目录 | `references/plugin-development.md`、`host-plugin.md` | 交付形态确定 |

结论：**DSH 已经为"自定义供应商"留好了口子**，我们不需要 hack，只需要正确实现 `LlmAdapter`。

---

## 3. 总体结构

```
                    DSH Agent Loop / 会话标题 / 压缩摘要
                                  |
                       ctx.llm.stream({provider:'relay', model:'<逻辑模型名>'})
                                  |
                                  v
        +------------------------------------------------------+
        |  Channel Relay 插件（Host 半）                        |
        |                                                      |
        |  Adapter (LlmAdapter)                                |
        |    providerInfo / listModels / resolveModel          |
        |    stream()  <-- 唯一的核心                          |
        |        |                                             |
        |        v                                             |
        |  Router（路由决策）                                    |
        |    · 按 sessionId 的粘性偏好（缓存亲和，尽力而为）        |
        |    · 优先级排序 → 同优先级内按权重随机                    |
        |    · 跳过 cooling / disabled / 不支持该模型的渠道        |
        |        |                                             |
        |        v                                             |
        |  Attempt Loop（尝试循环，含换渠道）                      |
        |    dispatch(channel) -> 上游 SSE -> StreamChunk        |
        |    失败分类 → 可换则冷却该渠道 + 换下一条（提交点之前）    |
        |        |                                             |
        |        v                                             |
        |  Wire Layer（每协议一个客户端）                         |
        |    openai-completions / anthropic-messages / ...      |
        +------------------------------------------------------+
                 |                        |
                 v                        v
        ctx.credentials           ctx.storageDomain
        （渠道密钥）               （渠道表 / 状态 / 用量 / 日志）

        +------------------------------------------------------+
        |  Channel Relay 插件（Client 半）                       |
        |   · 渠道管理页（列表 / 编辑 / 测试 / 启用停用 / 重置冷却）  |
        |   · 调用日志与用量页（可选）                             |
        |   · 模型标签 slot：显示当前逻辑模型实际走的渠道（可选）     |
        +------------------------------------------------------+
```

组件清单：

1. **Adapter**：实现 `LlmAdapter`，注册路由（默认 `relay`，可配置）。
2. **Router**：从渠道池里给出一个有序候选序列。
3. **Attempt Loop**：逐个候选尝试，含换渠道判定与提交点判定。
4. **Wire Layer**：上游协议客户端，把 SSE 翻译成 `StreamChunk`。
5. **Channel Store**：渠道定义 + 运行时状态（storage domain）。
6. **Credential Binding**：渠道密钥 ↔ 凭证层。
7. **Metrics/Log**：每次尝试的结果、耗时、usage（可选，storage domain）。
8. **Client UI**：管理页 + 标签。

---

## 4. 关键设计决策

### D1 挂载形态：一个 bundle，Host 半 + Client 半

Host 半做 adapter 与状态；Client 半做管理页。两者一个包，一次安装（`plugin_manager install_bundle`）。
备选：只做 Host 半、渠道表塞进 `cordis.patch.yml`。代价是每改一次渠道就重启插件、密钥会落到配置文件里、没有状态展示。**不推荐**。

### D2 对外路由标识

路由名 = provider id，出现在模型选择器的分组名和会话记录的 `provider` 里。建议默认 `relay`，可通过插件 Config 改（但改路由名会让已有会话记录的旧 provider 失效，需在文档里警告）。
模型 id = **用户自己定义的逻辑模型名**（如 `gpt-5`、`deepseek-chat-cheap`）。逻辑模型名一旦被会话选中就会写进会话记录，**改名 = 旧会话变成不可路由**（DSH 对此已有降级展示："Unroutable sessions"），所以逻辑模型名应尽量稳定。

### D3 换渠道放在哪一层（本方案最关键的一处取舍）

| 方案 | 做法 | 优点 | 代价 |
|---|---|---|---|
| **A. Adapter 内部换渠道（推荐）** | `stream()` 内部循环尝试多个渠道，对外只表现成一次流 | 对 loop / 标题 / 压缩等所有调用点都生效；请求内容完全不变；实现集中 | 与"一次 stream = 一次 provider 尝试"的既有约定不符；第二次尝试是**真金白银的重发**，只是没落进会话日志 |
| B. `llm/stream` 瀑布里换路由 | 监听 `llm/stream`，捕获终止错误后改 `options.provider` 重发 | 更贴近 DSH 既有分层 | loop 请求 deep-frozen，无法改 `provider`；要伪造 options 对象或另建请求，且**已产出的分块无法回收**；会话记录的 provider 与实际不符 |
| C. 交给 `dsh-llm-retry` | 每个渠道注册成独立路由，靠重试策略轮换 | 完全复用现成机制 | 策略是"同一路由"级的，路由间轮换做不到；`QUOTA` 默认不重试；always 模式行为过于激进 |

**推荐 A**，并在插件文档里显式写明：adapter 内部换渠道 = "逻辑路由内部的实现细节"，不对会话日志可见；同时保留 B 作为将来 DSH 若提供正式"多路由回退" seam 时的迁移目标。

### D4 换渠道的边界：提交点（commit point）

一旦已经向消费者吐出**首个可见内容分块**，就不能再换渠道——否则会出现两段内容拼接、块索引错乱、`block-end` 不匹配。定义：

- 提交点 = 首个 `text-delta`（非空）/ `reasoning-delta`（非空）/ `tool-call-delta` / 非空 `block-end` 被 yield 出去的那一刻。
- 提交点之前失败 → 冷却该渠道，换下一条候选。
- 提交点之后失败 → 不换，直接以 `finish{ reason:'error', failure }` 收尾，把瞬时失败交给 `dsh-llm-retry` 在 agent step 边界重跑整个 step（那时会重新进我们的 `stream()`，路由会自然绕开刚被冷却的渠道）。
- `aborted`（用户取消 / 上游 signal 取消）永远不换渠道、不冷却。

实现上建议：**延迟 yield**。在拿到首个可见分块前，只做"翻译"，不向外 yield（`block-start` 本身可以先不发）。这样提交点判定简单且不会出现半截块。

### D5 额度判定与熔断

分三步：

1. **被动判定（v1 必做）**：把上游错误映射成 DSH 失败码，`QUOTA` 类错误 = 该渠道额度耗尽。
2. **渠道冷却状态机**：`healthy → cooling(until) → healthy`；`disabled`（用户手动）、`invalid`（密钥失效，需人工修）。
   - `QUOTA` → 冷却时长默认 30 分钟（可配），并可在界面上手动"重置"。
   - `AUTH` / `INVALID_CREDENTIAL` → 直接进 `invalid`，不自动恢复（钥匙错了，等再试也是错）。可选：每 N 分钟探活一次。
   - 连续失败计数达到阈值 → 指数退避冷却（避免 5xx 抖动打穿）。
   - 冷却状态**持久化**，重启后仍然生效。
3. **主动探测（v2 可选）**：对提供余额接口的渠道（如 `/user/balance`、`/dashboard/billing` 之类）定期查询，做"预判"。**注意**：这类接口不统一、会变、且常常不计入账单口径，所以只能是"锦上添花"，不能当作"额度已耗尽"的唯一依据。

另外可选支持**本地软预算**：按渠道配置"本月最多 X 元 / Y tokens"，用 usage 累加，超了自熔断。这是唯一可靠、不依赖上游的额度控制手段。

### D6 渠道选择策略

候选生成顺序（v1）：

1. 过滤：`enabled` 且 `state != cooling/invalid` 且该渠道 `bindings` 里含此逻辑模型。
2. 按 `priority` 升序分组（数字小者优先）。
3. 同优先级内按 `weight` 加权随机。
4. **会话粘性**：若该 `sessionId` 上最近成功的渠道仍在候选里，则提到最前（保 prompt 缓存亲和）。粘性是进程内 LRU，不持久化，可配置开关。
5. 其余按权重顺序作为 fallback 序列。

v2 可选：渠道级并发上限（信号量）、渠道级 RPM/TPM 限速——这两个是 new-api 的"渠道限流"能力，但实现成本不小，且 DSH 本身已有 `dsh-llm-retry` 兜 RATE_LIMIT，所以优先级放低。

### D7 模型映射（这是 new-api 的核心手感，必须做）

一个"逻辑模型" = 一组"渠道绑定"：

```
逻辑模型 gpt-5
  ├─ 渠道 A(优先级 1, 权重 60)  upstream: gpt-5-2026-10-01  参数字典: {}
  ├─ 渠道 B(优先级 1, 权重 40)  upstream: gpt-5             参数字典: {maxTokens: 64000}
  └─ 渠道 C(优先级 2, 权重 100) upstream: azure-deploy-gpt5  参数字典: {maxTokens: 32000}
```

`resolveModel(provider, model)` 必须为逻辑模型给出**合并后的能力描述**，跨渠道取保守值：

- `context.contextWindow` = 各启用绑定中的**最小值**（否则会出现"这个渠道能塞，那个渠道直接 CONTEXT_WINDOW_EXCEEDED"的随机失败）。
- `defaultMaxTokens` = 最小值。
- `reasoning.efforts` = 各绑定的**交集**，并支持每个渠道声明自己的映射表（参考 pi-ai 的 `reasoningEfforts: {max: ultra}` 写法）。选中的 effort 到具体渠道时按该渠道的映射翻译；某渠道不支持所选 effort 时，该渠道在这次请求里**不参与候选**（比静默降级更安全）。
- `inputModalities` = 交集（某渠道不支持图片 → 该渠道在有图片的请求里退出候选）。
- `systemPromptUpdate` / `toolUpdate` 取各绑定的**保守值**（不支持 in-history system 的渠道按保守处理）。

### D8 持久化边界

| 数据 | 落点 | 理由 |
|---|---|---|
| 渠道列表、模型映射、优先级权重、开关 | `ctx.storageDomain` 的 `channels` 表 | 需要热更新 + 自建 UI；放 Config 里每次改都会重启插件 |
| 渠道密钥 | `ctx.credentials`（`refs` 按 `CHANNEL_<ID>_API_KEY`，或 `records` 的 `<owner>/<id>`） | 官方通道；`describe` 不回显值；不进配置文件 |
| 渠道运行时状态（冷却到何时、连续失败数） | `ctx.storageDomain` 的 `channelState` 表 | 需跨重启保持 |
| 用量 / 调用日志（可选） | `ctx.storageDomain` 的 `usage` / `callLog` 表 | 与模型无关的旁路数据 |
| 插件自身的少量开关（路由名、默认冷却时长、日志保留条数） | 插件 Config（`cordis.patch.yml`） | 这些改一次重启也无所谓 |

注意两条纪律：

- **绝不往会话日志里写新事件类型**（DSH 只接受带 `ignorable` 标记的未知事件，而活会话 append 无法设该标记）。我们的数据全部走 storage domain。
- **绝不用插件内存当唯一真相**：进程重启后渠道状态必须能从 domain 读回来。

### D9 模型目录暴露（G4 的成败点）

- `listModels(provider)`：返回所有逻辑模型（带 `name`、`description`、可选 `badge`）。
- `resolveModel(provider, model, signal)`：返回能力描述（§D7）。
- 目录变化（用户加渠道 / 改映射 / 启停逻辑模型）后，广播 `llm/models-updated(provider)` 让 GUI 重载。
- 没有任何可用绑定（所有渠道都冷却/禁用）时：**仍然列出模型**，让用户能选中并看到明确的失败原因，而不是列表突然消失。

### D10 与 `dsh-llm-retry` 的关系

- 我们的路由声明 `providerRetryPolicy`：normal 模式，`maxRetries` 1–2，`retryableCodes` = `[SERVER, TIMEOUT, TRANSPORT, EMPTY_RESPONSE]`。
- **刻意不含 `QUOTA` / `AUTH`**：这两类由我们内部换渠道处理，重试同一渠道没有意义。也不建议用户对我们的路由开 always 模式。
- 分工写清楚：**我们管"换渠道"，`dsh-llm-retry` 管"同一渠道的瞬时抖动重试 + step 级重跑"**。

### D11 可观测性（换渠道对模型是隐形的）

`ModelMessageSource` 记录的是请求头的 provider/model，所以**会话日志里看不出真实走的哪个渠道**。补足手段：

- 插件自己的调用日志（storage domain）：时间、会话 id、逻辑模型、渠道、上游模型、结果码、耗时、usage、是否发生换渠道、换了几次。
- 失败时把"已尝试的渠道 + 各自失败原因"拼进 `LlmFailure.message`（只进错误面，不进模型可见内容），让用户一眼看到"三个渠道都试过了，A 额度耗尽、B 密钥失效、C 超时"。
- Client 侧在 `conversation.input.model.label` slot 上显示当前会话实际使用的渠道（v2）。

### D12 密钥与"不可信上游"的处理

- 密钥只存凭证层，日志与错误信息里**永不回显**（`LlmFailure.message` 里禁止拼接 Authorization 头 / 上游原始请求体）。
- 上游响应体在映射错误时要做白名单提取（只取错误码 / `type` / `code` 字段），不要整段贴进 message —— 上游错误体可能包含回显的请求内容。

---

## 5. 数据模型（草案）

**channels**

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 稳定 id，如 `ch_01H...`，创建后不改 |
| `name` | string | 显示名 |
| `protocol` | enum | `openai-completions` / `openai-responses` / `anthropic-messages` / `gemini`（v1 只做前两个） |
| `baseURL` | string | 上游地址 |
| `apiKeyRef` | string | 凭证引用名，如 `CHANNEL_CH01_API_KEY` |
| `headers` | record | 附加头（可选，值里禁止放密钥，密钥一律走 apiKeyRef） |
| `enabled` | boolean | |
| `priority` | number | 越小越优先 |
| `weight` | number | 同优先级内相对权重 |
| `cooldown` | object | `{ quotaMs, errorBackoff: {initialMs, maxMs}, maxConsecutiveFailures }` |
| `budget` | object? | 本地软预算（可选，v2） |

**bindings**（渠道 ↔ 逻辑模型）

| 字段 | 说明 |
|---|---|
| `channelId` / `logicalModel` | 复合键 |
| `upstreamModel` | 上游真实模型 id |
| `paramOverrides` | `{ maxTokens?, temperature?, reasoningEffortMap?, systemPromptField?, ... }` |
| `contextWindow` / `maxTokens` | 覆盖值（可选，默认继承渠道目录） |
| `inputModalities` | 覆盖值（可选） |
| `enabled` | 单条绑定可单独停用 |

**channelState**

| 字段 | 说明 |
|---|---|
| `channelId` | |
| `state` | `healthy` / `cooling` / `invalid` / `disabled` |
| `reason` | 最近一次进入该状态的原因与失败码 |
| `until` | 冷却截止时间戳（0 = 直到手动恢复） |
| `consecutiveFailures` | |
| `lastOkAt` / `lastFailAt` | |

**callLog**（可选，环形保留 N 条）

`{ at, sessionId?, purpose?, logicalModel, attempts: [{ channelId, upstreamModel, code?, latencyMs, usage? }], finalCode, switched: boolean }`

---

## 6. 插件配置样例（`cordis.patch.yml`）

```yaml
- insert:
    - id: channel-relay
      name: 'dsh_multi_api'
      config:
        providerRoute: relay          # 模型选择器里的分组 id
        displayName:
          en: Channel Relay
          zh: 渠道中转
        defaultCooldownMs: 1800000    # 默认额度冷却 30 分钟
        sessionAffinity: true         # 会话粘性（保缓存）
        callLogRetention: 500
        retryPolicy:                  # 交给 dsh-llm-retry 的那部分
          mode: normal
          maxRetries: 2
          retryableCodes: [SERVER, TIMEOUT, TRANSPORT, EMPTY_RESPONSE]
```

渠道本体与密钥**不在这里**（在 storage domain 与凭证层）。

---

## 7. 请求流程

**正常路径**

```
agent -> ctx.llm.stream({provider:'relay', model:'gpt-5'})
  -> 我们的 adapter.stream()
    -> resolveModel('relay','gpt-5') 取能力描述（缓存）
    -> Router 生成候选序列 [chA, chB, chC]
    -> 试 chA：翻译 SSE -> 首块可见内容 = 过提交点 -> 一直透传到 finish stop
    -> 记 callLog：channel=chA, 未换渠道
```

**额度耗尽路径**

```
  -> 试 chA：上游 429 + insufficient_quota
    -> 未过提交点 -> 映射为 QUOTA -> chA 进 cooling(30min) -> 顺延候选
  -> 试 chB：200，正常产出
  -> 用户完全无感；callLog 记录"换了 1 次"
```

**全渠道失败路径**

```
  -> chA QUOTA、chB AUTH、chC TIMEOUT
    -> 无候选可用 -> finish{reason:'error', failure:{code:'QUOTA',
         message:'全部渠道不可用：A(余额不足) / B(密钥失效) / C(超时)'}}
  -> 失败码取"最有信息量的那个"（优先级 QUOTA/AUTH > SERVER > TIMEOUT/TRANSPORT），
     而不是简单取最后一个
```

**取消路径**

```
  -> signal 触发 -> 中断上游 fetch -> finish{reason:'aborted'}；不换渠道、不冷却
```

---

## 8. UI 规划

**v1（最小可用）**

- 渠道列表：名称 / 协议 / BaseURL / 状态徽章（健康 / 冷却至 hh:mm / 密钥失效 / 停用）/ 已绑定模型数 / 最近调用。
- 新增 / 编辑抽屉：协议、地址、密钥（写入即落凭证层）、优先级、权重、超时、冷却参数。
- 绑定编辑：逻辑模型列表（逻辑名 ↔ 上游名 ↔ 参数覆盖），支持"从上游拉取模型列表"（`/v1/models` 探测）。
- 行内动作：启用停用、重置冷却、测试（发一条最小请求验连通 + 验密钥）。
- 一键"全部重置冷却"。

**v2**

- 调用日志页（筛选：渠道 / 逻辑模型 / 结果码 / 时间）。
- 用量与估算费用（需要每渠道每模型的单价配置）。
- 模型标签 slot：composer 上显示"gpt-5 · chB"。
- 逻辑模型列表页（跨渠道汇总视图，一眼看出哪个模型有几个渠道在撑）。

UI 必须遵守 DSH 的界面纪律：用主题 token（`--dsw-alias-*`）、用宿主 slot、不自己 require 宿主 UI 包、复用宿主同类页面（插件管理页）的行样式。

---

## 9. 错误码映射表

| 上游信号 | 内部判定 | DSH 失败码 | 换渠道 | 渠道状态 |
|---|---|---|---|---|
| 402 / 403 + `insufficient_quota`、`quota exceeded`、`余额不足`、`超出配额` | 额度耗尽 | `QUOTA` | 是 | `cooling` |
| 429 + `insufficient_quota` 类文案 | 额度耗尽 | `QUOTA` | 是 | `cooling` |
| 429 + 限流文案 / 带 `Retry-After` | 限流 | `RATE_LIMIT` | 是（可配），并遵从 `providerRetryAfterMs` | `cooling`（短） |
| 401 / 403 + 无效密钥 | 凭证失效 | `AUTH` / `INVALID_CREDENTIAL` | 是 | `invalid`（不自动恢复） |
| 404 / `model not exist` / `does not exist` | 该渠道无此模型 | `UNKNOWN_MODEL` | 是 | 该 binding 标记不可用 |
| 5xx | 上游故障 | `SERVER`（或 `HTTP_<status>`） | 是 | 连续失败计数，够了才冷却 |
| 连接失败 / 超时 | 传输 | `TRANSPORT` / `TIMEOUT` | 是 | 同上 |
| 200 但空响应 | 空响应 | `EMPTY_RESPONSE` | 是（1 次） | 不冷却，交给 retry |
| 400 参数非法 | 请求问题 | `INVALID_REQUEST` | **否** | 不冷却 |
| 上下文超长 | 请求问题 | `CONTEXT_WINDOW_EXCEEDED` | **否** | 不冷却 |
| 用户取消 | 取消 | `aborted` | 否 | 不冷却 |

实现注意：DSH 明确要求**按码路由，不要按文案**。所以分类器的输入应当是"HTTP 状态 + 上游错误对象的 `type`/`code` 字段 + 少量文案兜底"，且要有单元测试覆盖各上游的常见回复形态。

---

## 10. 路线图

**阶段 0：可行性验证（半天，必须先做）**
三个待验证假设，任一不成立都要改方案：

1. 一个**从 profile 安装的 bundle** 能否注册 `LlmAdapter` 路由，并且它 `listModels` 返回的模型**确实出现在模型选择器里**（无需额外 settings 授权）。
   - 依据：`dsh-llm/README.md` 说"GUI 要求目录成员资格"，但没有明确"注册路由"是否足够，这是最大未知。
2. `ctx.credentials` / `ctx.storageDomain` 在 profile 安装的 bundle 里可用（不是只有内置包能用）。
3. 一个最小 OpenAI 兼容 SSE → `StreamChunk` 翻译能在真实会话里跑通一轮（含工具调用）。

**阶段 1：MVP（单渠道可用的中转）**
`providerInfo` + `listModels` + `resolveModel` + `stream`；OpenAI 兼容协议；渠道存 storage domain；密钥存凭证层；一个极简列表页（只能改地址/密钥/模型，能加能删）。目标：在 DSH 里选 `relay/gpt-5` 能真的跑起来。

**阶段 2：故障转移（本插件的灵魂）**
错误分类器 + 冷却状态机 + 候选生成 + 提交点 + 会话粘性 + 渠道日志。目标：把 A 渠道密钥改错，请求自动落到 B 渠道且用户无感。

**阶段 3：管理与可观测**
完整的渠道/绑定编辑页、测试按钮、状态徽章、调用日志页、从上游拉模型列表。

**阶段 4：可选增强**
Anthropic Messages / Responses 协议、本地软预算、余额主动探测、渠道并发限流、模型标签 slot、用量费用统计。

---

## 11. 风险与限制

1. **"一次 stream = 一次 provider 尝试"的张力**（§D3）。换渠道本质是重发请求，只是没落进会话日志。这会影响"会话日志可完整重建模型可见内容"的纯净度：日志能重建**内容**（重发用的请求与首次完全相同），但重建不了"发了几次"。→ 用插件自己的 callLog 补，且必须在插件文档里讲明。
2. **换渠道对会话日志隐形**：`provider` 永远是 `relay`。跨渠道切换还可能让上游的思考签名 / 缓存失效（不同厂商的 signed thinking 互相不认）。
   - 对策：`ReplayEnvelope` 内部记 `channelId` + `upstreamModel`，只有**同一渠道**才复用，跨渠道一律降级成中性的 text/tool-call，丢弃签名与 reasoning。
3. **跨渠道上下文档位不一致**：按最小值取（§D7），代价是"小窗口渠道"会拉低整个逻辑模型的能力上限。→ 允许用户在逻辑模型上显式声明 contextWindow 覆盖。
4. **额度判定只能靠报错**：上游通常不告诉你"还剩多少"。→ 主动探测是 v2 可选项，本地软预算是唯一可靠手段。
5. **单进程限制**：`domain/changed` 是进程内事件；两个 DSH 实例不会共享渠道状态。桌面版是单进程，可接受。
6. **上游协议差异无穷**：OpenAI 兼容阵营有大量方言（thinking 字段、`max_completion_tokens`、`reasoning_effort` 取值）。→ v1 只认最保守的子集，方言靠 `paramOverrides`/`compat` 开关兜。
7. **图片与文件**：DSH 的图片会按路由能力投射，文件一律变成"路径句柄文本"。我们没有图片能力时就别声明 `image` 模态，交给 DSH 自动降级成占位文本。
8. **DSH 升级**：插件依赖的是公开 seam（`ctx.llm` / `ctx.credentials` / `ctx.storageDomain`），升级风险可控，但 `LlmAdapter` 的具体形状、`StreamChunk` 协议、`LlmFailure` 码表都要在升级后重新核对。

---

## 12. 待你拍板的问题

1. **上游协议范围**：v1 只做 OpenAI 兼容（覆盖绝大多数中转/聚合站），还是同时要 Anthropic Messages？
2. **配置落点**：接受"渠道表放 storage domain + 自建管理页（热更新）"，还是想先用"塞进插件 Config（改一次重启一次插件）"的极简版抢先跑起来？
3. **额度控制口径**：只要"报错后熔断"，还是需要"本地软预算（按钱/按 token）"？
4. **是否要 key 池**：同一个渠道挂多个 key 轮询（这是 new-api 常见诉求），要不要进 v1？
5. **路由分组**：只要一个 `relay` 分组，还是需要多个分组（如 `relay-fast` / `relay-cheap`）让用户能按会话挑池子？
6. **用量与费用**：要不要统计和估算费用（需要你配置每渠道每模型的单价）？
7. **形态确认**：确认是"DSH 内部插件"而不是"对外提供 OpenAI 兼容端点的独立服务"（后者是另一个项目）。

---

## 13. 怎么验证它能用

1. **阶段 0 三个假设**：能注册路由且模型出现在选择器；bundle 能访问 credentials/storage；一次真实会话跑通（含工具调用）。
2. **功能验收**：配两条指向同一个逻辑模型的渠道 → 把 A 的密钥改错 → 发请求 → 观察自动落到 B，且界面上 A 变 `invalid`、日志显示"换了 1 次"。
3. **额度验收**：用返回 `insufficient_quota` 的假上游（本地 mock）+ 一个真渠道，验证熔断、冷却倒计时、重置后恢复。
4. **不变量验收**：会话日志里 provider 恒为 `relay`；取消请求不触发换渠道；已产出内容后失败不换渠道；插件卸载后路由随之注销、`relay` 分组消失、会话无残留状态。
