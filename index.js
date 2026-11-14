/**
 * dsh_multi_api — Host half.
 *
 * Registers an OpenAI-compatible LLM adapter under one provider route and
 * spreads each logical model across any number of upstream channels. A model
 * call walks the configured channels in priority order and transparently
 * switches to the next channel when the current one rejects the call before
 * any content reaches the conversation.
 *
 * Persistent data lives in one storage domain; API keys live in the credential
 * service under `dsh-channel-relay/<channel-id>`.
 */

const PROVIDER_ROUTE = 'relay'
const PROVIDER_NAME = 'Channel relay'
// Persisted identifiers: the domain name and the credential scope stay as they
// were before the package rename, so an existing install keeps its channels and keys.
const DOMAIN_NAME = 'channel_relay'
const CRED_SCOPE = 'dsh-channel-relay'

const DEFAULT_TIMEOUT_MS = 120_000
const QUOTA_COOLDOWN_MS = 30 * 60_000
const AUTH_COOLDOWN_MS = 12 * 60 * 60_000
const SHORT_COOLDOWN_MS = 45_000
const MAX_COOLDOWN_MS = 10 * 60_000
const BINDING_COOLDOWN_MS = 5 * 60_000
const LOG_LIMIT = 200

const REASONING_EFFORTS = Object.freeze([
	{ id: 'off', name: 'Off' },
	{ id: 'low', name: 'Low' },
	{ id: 'medium', name: 'Medium' },
	{ id: 'high', name: 'High' },
])

const RELAY_INJECT = ['llm', 'credentials', 'connection', 'storageDomain']

/** Schemaless value acceptance: records are validated by this plugin, not by the domain. */
const anyRecord = { parse: (value) => value }

const DOMAIN_SPEC = {
	name: DOMAIN_NAME,
	version: 1,
	layout: 'per-record',
	invalidRecords: 'backup-and-skip',
	tables: {
		channels: { valueSchema: anyRecord },
		bindings: { valueSchema: anyRecord },
		channel_state: { valueSchema: anyRecord },
		call_log: { valueSchema: anyRecord },
	},
}

//#region helpers

function nowMs() {
	return Date.now()
}

const ID_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'

function randomSuffix(length = 8) {
	let out = ''
	for (let i = 0; i < length; i += 1) {
		out += ID_ALPHABET[Math.floor(Math.random() * ID_ALPHABET.length)]
	}
	return out
}

/** Channel ids double as credential-key segments, so they stay lowercase-hyphenated. */
function newChannelId() {
	return `ch-${randomSuffix(10)}`
}

function newRecordId(prefix) {
	return `${prefix}-${nowMs().toString(36)}-${randomSuffix(6)}`
}

function text(value, fallback = '') {
	return typeof value === 'string' ? value : fallback
}

function trimmed(value) {
	return typeof value === 'string' ? value.trim() : ''
}

function positiveInt(value, fallback) {
	return Number.isSafeInteger(value) && value > 0 ? value : fallback
}

function nonNegativeInt(value, fallback) {
	return Number.isSafeInteger(value) && value >= 0 ? value : fallback
}

function booleanOr(value, fallback) {
	return typeof value === 'boolean' ? value : fallback
}

/** Smallest declared value; `undefined` when nothing declares one. */
function minDefined(values) {
	let out
	for (const value of values) {
		if (value === undefined) continue
		if (out === undefined || value < out) out = value
	}
	return out
}

/** Build an Error the LLM runtime accepts as a precise provider failure. */
function relayFailure(message, code, extra = {}) {
	const error = new Error(message)
	error.name = 'ChannelRelayError'
	error.code = code
	const failure = { message, code }
	if (Number.isInteger(extra.status) && extra.status >= 100 && extra.status <= 599) failure.status = extra.status
	if (Number.isFinite(extra.retryAfterMs) && extra.retryAfterMs > 0) failure.providerRetryAfterMs = extra.retryAfterMs
	error.failure = failure
	if (extra.detail !== undefined) error.detail = extra.detail
	return error
}

function joinUrl(baseUrl, path) {
	const base = trimmed(baseUrl).replace(/\/+$/, '')
	if (base === '') return ''
	if (base.endsWith(path)) return base
	return `${base}${path}`
}

/** Strip anything key-shaped from a message before it can reach a session log. */
function redact(value) {
	return text(value)
		.replace(/\b(sk|rk|pk)-[A-Za-z0-9_-]{6,}/g, '$1-***')
		.replace(/\bBearer\s+[A-Za-z0-9._-]{6,}/gi, 'Bearer ***')
}

function shortMessage(value, limit = 300) {
	const cleaned = redact(value).replace(/\s+/g, ' ').trim()
	return cleaned.length > limit ? `${cleaned.slice(0, limit)}…` : cleaned
}

/** Pull a human-readable detail out of an OpenAI-shaped error body. */
function errorDetail(bodyText) {
	const raw = text(bodyText)
	if (raw === '') return ''
	try {
		const parsed = JSON.parse(raw)
		const error = parsed?.error ?? parsed
		const message = error?.message ?? error?.detail ?? parsed?.message
		if (typeof message === 'string' && message !== '') return shortMessage(message)
		if (typeof error === 'string') return shortMessage(error)
	} catch {
		// Not JSON: fall back to the raw prefix.
	}
	return shortMessage(raw)
}

function parseRetryAfter(value) {
	if (typeof value !== 'string' || value.trim() === '') return undefined
	const seconds = Number(value)
	if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds * 1000, MAX_COOLDOWN_MS)
	const at = Date.parse(value)
	if (Number.isFinite(at)) {
		const delta = at - nowMs()
		if (delta > 0) return Math.min(delta, MAX_COOLDOWN_MS)
	}
	return undefined
}

//#endregion

//#region storage

function memoryStore() {
	const tables = new Map()
	const tableOf = (name) => {
		let table = tables.get(name)
		if (table === undefined) {
			table = new Map()
			tables.set(name, table)
		}
		return table
	}
	return {
		persistent: false,
		list: (name) => [...tableOf(name).values()],
		get: (name, key) => tableOf(name).get(key),
		async put(name, key, value) {
			tableOf(name).set(key, value)
		},
		async remove(name, key) {
			tableOf(name).delete(key)
		},
	}
}

function domainStore(domain) {
	const table = (name) => domain.table(name)
	return {
		persistent: true,
		list: (name) => [...table(name).entries()].map(([, value]) => value),
		get: (name, key) => table(name).get(key),
		put: (name, key, value) => table(name).put(key, value),
		remove: (name, key) => table(name).delete(key),
		close: () => domain.close(),
	}
}

async function openStore(ctx) {
	const facility = ctx.get('storageDomain')
	let reason = 'storageDomain service is not mounted'
	if (facility !== undefined && typeof facility.open === 'function') {
		try {
			const domain = await facility.open(DOMAIN_SPEC)
			ctx.effect(() => () => {
				domain.close().catch(() => {})
			}, 'dsh_multi_api: close storage domain')
			return domainStore(domain)
		} catch (error) {
			reason = `${error?.code === undefined ? '' : `${error.code}: `}${shortMessage(error?.message ?? String(error))}`
			ctx.logger?.warn?.(`dsh_multi_api: persistent storage unavailable (${reason}); using in-memory storage for this session`)
		}
	}
	const store = memoryStore()
	store.reason = reason
	return store
}

//#endregion

//#region classification

/** Codes the runtime, the cooldown table, and the UI all understand. */
function classifyHttpFailure(status, detail, retryAfterMs) {
	const lower = detail.toLowerCase()
	if (status === 401 || status === 403) {
		return { code: 'INVALID_CREDENTIAL', kind: 'auth', status, message: detail || `HTTP ${status}` }
	}
	if (status === 402) {
		return { code: 'QUOTA', kind: 'quota', status, message: detail || 'HTTP 402' }
	}
	if (status === 429) {
		const quota = /quota|balance|credit|billing|insufficient/.test(lower)
		return {
			code: quota ? 'QUOTA' : 'RATE_LIMIT',
			kind: quota ? 'quota' : 'rate',
			status,
			message: detail || 'HTTP 429',
			retryAfterMs,
		}
	}
	if (status === 408 || status === 504 || status === 524) {
		return { code: 'TIMEOUT', kind: 'transient', status, message: detail || `HTTP ${status}` }
	}
	if (status === 404) {
		return { code: 'MODEL_UNSUPPORTED', kind: 'binding', status, message: detail || 'HTTP 404' }
	}
	if (status === 400 || status === 422) {
		if (/quota|balance|credit|billing|insufficient/.test(lower)) {
			return { code: 'QUOTA', kind: 'quota', status, message: detail || `HTTP ${status}` }
		}
		if (/context|too long|too many tokens|maximum.*token/.test(lower)) {
			return { code: 'CONTEXT_WINDOW_EXCEEDED', kind: 'binding', status, message: detail || `HTTP ${status}` }
		}
		if (/model/.test(lower) && /not (found|exist|support|available)|unknown/.test(lower)) {
			return { code: 'MODEL_UNSUPPORTED', kind: 'binding', status, message: detail || `HTTP ${status}` }
		}
		return { code: 'INVALID_REQUEST', kind: 'binding', status, message: detail || `HTTP ${status}` }
	}
	if (status >= 500) {
		return { code: 'SERVER', kind: 'transient', status, message: detail || `HTTP ${status}` }
	}
	return { code: 'UNKNOWN', kind: 'transient', status, message: detail || `HTTP ${status}` }
}

function classifyThrown(error, signal) {
	if (signal?.aborted) {
		return { code: 'ABORTED', kind: 'abort', message: 'request aborted', error }
	}
	if (error?.relay === true) return error.descriptor ?? { code: error.code ?? 'UNKNOWN', kind: 'transient', message: error.message }
	if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
		return { code: 'TIMEOUT', kind: 'transient', message: 'upstream request timed out' }
	}
	const code = typeof error?.cause?.code === 'string' ? error.cause.code : ''
	if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|EPIPE|EHOSTUNREACH|ENETUNREACH|CERT|SSL/i.test(code || text(error?.message))) {
		return { code: 'TRANSPORT', kind: 'transient', message: `network failure${code === '' ? '' : ` (${code})`}` }
	}
	return { code: 'TRANSPORT', kind: 'transient', message: shortMessage(error?.message ?? String(error)) || 'request failed' }
}

function cooldownFor(descriptor, failures) {
	switch (descriptor.kind) {
		case 'auth':
			return { status: 'invalid', until: nowMs() + AUTH_COOLDOWN_MS }
		case 'quota':
			return { status: 'cooldown', until: nowMs() + QUOTA_COOLDOWN_MS }
		case 'rate':
			return { status: 'cooldown', until: nowMs() + (descriptor.retryAfterMs ?? SHORT_COOLDOWN_MS) }
		case 'binding':
			return { status: 'model', until: nowMs() + BINDING_COOLDOWN_MS }
		case 'abort':
			return undefined
		default: {
			const backoff = Math.min(SHORT_COOLDOWN_MS * 2 ** Math.max(0, failures - 1), MAX_COOLDOWN_MS)
			return { status: 'cooldown', until: nowMs() + backoff }
		}
	}
}

//#endregion

//#region request serialization

function contentText(blocks) {
	if (!Array.isArray(blocks)) return ''
	const parts = []
	for (const block of blocks) {
		if (block?.type === 'text' && typeof block.text === 'string') parts.push(block.text)
	}
	return parts.join('')
}

function buildTools(tools) {
	if (!Array.isArray(tools) || tools.length === 0) return undefined
	const out = []
	for (const tool of tools) {
		if (typeof tool?.name !== 'string' || tool.name === '') continue
		out.push({
			type: 'function',
			function: {
				name: tool.name,
				description: typeof tool.description === 'string' ? tool.description : '',
				parameters: tool.parameters ?? { type: 'object', properties: {} },
			},
		})
	}
	return out.length === 0 ? undefined : out
}

function serializeMessages(ctx, options) {
	const messages = []
	const system = typeof options.system === 'string' ? options.system.trim() : ''
	if (system !== '') messages.push({ role: 'system', content: system })

	for (const message of options.messages ?? []) {
		const role = message?.role
		if (role === 'system' || role === 'developer') {
			const value = contentText(message.content).trim()
			if (value !== '') messages.push({ role: 'system', content: value })
			continue
		}
		if (role === 'user') {
			const parts = []
			for (const block of message.content ?? []) {
				if (block?.type === 'text') {
					if (block.text !== '') parts.push({ type: 'text', text: block.text })
					continue
				}
				if (block?.type === 'file') {
					const handle = typeof ctx.llm?.fileRequestText === 'function' ? ctx.llm.fileRequestText(block.attachment) : `[file: ${block.attachment?.name ?? 'attachment'}]`
					parts.push({ type: 'text', text: handle })
					continue
				}
				if (block?.type === 'image') {
					throw relayFailure('This relay channel only routes text; the request contains an image. Remove the image or route the session to a vision-capable provider.', 'UNSUPPORTED_CONTENT')
				}
			}
			if (parts.length === 0) continue
			messages.push({ role: 'user', content: parts.length === 1 && parts[0].type === 'text' ? parts[0].text : parts })
			continue
		}
		if (role === 'assistant') {
			const content = contentText(message.content)
			const toolCalls = []
			for (const block of message.content ?? []) {
				if (block?.type !== 'tool-call') continue
				toolCalls.push({
					id: typeof block.id === 'string' && block.id !== '' ? block.id : `call-${toolCalls.length}`,
					type: 'function',
					function: {
						name: block.name ?? '',
						arguments: typeof block.arguments === 'string' && block.arguments !== '' ? block.arguments : '{}',
					},
				})
			}
			const entry = { role: 'assistant', content }
			if (toolCalls.length > 0) entry.tool_calls = toolCalls
			if (content === '' && toolCalls.length === 0) continue
			messages.push(entry)
			continue
		}
		if (role === 'tool') {
			const content = contentText(message.content)
			messages.push({
				role: 'tool',
				tool_call_id: typeof message.toolCallId === 'string' ? message.toolCallId : '',
				content: content === '' ? '(no output)' : content,
			})
		}
	}
	return messages
}

function buildRequestBody(ctx, route, options) {
	const body = {
		model: route.binding.upstreamModel,
		messages: serializeMessages(ctx, options),
		stream: true,
	}
	if (typeof options.temperature === 'number' && Number.isFinite(options.temperature)) body.temperature = options.temperature
	if (Number.isSafeInteger(options.maxTokens) && options.maxTokens > 0) body.max_tokens = options.maxTokens
	if (Array.isArray(options.stop) && options.stop.length > 0) body.stop = options.stop
	const tools = buildTools(options.tools)
	if (tools !== undefined) {
		body.tools = tools
		body.tool_choice = 'auto'
	}
	const effort = options.reasoningEffort
	if (route.binding.reasoning === true && typeof effort === 'string' && ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(effort)) {
		body.reasoning_effort = effort
	}
	return body
}

//#endregion

//#region SSE reader

/**
 * Yield one SSE `data:` payload string at a time.
 * @param body - response body stream.
 */
async function* ssePayloads(body) {
	if (body === null || typeof body?.getReader !== 'function') return
	const reader = body.getReader()
	const decoder = new TextDecoder()
	let buffer = ''
	try {
		for (;;) {
			const { value, done } = await reader.read()
			if (done) break
			buffer += decoder.decode(value, { stream: true })
			let index = buffer.indexOf('\n')
			while (index >= 0) {
				const line = buffer.slice(0, index).trim()
				buffer = buffer.slice(index + 1)
				if (line.startsWith('data:')) yield line.slice(5).trim()
				index = buffer.indexOf('\n')
			}
		}
		buffer += decoder.decode()
		const tail = buffer.trim()
		if (tail.startsWith('data:')) yield tail.slice(5).trim()
	} finally {
		try {
			reader.releaseLock()
		} catch {
			// The stream may already be released by cancellation.
		}
	}
}

function mapFinishReason(reason) {
	switch (reason) {
		case 'tool_calls':
		case 'function_call':
			return { kind: 'tool-calls' }
		case 'length':
		case 'max_tokens':
			return { kind: 'max-tokens' }
		default:
			return reason === undefined || reason === null || reason === 'stop' || reason === 'end_turn'
				? { kind: 'stop' }
				: { kind: 'stop', raw: String(reason) }
	}
}

function usageFrom(value) {
	if (value === null || typeof value !== 'object') return undefined
	const prompt = nonNegativeInt(value.prompt_tokens ?? value.input_tokens, undefined)
	const completion = nonNegativeInt(value.completion_tokens ?? value.output_tokens, undefined)
	if (prompt === undefined && completion === undefined) return undefined
	// TokenUsage counts are disjoint: inputTokens excludes the cached part that
	// cacheReadTokens reports separately, or the sum would bill it twice.
	const cacheRead = nonNegativeInt(value.cache_read_input_tokens ?? value.prompt_tokens_details?.cached_tokens, undefined)
	const usage = {
		inputTokens: cacheRead === undefined ? prompt ?? 0 : Math.max(0, (prompt ?? 0) - cacheRead),
		outputTokens: completion ?? 0,
	}
	const total = nonNegativeInt(value.total_tokens, undefined)
	usage.totalTokens = total ?? (prompt ?? 0) + usage.outputTokens
	if (cacheRead !== undefined) usage.cacheReadTokens = cacheRead
	const reasoning = nonNegativeInt(value.completion_tokens_details?.reasoning_tokens, undefined)
	if (reasoning !== undefined) usage.reasoningTokens = reasoning
	return usage
}

//#endregion

//#region adapter

class RelayAdapter {
	constructor(ctx, store, state) {
		this.ctx = ctx
		this.store = store
		this.state = state
	}

	providerInfo(provider) {
		return { id: provider, name: PROVIDER_NAME }
	}

	providerRetryPolicy() {
		// Channel-level failover is this adapter's own job; the runtime must not
		// repeat a request that already tried every channel.
		return undefined
	}

	/** Enabled channels joined with enabled bindings, best route first. */
	routes(model) {
		const channels = new Map()
		for (const channel of this.store.list('channels')) {
			if (channel.enabled === false) continue
			channels.set(channel.id, channel)
		}
		const routes = []
		for (const binding of this.store.list('bindings')) {
			if (binding.enabled === false) continue
			if (model !== undefined && binding.model !== model) continue
			const channel = channels.get(binding.channelId)
			if (channel === undefined) continue
			routes.push({ binding, channel })
		}
		routes.sort((a, b) => {
			const priority = nonNegativeInt(a.channel.priority, 100) - nonNegativeInt(b.channel.priority, 100)
			if (priority !== 0) return priority
			const weight = nonNegativeInt(b.channel.weight, 0) - nonNegativeInt(a.channel.weight, 0)
			if (weight !== 0) return weight
			return text(a.channel.name).localeCompare(text(b.channel.name))
		})
		return routes
	}

	modelIds() {
		const seen = []
		for (const route of this.routes()) {
			if (!seen.includes(route.binding.model)) seen.push(route.binding.model)
		}
		return seen
	}

	async listModels(provider) {
		const models = []
		for (const model of this.modelIds()) {
			const route = this.routes(model)[0]
			if (route === undefined) continue
			const channels = this.routes(model).map((entry) => text(entry.channel.name))
			// The picker already groups by provider, so a single channel needs no
			// badge; the channel count is the useful signal for a failover pool.
			const entry = {
				provider,
				id: model,
				name: text(route.binding.name) === '' ? model : text(route.binding.name),
				description: channels.length > 1 ? `${channels.join(' → ')}` : channels[0],
				inputModalities: ['text'],
			}
			// A language-neutral count keeps the badge readable in every locale.
			if (channels.length > 1) entry.badge = { text: `×${channels.length}`, tone: 'info' }
			models.push(entry)
		}
		return models
	}

	async resolveModel(provider, model) {
		const routes = this.routes(model)
		const route = routes[0]
		if (route === undefined) {
			throw relayFailure(`No enabled channel serves model "${model}". Add a channel and bind this model in Channel relay.`, 'UNKNOWN_MODEL')
		}
		const info = {
			provider,
			id: model,
			name: text(route.binding.name) === '' ? model : text(route.binding.name),
			description: `via ${text(route.channel.name)} (${route.binding.upstreamModel})`,
			inputModalities: ['text'],
		}
		// Capacities are shared by every channel in the pool, so each one is the
		// most conservative value: a plan sized for the widest channel would
		// randomly fail over to a narrower one.
		const contextWindow = minDefined(routes.map((entry) => positiveInt(entry.binding.contextWindow ?? entry.channel.contextWindow, undefined)))
		if (contextWindow !== undefined) info.context = { contextWindow }
		const maxTokens = minDefined(routes.map((entry) => positiveInt(entry.binding.maxTokens ?? entry.channel.maxTokens, undefined)))
		if (maxTokens !== undefined) info.defaultMaxTokens = maxTokens
		// Advertise efforts only when the whole pool honours them; a channel that
		// ignores `reasoning_effort` would answer without the requested depth.
		if (routes.every((entry) => entry.binding.reasoning === true)) {
			info.reasoning = { efforts: REASONING_EFFORTS.map((effort) => ({ ...effort })), defaultEffort: 'medium' }
		}
		return info
	}

	async prepareCall(provider, model, signal) {
		if (signal?.aborted) throw relayFailure('request aborted', 'ABORTED')
		const info = await this.resolveModel(provider, model)
		return {
			model: info,
			stream: (options) => this.stream(options),
		}
	}

	async *stream(options) {
		const routes = this.routes(options.model)
		if (routes.length === 0) {
			throw relayFailure(`No enabled channel serves model "${options.model}".`, 'UNKNOWN_MODEL')
		}
		const started = nowMs()
		const usable = []
		const cooled = []
		for (const route of routes) {
			const blocked = this.blockedReason(route)
			if (blocked === undefined) usable.push(route)
			else cooled.push({ route, blocked })
		}
		// Every candidate cooling down still beats failing outright: try them in order.
		const order = [...usable, ...cooled.map((entry) => entry.route)]
		const attempts = []
		for (const route of order) {
			const attempt = { channelId: route.channel.id, channelName: text(route.channel.name), model: route.binding.upstreamModel, startedAt: nowMs() }
			attempts.push(attempt)
			let committed = false
			try {
				for await (const chunk of this.attemptStream(route, options)) {
					if (!committed && isVisibleChunk(chunk)) committed = true
					yield chunk
				}
				attempt.ok = true
				attempt.ms = nowMs() - attempt.startedAt
				await this.recordSuccess(route)
				await this.appendLog({
					model: options.model,
					outcome: attempts.length > 1 ? 'failover' : 'success',
					attempts,
					durationMs: nowMs() - started,
				})
				return
			} catch (error) {
				attempt.ms = nowMs() - attempt.startedAt
				const descriptor = classifyThrown(error, options.signal)
				attempt.code = descriptor.code
				attempt.status = descriptor.status
				attempt.message = shortMessage(descriptor.message)
				if (descriptor.kind === 'abort') {
					await this.appendLog({
						model: options.model,
						outcome: 'failed',
						attempts,
						durationMs: nowMs() - started,
					})
					throw error?.relay === true ? error : relayFailure('request aborted', 'ABORTED')
				}
				await this.recordFailure(route, descriptor)
				if (committed) {
					// Content already reached the conversation; switching now would
					// splice two different answers together.
					await this.appendLog({
						model: options.model,
						outcome: 'failed',
						attempts,
						durationMs: nowMs() - started,
					})
					throw relayFailure(
						`${text(route.channel.name)} failed after streaming started: ${shortMessage(descriptor.message)}`,
						descriptor.code,
						{ status: descriptor.status, detail: attempts },
					)
				}
			}
		}
		await this.appendLog({
			model: options.model,
			outcome: 'failed',
			attempts,
			durationMs: nowMs() - started,
		})
		throw this.aggregateFailure(options.model, attempts)
	}

	aggregateFailure(model, attempts) {
		const first = attempts.find((attempt) => attempt.code !== undefined) ?? {}
		const summary = attempts
			.map((attempt) => `${attempt.channelName || attempt.channelId}: ${attempt.code ?? 'unknown'}${attempt.status === undefined ? '' : ` ${attempt.status}`} — ${attempt.message ?? ''}`)
			.join('; ')
		const code = ['INVALID_CREDENTIAL', 'QUOTA', 'RATE_LIMIT', 'SERVER', 'TIMEOUT', 'TRANSPORT', 'MODEL_UNSUPPORTED', 'INVALID_REQUEST'].includes(first.code)
			? first.code
			: 'UNKNOWN'
		return relayFailure(
			`All ${attempts.length} channel(s) failed for model "${model}": ${summary}`,
			code,
			{ status: first.status, detail: attempts },
		)
	}

	blockedReason(route) {
		const state = this.store.get('channel_state', route.channel.id)
		if (state !== undefined && (state.status === 'cooldown' || state.status === 'invalid' || state.status === 'model')) {
			if (typeof state.until === 'number' && state.until > nowMs()) return state
		}
		const bindingUntil = this.state.bindingCooldown.get(route.binding.id)
		if (bindingUntil !== undefined) {
			if (bindingUntil > nowMs()) return { status: 'model', until: bindingUntil }
			this.state.bindingCooldown.delete(route.binding.id)
		}
		return undefined
	}

	async recordSuccess(route) {
		const previous = this.store.get('channel_state', route.channel.id)
		if (previous !== undefined && previous.status === 'ok') return
		await this.store.put('channel_state', route.channel.id, {
			channelId: route.channel.id,
			status: 'ok',
			failures: 0,
			updatedAt: nowMs(),
		})
	}

	async recordFailure(route, descriptor) {
		const previous = this.store.get('channel_state', route.channel.id) ?? {}
		const failures = nonNegativeInt(previous.failures, 0) + 1
		if (descriptor.kind === 'binding') {
			this.state.bindingCooldown.set(route.binding.id, nowMs() + BINDING_COOLDOWN_MS)
		}
		const cooldown = cooldownFor(descriptor, failures)
		if (cooldown === undefined) return
		const next = {
			channelId: route.channel.id,
			status: cooldown.status,
			until: cooldown.until,
			failures,
			code: descriptor.code,
			statusCode: descriptor.status,
			message: shortMessage(descriptor.message, 200),
			updatedAt: nowMs(),
		}
		await this.store.put('channel_state', route.channel.id, next)
		this.state.bindingCooldown.delete(route.binding.id)
	}

	async appendLog(entry) {
		const id = `${String(nowMs()).padStart(14, '0')}-${randomSuffix(4)}`
		await this.store.put('call_log', id, {
			id,
			time: nowMs(),
			model: entry.model,
			outcome: entry.outcome,
			durationMs: entry.durationMs,
			attempts: entry.attempts.map((attempt) => ({
				channelId: attempt.channelId,
				channelName: attempt.channelName,
				model: attempt.model,
				ms: attempt.ms,
				ok: attempt.ok === true,
				code: attempt.code,
				status: attempt.status,
				message: attempt.message,
			})),
		})
		this.state.logWrites += 1
		if (this.state.logWrites % 15 === 0) await this.pruneLog()
	}

	async pruneLog() {
		const keys = this.store
			.list('call_log')
			.map((entry) => entry.id)
			.sort()
		const excess = keys.length - LOG_LIMIT
		for (let i = 0; i < excess; i += 1) await this.store.remove('call_log', keys[i])
	}

	/**
	 * Stream one attempt against exactly one channel.
	 * Throws before yielding anything when the channel rejects the call.
	 */
	async *attemptStream(route, options) {
		const apiKey = await this.apiKey(route.channel.id)
		if (apiKey === undefined) {
			throw deviceFailure(`Channel "${text(route.channel.name)}" has no API key configured`, 'MISSING_CREDENTIAL', 'auth')
		}
		const url = joinUrl(route.channel.baseUrl, '/chat/completions')
		if (url === '') throw deviceFailure(`Channel "${text(route.channel.name)}" has no base URL`, 'INVALID_CREDENTIAL', 'auth')

		let includeUsage = route.channel.includeUsage !== false
		let response = await this.request(url, apiKey, route, options, includeUsage)
		if (!response.ok) {
			let bodyText = await safeText(response)
			if (includeUsage && response.status === 400 && /stream_options|unknown|unrecognized|unsupported|invalid/i.test(bodyText)) {
				// Learn this endpoint's limits instead of retrying the same body forever.
				includeUsage = false
				await this.rememberNoUsage(route.channel)
				response = await this.request(url, apiKey, route, options, false)
				if (!response.ok) bodyText = await safeText(response)
			}
			if (!response.ok) {
				throw descriptorFailure(classifyHttpFailure(response.status, errorDetail(bodyText), parseRetryAfter(response.headers?.get?.('retry-after'))))
			}
		}

		const contentType = text(response.headers?.get?.('content-type'))
		if (contentType !== '' && !contentType.includes('event-stream')) {
			// The endpoint answered without SSE: it either ignored `stream` or
			// rejected the request in JSON.
			const bodyText = await safeText(response)
			let parsed
			try {
				parsed = JSON.parse(bodyText)
			} catch {
				parsed = undefined
			}
			if (parsed?.error !== undefined) {
				const detail = errorDetail(bodyText)
				throw descriptorFailure(classifyHttpFailure(400, detail))
			}
			const message = parsed?.choices?.[0]?.message
			if (message !== undefined) {
				yield* this.emitWholeMessage(message)
				yield this.finishChunk(parsed)
				return
			}
			throw descriptorFailure({ code: 'MALFORMED_RESPONSE', kind: 'binding', message: 'channel answered without a streaming event stream' })
		}

		let blockIndex = 0
		let textIndex
		let reasoningIndex
		const openBlocks = new Map()
		const toolBlocks = new Map()
		let usage
		let finishReason
		let sawAnything = false

		const ensureBlock = (key, blockType) => {
			const existing = openBlocks.get(key)
			if (existing !== undefined) return existing
			const entry = { index: blockIndex, blockType, text: '', name: '', id: '' }
			blockIndex += 1
			openBlocks.set(key, entry)
			return entry
		}

		for await (const payload of ssePayloads(response.body)) {
			if (payload === '[DONE]') break
			if (payload === '') continue
			let parsed
			try {
				parsed = JSON.parse(payload)
			} catch {
				continue
			}
			if (parsed?.error !== undefined) {
				const detail = errorDetail(payload)
				const retryAfter = parsed?.error?.retry_after
				const descriptor = classifyHttpFailure(
					nonNegativeInt(parsed?.error?.status ?? parsed?.error?.code_number, 400),
					detail,
					Number.isFinite(retryAfter) ? retryAfter * 1000 : undefined,
				)
				if (!sawAnything) throw descriptorFailure(descriptor)
				throw descriptorFailure({ ...descriptor, code: descriptor.code })
			}
			const chunkUsage = usageFrom(parsed?.usage)
			if (chunkUsage !== undefined) usage = chunkUsage
			const choice = Array.isArray(parsed?.choices) ? parsed.choices[0] : undefined
			if (choice === undefined) continue
			const delta = choice.delta ?? choice.message ?? {}
			const reasoningDelta = typeof delta.reasoning_content === 'string' ? delta.reasoning_content : typeof delta.reasoning === 'string' ? delta.reasoning : ''
			if (reasoningDelta !== '') {
				const block = ensureBlock('reasoning', 'reasoning')
				if (block.text === '') yield { type: 'block-start', index: block.index, blockType: 'reasoning' }
				block.text += reasoningDelta
				sawAnything = true
				yield { type: 'reasoning-delta', index: block.index, text: reasoningDelta }
			}
			const contentDelta = typeof delta.content === 'string' ? delta.content : ''
			if (contentDelta !== '') {
				const block = ensureBlock('text', 'text')
				if (block.text === '') yield { type: 'block-start', index: block.index, blockType: 'text' }
				block.text += contentDelta
				sawAnything = true
				yield { type: 'text-delta', index: block.index, text: contentDelta }
			}
			if (Array.isArray(delta.tool_calls)) {
				for (const call of delta.tool_calls) {
					const key = `tool-${nonNegativeInt(call?.index, toolBlocks.size)}`
					let tool = toolBlocks.get(key)
					if (tool === undefined) {
						tool = ensureBlock(key, 'tool-call')
						toolBlocks.set(key, tool)
						tool.id = typeof call?.id === 'string' && call.id !== '' ? call.id : `call-${tool.index}`
						yield { type: 'block-start', index: tool.index, blockType: 'tool-call' }
					}
					if (typeof call?.id === 'string' && call.id !== '') tool.id = call.id
					if (typeof call?.function?.name === 'string' && call.function.name !== '') tool.name = call.function.name
					const argumentsDelta = typeof call?.function?.arguments === 'string' ? call.function.arguments : ''
					tool.text += argumentsDelta
					sawAnything = true
					yield {
						type: 'tool-call-delta',
						index: tool.index,
						id: tool.id,
						name: tool.name === '' ? undefined : tool.name,
						argumentsDelta,
					}
				}
			}
			if (choice.finish_reason !== undefined && choice.finish_reason !== null) finishReason = choice.finish_reason
		}

		const reason = mapFinishReason(finishReason)
		for (const block of openBlocks.values()) {
			if (block.blockType === 'text') {
				yield { type: 'block-end', index: block.index, block: { type: 'text', text: block.text } }
			} else if (block.blockType === 'reasoning') {
				yield { type: 'block-end', index: block.index, block: { type: 'reasoning', text: block.text } }
			} else {
				yield {
					type: 'block-end',
					index: block.index,
					block: {
						type: 'tool-call',
						id: block.id === '' ? `call-${block.index}` : block.id,
						name: block.name,
						arguments: normalizeArguments(block.text, reason),
					},
				}
			}
		}
		if (!sawAnything && openBlocks.size === 0) {
			throw descriptorFailure({ code: 'EMPTY_RESPONSE', kind: 'transient', message: 'channel returned an empty stream' })
		}
		if (usage !== undefined) yield { type: 'usage', usage }
		yield { type: 'finish', reason }
	}

	async *emitWholeMessage(message) {
		const reasoning = typeof message.reasoning_content === 'string' ? message.reasoning_content : ''
		const content = typeof message.content === 'string' ? message.content : ''
		let index = 0
		if (reasoning !== '') {
			yield { type: 'block-start', index, blockType: 'reasoning' }
			yield { type: 'reasoning-delta', index, text: reasoning }
			yield { type: 'block-end', index, block: { type: 'reasoning', text: reasoning } }
			index += 1
		}
		if (content !== '') {
			yield { type: 'block-start', index, blockType: 'text' }
			yield { type: 'text-delta', index, text: content }
			yield { type: 'block-end', index, block: { type: 'text', text: content } }
			index += 1
		}
		if (Array.isArray(message.tool_calls)) {
			for (const call of message.tool_calls) {
				const id = typeof call?.id === 'string' && call.id !== '' ? call.id : `call-${index}`
				const name = text(call?.function?.name)
				const args = text(call?.function?.arguments) || '{}'
				yield { type: 'block-start', index, blockType: 'tool-call' }
				yield { type: 'tool-call-delta', index, id, name, argumentsDelta: args }
				yield { type: 'block-end', index, block: { type: 'tool-call', id, name, arguments: args } }
				index += 1
			}
		}
	}

	finishChunk(parsed) {
		const reason = mapFinishReason(parsed?.choices?.[0]?.finish_reason)
		return { type: 'finish', reason }
	}

	async request(url, apiKey, route, options, includeUsage) {
		const body = buildRequestBody(this.ctx, route, options)
		if (includeUsage) body.stream_options = { include_usage: true }
		return this.fetchOnce(url, apiKey, body, route, options.signal)
	}

	/** Persist that this endpoint rejects `stream_options`, so later calls skip it. */
	async rememberNoUsage(channel) {
		if (channel.includeUsage === false) return
		await this.store.put('channels', channel.id, { ...channel, includeUsage: false, updatedAt: nowMs() })
	}

	async fetchOnce(url, apiKey, body, route, signal) {
		const timeoutMs = positiveInt(route.channel.timeoutMs, DEFAULT_TIMEOUT_MS)
		const timeout = AbortSignal.timeout(timeoutMs)
		const combined = signal === undefined ? timeout : AbortSignal.any([signal, timeout])
		let response
		try {
			response = await fetch(url, {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					accept: 'text/event-stream',
					authorization: `Bearer ${apiKey}`,
					...normalizedHeaders(route.channel.headers),
				},
				body: JSON.stringify(body),
				signal: combined,
			})
		} catch (error) {
			throw tieError(error, signal)
		}
		return response
	}

	async apiKey(channelId) {
		try {
			const record = await this.ctx.credentials.readRecord(`${CRED_SCOPE}/${channelId}`)
			if (record?.kind === 'api-key' && typeof record.key === 'string' && record.key !== '') return record.key
		} catch {
			// A credential-store failure reads as "no key" so the channel is skipped.
		}
		return undefined
	}
}

function normalizedHeaders(headers) {
	if (headers === null || typeof headers !== 'object') return {}
	const out = {}
	for (const [key, value] of Object.entries(headers)) {
		if (typeof key === 'string' && key !== '' && typeof value === 'string' && value !== '') out[key] = value
	}
	return out
}

function isVisibleChunk(chunk) {
	if (chunk === undefined || chunk === null) return false
	if (chunk.type === 'text-delta') return typeof chunk.text === 'string' && chunk.text !== ''
	if (chunk.type === 'reasoning-delta') return typeof chunk.text === 'string' && chunk.text !== ''
	if (chunk.type === 'tool-call-delta') return true
	return false
}

function normalizeArguments(raw, reason) {
	if (reason.kind === 'max-tokens') return raw
	const value = text(raw).trim()
	if (value === '') return '{}'
	try {
		const parsed = JSON.parse(value)
		return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? value : '{}'
	} catch {
		return '{}'
	}
}

/** Mark a failure this adapter detected itself (auth/config problems, not HTTP). */
function deviceFailure(message, code, kind) {
	const error = relayFailure(message, code)
	error.relay = true
	error.descriptor = { code, kind, message }
	return error
}

function descriptorFailure(descriptor) {
	const error = relayFailure(descriptor.message, descriptor.code, {
		status: descriptor.status,
		retryAfterMs: descriptor.retryAfterMs,
	})
	error.relay = true
	error.descriptor = descriptor
	return error
}

function tieError(error, signal) {
	if (signal?.aborted) return relayFailure('request aborted', 'ABORTED')
	if (error?.name === 'TimeoutError') return descriptorFailure({ code: 'TIMEOUT', kind: 'transient', message: 'upstream request timed out' })
	return error
}

async function safeText(response) {
	try {
		return await response.text()
	} catch {
		return ''
	}
}

//#endregion

//#region plugin

export const name = 'dsh_multi_api'
export const inject = RELAY_INJECT

export async function apply(ctx, config) {
	const store = await openStore(ctx)
	const state = {
		bindingCooldown: new Map(),
		logWrites: 0,
	}
	const adapter = new RelayAdapter(ctx, store, state)

	ctx.effect(() => ctx.llm.registerAdapter([PROVIDER_ROUTE], adapter), 'dsh_multi_api: adapter')

	const notify = () => {
		try {
			ctx.emit('llm/models-updated', PROVIDER_ROUTE)
		} catch (error) {
			ctx.logger?.warn?.(`dsh_multi_api: model notification failed: ${shortMessage(error?.message ?? error)}`)
		}
	}

	const service = {
		async snapshot() {
			const channels = []
			for (const channel of store.list('channels').sort((a, b) => nonNegativeInt(a.priority, 100) - nonNegativeInt(b.priority, 100))) {
				channels.push({
					...channel,
					hasKey: (await describeKey(ctx, channel.id)) === true,
				})
			}
			const bindings = store.list('bindings').sort((a, b) => text(a.model).localeCompare(text(b.model)))
			const channelStates = store.list('channel_state')
			const logs = store
				.list('call_log')
				.sort((a, b) => String(b.id).localeCompare(String(a.id)))
				.slice(0, 60)
			return {
				providerRoute: PROVIDER_ROUTE,
				providerName: PROVIDER_NAME,
				persistent: store.persistent === true,
				storageReason: store.persistent === true ? '' : text(store.reason),
				channels,
				bindings,
				states: channelStates,
				logs,
				now: nowMs(),
			}
		},

		async saveChannel(input) {
			const id = trimmed(input?.id) === '' ? newChannelId() : trimmed(input.id)
			if (!/^[a-z][a-z0-9-]*$/.test(id)) throw new Error('channel id must be lowercase letters, digits, and hyphens')
			const previous = store.get('channels', id) ?? {}
			const baseUrl = trimmed(input?.baseUrl)
			if (baseUrl === '') throw new Error('Base URL is required')
			if (!/^https?:\/\//i.test(baseUrl)) throw new Error('Base URL must start with http:// or https://')
			const channel = {
				id,
				name: trimmed(input?.name) === '' ? baseUrl.replace(/^https?:\/\//i, '').split('/')[0] : trimmed(input.name),
				baseUrl: baseUrl.replace(/\/+$/, ''),
				enabled: booleanOr(input?.enabled, previous.enabled ?? true),
				priority: nonNegativeInt(input?.priority, previous.priority ?? 100),
				weight: nonNegativeInt(input?.weight, previous.weight ?? 0),
				timeoutMs: positiveInt(input?.timeoutMs, previous.timeoutMs ?? DEFAULT_TIMEOUT_MS),
				contextWindow: positiveInt(input?.contextWindow, previous.contextWindow),
				maxTokens: positiveInt(input?.maxTokens, previous.maxTokens),
				includeUsage: booleanOr(input?.includeUsage, previous.includeUsage ?? true),
				headers: normalizedHeaders(input?.headers ?? previous.headers),
				createdAt: previous.createdAt ?? nowMs(),
				updatedAt: nowMs(),
			}
			await store.put('channels', id, channel)
			const apiKey = typeof input?.apiKey === 'string' ? input.apiKey.trim() : undefined
			if (apiKey !== undefined && apiKey !== '') await writeKey(ctx, id, apiKey)
			if (input?.clearKey === true) await clearKey(ctx, id)
			if (Array.isArray(input?.models)) await this.replaceChannelModels(id, input.models, channel)
			notify()
			return { id }
		},

		async replaceChannelModels(channelId, models, channel) {
			const existing = store.list('bindings').filter((binding) => binding.channelId === channelId)
			const wanted = []
			for (const entry of models) {
				const raw = trimmed(entry)
				if (raw === '') continue
				const separator = raw.indexOf('=')
				const model = separator > 0 ? raw.slice(0, separator).trim() : raw
				const upstreamModel = separator > 0 ? raw.slice(separator + 1).trim() : model
				if (model === '' || upstreamModel === '') continue
				wanted.push({ model, upstreamModel })
			}
			const keep = new Set()
			for (const entry of wanted) {
				const match = existing.find((binding) => binding.model === entry.model)
				if (match !== undefined) {
					keep.add(match.id)
					if (match.upstreamModel !== entry.upstreamModel) {
						await store.put('bindings', match.id, { ...match, upstreamModel: entry.upstreamModel, updatedAt: nowMs() })
					}
					continue
				}
				const id = newRecordId('bd')
				await store.put('bindings', id, {
					id,
					model: entry.model,
					channelId,
					upstreamModel: entry.upstreamModel,
					name: entry.model,
					enabled: true,
					reasoning: false,
					createdAt: nowMs(),
					updatedAt: nowMs(),
					...(channel === undefined ? {} : {}),
				})
			}
			for (const binding of existing) {
				if (!keep.has(binding.id)) await store.remove('bindings', binding.id)
			}
		},

		async deleteChannel(input) {
			const id = trimmed(input?.id)
			if (id === '') throw new Error('channel id is required')
			for (const binding of store.list('bindings')) {
				if (binding.channelId === id) await store.remove('bindings', binding.id)
			}
			await store.remove('channel_state', id)
			await store.remove('channels', id)
			await clearKey(ctx, id)
			notify()
			return { id }
		},

		async resetChannel(input) {
			const id = trimmed(input?.id)
			if (id === '') throw new Error('channel id is required')
			await store.remove('channel_state', id)
			for (const binding of store.list('bindings')) {
				if (binding.channelId === id) state.bindingCooldown.delete(binding.id)
			}
			return { id }
		},

		async testChannel(input) {
			const channel = channelFromInput(store, input)
			if (channel === undefined) throw new Error('channel is required')
			const started = nowMs()
			const apiKey = await this.resolveKey(input)
			if (apiKey === undefined) return { ok: false, detail: 'No API key configured', ms: nowMs() - started }
			try {
				const response = await fetch(joinUrl(channel.baseUrl, '/models'), {
					method: 'GET',
					headers: { accept: 'application/json', authorization: `Bearer ${apiKey}`, ...normalizedHeaders(channel.headers) },
					signal: AbortSignal.timeout(Math.min(positiveInt(channel.timeoutMs, DEFAULT_TIMEOUT_MS), 30_000)),
				})
				const body = await safeText(response)
				if (!response.ok) {
					return { ok: false, status: response.status, detail: errorDetail(body) || `HTTP ${response.status}`, ms: nowMs() - started }
				}
				let count
				try {
					const parsed = JSON.parse(body)
					if (Array.isArray(parsed?.data)) count = parsed.data.length
				} catch {
					count = undefined
				}
				return { ok: true, status: response.status, modelCount: count, detail: count === undefined ? 'Reachable' : `${count} models advertised`, ms: nowMs() - started }
			} catch (error) {
				return { ok: false, detail: shortMessage(error?.message ?? String(error)), ms: nowMs() - started }
			}
		},

		async listUpstreamModels(input) {
			const channel = channelFromInput(store, input)
			if (channel === undefined) throw new Error('channel is required')
			const apiKey = await this.resolveKey(input)
			if (apiKey === undefined) throw new Error('An API key is required to list upstream models')
			const response = await fetch(joinUrl(channel.baseUrl, '/models'), {
				method: 'GET',
				headers: { accept: 'application/json', authorization: `Bearer ${apiKey}`, ...normalizedHeaders(channel.headers) },
				signal: AbortSignal.timeout(30_000),
			})
			const body = await safeText(response)
			if (!response.ok) throw new Error(errorDetail(body) || `HTTP ${response.status}`)
			let parsed
			try {
				parsed = JSON.parse(body)
			} catch {
				throw new Error('Upstream returned a non-JSON model list')
			}
			const entries = Array.isArray(parsed?.data) ? parsed.data : Array.isArray(parsed) ? parsed : []
			const models = []
			for (const entry of entries) {
				const id = text(entry?.id)
				if (id === '') continue
				models.push({ id, name: text(entry?.name, id) })
			}
			models.sort((a, b) => a.id.localeCompare(b.id))
			return { models }
		},

		async resolveKey(input) {
			const explicit = typeof input?.apiKey === 'string' ? input.apiKey.trim() : ''
			if (explicit !== '') return explicit
			const channel = channelFromInput(store, input)
			if (channel === undefined) return undefined
			return adapter.apiKey(channel.id)
		},

		async saveBinding(input) {
			const model = trimmed(input?.model)
			if (model === '') throw new Error('Model id is required')
			const channelId = trimmed(input?.channelId)
			if (channelId === '' || store.get('channels', channelId) === undefined) throw new Error('Choose a channel for this model')
			const id = trimmed(input?.id) === '' ? newRecordId('bd') : trimmed(input.id)
			const previous = store.get('bindings', id) ?? {}
			const binding = {
				id,
				model,
				channelId,
				upstreamModel: trimmed(input?.upstreamModel) === '' ? model : trimmed(input.upstreamModel),
				name: trimmed(input?.name),
				enabled: booleanOr(input?.enabled, previous.enabled ?? true),
				reasoning: booleanOr(input?.reasoning, previous.reasoning ?? false),
				contextWindow: positiveInt(input?.contextWindow, undefined),
				maxTokens: positiveInt(input?.maxTokens, undefined),
				createdAt: previous.createdAt ?? nowMs(),
				updatedAt: nowMs(),
			}
			await store.put('bindings', id, binding)
			notify()
			return { id }
		},

		async deleteBinding(input) {
			const id = trimmed(input?.id)
			if (id === '') throw new Error('binding id is required')
			await store.remove('bindings', id)
			state.bindingCooldown.delete(id)
			notify()
			return { id }
		},

		async clearLogs() {
			for (const entry of store.list('call_log')) await store.remove('call_log', entry.id)
			return { ok: true }
		},

		async state() {
			return this.snapshot()
		},
	}

	const routes = {
		state: async (body) => service.snapshot(body),
		'channel.save': async (body) => service.saveChannel(body),
		'channel.delete': async (body) => service.deleteChannel(body),
		'channel.test': async (body) => service.testChannel(body),
		'channel.models': async (body) => service.listUpstreamModels(body),
		'channel.reset': async (body) => service.resetChannel(body),
		'binding.save': async (body) => service.saveBinding(body),
		'binding.delete': async (body) => service.deleteBinding(body),
		'logs.clear': async () => service.clearLogs(),
	}

	registerRoutes(ctx, routes)
	ctx.logger?.info?.(`dsh_multi_api: provider "${PROVIDER_ROUTE}" ready (${store.list('channels').length} channel(s), ${store.list('bindings').length} binding(s), storage ${store.persistent === true ? 'persistent' : 'in-memory'})`)
}

function channelFromInput(store, input) {
	const id = trimmed(input?.channelId ?? input?.id)
	if (id !== '') {
		const stored = store.get('channels', id)
		if (stored !== undefined) return stored
	}
	const baseUrl = trimmed(input?.baseUrl)
	if (baseUrl !== '') return { id: '', baseUrl: baseUrl.replace(/\/+$/, ''), headers: {}, timeoutMs: DEFAULT_TIMEOUT_MS }
	return undefined
}

async function describeKey(ctx, channelId) {
	try {
		const info = await ctx.credentials.describeRecord(`${CRED_SCOPE}/${channelId}`)
		return info?.configured === true
	} catch {
		return false
	}
}

async function writeKey(ctx, channelId, apiKey) {
	await ctx.credentials.modifyRecord(`${CRED_SCOPE}/${channelId}`, async () => ({ kind: 'api-key', key: apiKey }))
}

async function clearKey(ctx, channelId) {
	try {
		await ctx.credentials.deleteRecord(`${CRED_SCOPE}/${channelId}`)
	} catch {
		// Removing an absent record is a no-op; a failure here must not undo the delete.
	}
}

function registerRoutes(ctx, handlers) {
	const connection = ctx.get('connection')
	const register = typeof connection?.fetch?.register === 'function' ? connection.fetch.register.bind(connection.fetch) : undefined
	if (register === undefined) {
		ctx.logger?.warn?.('dsh_multi_api: connection fetch route registry is unavailable; the sidebar page cannot load data')
		return
	}
	for (const [name, handler] of Object.entries(handlers)) {
		ctx.effect(
			() =>
				register({
					path: `/api/dsh_multi_api/${name}`,
					methods: ['POST'],
					requestBody: 'buffered',
					fetch: async (request) => {
						let body = {}
						try {
							const raw = await request.text()
							if (raw.trim() !== '') body = JSON.parse(raw)
						} catch {
							return errorResponse('bad-request', 'request body is not JSON')
						}
						try {
							return okResponse(await handler(body))
						} catch (error) {
							return errorResponse('dsh_multi_api/failed', shortMessage(error?.message ?? String(error), 500))
						}
					},
				}),
			`dsh_multi_api: ${name} route`,
		)
	}
}

function okResponse(value) {
	return Response.json({ ok: true, value }, { headers: { 'cache-control': 'no-store' } })
}

function errorResponse(code, message) {
	return Response.json({ ok: false, error: { code, message } }, { headers: { 'cache-control': 'no-store' } })
}

//#endregion
