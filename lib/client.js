window.__ModuleLoader__.load({
	id: "dsh-openai-oauth",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client.tsx
		const ENDPOINT = "/api/openai-oauth";
		const USAGE_URL = "https://chatgpt.com/settings/usage";
		const SETTINGS_URL = "https://chatgpt.com/settings";
		const DATA_HANDLING_URL = "https://github.com/DGPisces/dsh-openai-oauth#privacy-and-data-handling";
		const PRIVACY_URL = "https://openai.com/policies/privacy-policy/";
		const SIWC_TERMS_URL = "https://openai.com/policies/sign-in-with-chatgpt-terms/";
		const ONBOARDING_KEY = "dsh.openai-oauth.onboarding-seen";
		const copy = typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("zh") ? {
			title: "OpenAI OAuth",
			intro: "连接 ChatGPT 账户，在符合条件时使用你的 ChatGPT 套餐完成 AI 请求。",
			consent: "继续后会打开 OpenAI 授权页面；是否允许使用套餐由你决定。",
			privacy: "插件会将你的 ChatGPT 账户标识、可用时的电子邮件及授权凭据保存在本机。退出所选账户会清除其可用于请求的凭据，并保留本地注册记录以便重新登录。撤销未确认时，可能保留仅用于重试撤销的凭据。登录后，DSH 的 openai 提供方会把模型请求及其中的附件和相关上下文发送到 OpenAI 官方 Responses API，用于模型推理。",
			dataHandling: "插件如何处理数据",
			openAiPrivacy: "OpenAI 隐私政策",
			signInTerms: "使用 ChatGPT 登录的条款",
			onboarding: "使用你的 ChatGPT 套餐",
			notNow: "暂不连接",
			usage: "符合条件的请求使用 ChatGPT 套餐或可用积分，受账户、套餐或应用限额约束。这不同于其他 Harness 提供方的计费。",
			manage: "管理用量",
			settings: "打开 ChatGPT 设置",
			loading: "正在查询登录状态…",
			unavailable: "无法确认登录状态",
			connected: "已登录",
			disconnected: "尚未登录",
			login: "Continue with ChatGPT",
			enable: "重新授权套餐使用",
			waiting: "等待 OpenAI 授权…",
			waitingHelp: "请在打开的页面完成授权，然后返回此处。若已关闭页面，可停止本次等待后重新开始。",
			stop: "停止等待",
			stopped: "已停止本次登录尝试，可以重新开始。",
			logout: "退出当前账户",
			refresh: "刷新状态",
			popupBlocked: "授权窗口未能打开，请点击这里继续授权。",
			enabled: "正在使用 ChatGPT 套餐",
			plan: "ChatGPT 套餐",
			authorized: "已授权使用 ChatGPT 套餐",
			disabled: "尚未授权使用 ChatGPT 套餐。可重新授权，或在 Harness 中配置其他受支持的提供方。",
			unknown: "无法确认套餐使用授权状态；登录本身不代表已授权。",
			failure: "登录未完成，请检查授权页面后重试。",
			loginFailure: "无法确认登录是否已开始，请刷新状态后检查。",
			consentDenied: "OpenAI 授权已被拒绝。你可以重试，或在 Harness 中配置其他受支持的提供方。",
			clientRejected: "OpenAI 拒绝了本次应用注册。请在 ChatGPT 设置中检查授权，再尝试登录。",
			logoutFailure: "无法确认是否已退出，请刷新状态后检查。",
			stopFailure: "无法确认是否已停止等待，请刷新状态后检查。",
			statusFailure: "无法获取状态，请检查连接后重试。",
			invalidUrl: "无法打开授权页面：服务器返回的地址无效。请刷新状态后检查。",
			remoteUnknown: "已退出本地登录；无法确认 OpenAI 端是否撤销。可在 ChatGPT 设置中检查并断开应用。",
			remoteConfirmed: "已退出登录，远端会话已撤销。",
			remoteNotApplicable: "没有已知的待撤销会话；未进行远端撤销。",
			pendingRevocation: "处理未完成的远端撤销",
			pendingRevoked: "待处理的远端会话已撤销。",
			pendingUnknown: "仍无法确认待处理的远端会话已撤销。请在 ChatGPT 设置中检查并断开应用。",
			signOutInfo: "如需检查或断开 OpenAI 端的应用授权，请访问 ChatGPT 设置。",
			models: "DSH 模型",
			modelsHint: "登录后，请在 Settings → Models 中使用 openai 提供方；模型请求、会话历史与错误处理都由 DSH 负责。",
			authMode: "认证方式",
			authModeHint: "选择 openai 提供方使用的凭据。切换后从下一个请求生效；模型等配置不变。",
			usePlan: "使用 ChatGPT 套餐",
			useApiKey: "使用 OpenAI API key",
			modeSwitched: "已切换为{mode}，下一个请求生效。",
			modePlan: "ChatGPT 套餐",
			modeApi: "OpenAI API key",
			planNeedsSignIn: "当前未登录 ChatGPT；登录后套餐请求才可用。",
			apiKeyMissing: "没有找到已保存的 OpenAI API key（OPENAI_API_KEY）。",
			modeUnknown: "当前路由使用了其他凭据引用。",
			modeFailure: "无法切换认证方式，请刷新状态后重试。",
			modeUnavailable: "无法读取认证方式；如果刚更新过插件，请重启 dsh web 并刷新页面。",
			modeNoRoute: "当前 profile 中没有可切换的 openai 提供方路由。",
			modeNoEditor: "当前部署无法在这里修改提供方配置。",
			accounts: "ChatGPT 账户",
			active: "当前活动账户",
			signedIn: "已登录",
			signedOut: "已退出",
			selectAccount: "授权并切换到此账户",
			signInSaved: "重新登录此账户",
			newAccount: "添加新账户",
			noAccounts: "没有已保存账户。",
			accountFailure: "无法获取账户列表，请刷新状态。",
			selectFailure: "无法启动账户切换，请刷新状态后重试。",
			pendingRegistration: "继续恢复上一次未完成的注册",
			welcomeTitle: "你正在使用 ChatGPT 套餐",
			welcomeBody: "此应用中符合条件的 AI 请求会使用你的 ChatGPT 套餐或可用积分。你可以在 ChatGPT 设置中管理用量。",
			gotIt: "知道了",
			welcomeFailure: "无法确认是否已保存确认，请重试。",
			errorPrefix: "错误：",
			codes: {
				LOGIN_PENDING: "已有一次登录等待完成，请先停止或等待结束。",
				LOGIN_CANCELLED: "登录已取消。",
				LOGOUT_PENDING: "正在退出登录，请稍候。",
				ACCOUNT_CHANGE_UNAVAILABLE: "有请求正在进行，暂时无法更改账户；请稍后再试。",
				ACCOUNT_CHANGED: "账户已更改，请刷新状态后重试。",
				ACCOUNT_UNAVAILABLE: "该账户当前不可用，请重新登录。",
				INVALID_REQUEST: "请求无效，请重试。",
				LOGIN_FAILED: "登录无法开始，请稍后重试。",
				INVALID_MODE: "请选择 ChatGPT 套餐或 OpenAI API key。",
				NO_CONFIG_EDITOR: "当前部署无法在这里修改提供方配置。",
				NO_OPENAI_ROUTE: "当前配置中没有可切换的 openai 提供方路由。",
				API_KEY_MISSING: "未保存 OPENAI_API_KEY。",
				CONFIG_WRITE_FAILED: "提供方路由更新失败，请检查配置是否可写。"
			}
		} : {
			title: "OpenAI OAuth",
			intro: "Connect a ChatGPT account to use your ChatGPT plan for eligible AI requests.",
			consent: "Continue to OpenAI’s authorization page; you decide there whether to allow plan use.",
			privacy: "The plugin stores your ChatGPT account ID, email when available, and credentials locally. Signing out of the selected account clears its usable credentials and keeps its local registration so you can sign in again. If revocation is unconfirmed, credentials may be retained solely to retry revocation. After sign-in, the DSH openai provider sends model requests, their attachments, and relevant context to the official OpenAI Responses API for inference.",
			dataHandling: "Plugin data handling",
			openAiPrivacy: "OpenAI Privacy Policy",
			signInTerms: "Sign in with ChatGPT Terms",
			onboarding: "Use your ChatGPT plan",
			notNow: "Not now",
			usage: "Eligible requests use your ChatGPT plan or available credits, subject to account, plan or app limits. This is separate from billing by other Harness providers.",
			manage: "Manage usage",
			settings: "Open ChatGPT settings",
			loading: "Checking sign-in status…",
			unavailable: "Sign-in status unavailable",
			connected: "Signed in",
			disconnected: "Not signed in",
			login: "Continue with ChatGPT",
			enable: "Reauthorize plan use",
			waiting: "Waiting for OpenAI authorization…",
			waitingHelp: "Complete authorization in the opened page, then return here. If you closed it, stop waiting and start again.",
			stop: "Stop waiting",
			stopped: "Stopped this sign-in attempt; you can start again.",
			logout: "Sign out of active account",
			refresh: "Refresh status",
			popupBlocked: "The authorization window did not open. Continue here to authorize.",
			enabled: "Using ChatGPT plan",
			plan: "ChatGPT plan",
			authorized: "ChatGPT plan use is authorized",
			disabled: "ChatGPT plan use is not authorized. Reauthorize it or configure another supported Harness provider.",
			unknown: "ChatGPT plan authorization could not be confirmed; signing in alone does not imply permission.",
			failure: "Sign-in did not complete. Check the authorization page and try again.",
			loginFailure: "Could not confirm whether sign-in started. Refresh the status and check.",
			consentDenied: "OpenAI authorization was declined. Try again or configure another supported Harness provider.",
			clientRejected: "OpenAI rejected this app registration. Check its authorization in ChatGPT settings, then try signing in.",
			logoutFailure: "Could not confirm whether sign-out completed. Refresh the status and check.",
			stopFailure: "Could not confirm whether waiting stopped. Refresh the status and check.",
			statusFailure: "Could not get status. Check the connection and try again.",
			invalidUrl: "Cannot open the authorization page: the server returned an invalid address. Refresh the status and check.",
			remoteUnknown: "Signed out locally; remote revocation could not be confirmed. Check and disconnect the app in ChatGPT settings.",
			remoteConfirmed: "Signed out; the remote session was revoked.",
			remoteNotApplicable: "There was no known session to revoke; no remote revocation was performed.",
			pendingRevocation: "Resolve unfinished remote revocation",
			pendingRevoked: "The pending remote sessions were revoked.",
			pendingUnknown: "Revocation of the pending remote sessions remains unconfirmed. Check and disconnect the app in ChatGPT settings.",
			signOutInfo: "Visit ChatGPT settings to check or disconnect the app authorization.",
			models: "DSH models",
			modelsHint: "After signing in, use the openai provider in Settings → Models; DSH owns model requests, conversation history, and error handling.",
			authMode: "Authentication",
			authModeHint: "Choose which credential the openai provider route uses. The next request uses it; models and other configuration stay as they are.",
			usePlan: "Use ChatGPT plan",
			useApiKey: "Use OpenAI API key",
			modeSwitched: "Switched to {mode}; the next request uses it.",
			modePlan: "ChatGPT plan",
			modeApi: "OpenAI API key",
			planNeedsSignIn: "No ChatGPT account is signed in; plan requests work after signing in.",
			apiKeyMissing: "No stored OpenAI API key was found (OPENAI_API_KEY).",
			modeUnknown: "The route uses a different credential reference.",
			modeFailure: "Could not switch authentication. Refresh the status and try again.",
			modeUnavailable: "Could not read the authentication mode; after updating the plugin, restart dsh web and refresh the page.",
			modeNoRoute: "The profile has no switchable openai provider route.",
			modeNoEditor: "This deployment cannot change the provider route here.",
			accounts: "ChatGPT accounts",
			active: "Active account",
			signedIn: "Signed in",
			signedOut: "Signed out",
			selectAccount: "Authorize and switch to this account",
			signInSaved: "Sign in to this account again",
			newAccount: "Add a new account",
			noAccounts: "No saved accounts.",
			accountFailure: "Could not load accounts. Refresh the status.",
			selectFailure: "Could not start switching accounts. Refresh the status and try again.",
			pendingRegistration: "Continue the previous incomplete registration",
			welcomeTitle: "You’re using your ChatGPT plan",
			welcomeBody: "Eligible AI requests in this app use your ChatGPT plan or available credits. You can manage usage in ChatGPT settings.",
			gotIt: "Got it",
			welcomeFailure: "Could not confirm whether your acknowledgement was saved. Try again.",
			errorPrefix: "Error: ",
			codes: {
				LOGIN_PENDING: "A sign-in is already waiting. Stop it or wait for it to finish.",
				LOGIN_CANCELLED: "Sign-in was cancelled.",
				LOGOUT_PENDING: "Sign-out is already in progress.",
				ACCOUNT_CHANGE_UNAVAILABLE: "A request is in progress, so the account cannot change yet. Try again shortly.",
				ACCOUNT_CHANGED: "The account changed. Refresh the status and try again.",
				ACCOUNT_UNAVAILABLE: "This account is not available. Sign in again.",
				INVALID_REQUEST: "Invalid request. Try again.",
				LOGIN_FAILED: "Sign-in could not be started. Try again shortly.",
				INVALID_MODE: "Choose ChatGPT plan or OpenAI API key.",
				NO_CONFIG_EDITOR: "This deployment cannot change the provider route here.",
				NO_OPENAI_ROUTE: "The profile has no switchable openai provider route.",
				API_KEY_MISSING: "No OPENAI_API_KEY is stored.",
				CONFIG_WRITE_FAILED: "The provider route could not be updated; check that the profile is writable."
			}
		};
		var RequestError = class extends Error {
			code;
			constructor(code) {
				super("request failed");
				this.code = code;
			}
		};
		async function request(path, method = "GET", payload, signal) {
			const response = await fetch(`${ENDPOINT}${path}`, {
				method,
				headers: {
					accept: "application/json",
					...payload === void 0 ? {} : { "content-type": "application/json" }
				},
				body: payload === void 0 ? void 0 : JSON.stringify(payload),
				credentials: "same-origin",
				cache: "no-store",
				redirect: "error",
				signal
			});
			let body;
			try {
				body = await response.json();
			} catch {
				throw new RequestError();
			}
			if (!response.ok) throw new RequestError(typeof body === "object" && body !== null && "code" in body && typeof body.code === "string" ? body.code : void 0);
			return body;
		}
		function failureText(reason, fallback) {
			const code = reason instanceof RequestError ? reason.code : void 0;
			return code === void 0 ? fallback : copy.codes[code] ?? fallback;
		}
		/** The one-time ticket is navigated to, never fetched; tokens remain on the host. */
		function isAuthorizationUrl(value) {
			if (typeof value !== "string") return false;
			if (!/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}\/auth\/start\/[A-Za-z0-9_-]{43}$/.test(value)) return false;
			try {
				const url = new URL(value);
				const port = Number(url.port);
				return url.protocol === "http:" && url.hostname === "127.0.0.1" && port >= 1 && port <= 65535 && !url.username && !url.password && !url.search && !url.hash && url.href === value;
			} catch {
				return false;
			}
		}
		/** Never turn a malformed response into an empty cache that could be saved. */
		function parseModels(value) {
			if (!value || typeof value !== "object" || !("models" in value) || !Array.isArray(value.models)) return void 0;
			const result = [];
			const seen = /* @__PURE__ */ new Set();
			for (const item of value.models) {
				if (!item || typeof item !== "object" || typeof item.id !== "string" || !item.id || typeof item.name !== "string" || !item.name || seen.has(item.id)) return void 0;
				seen.add(item.id);
				result.push({
					id: item.id,
					name: item.name
				});
			}
			return result;
		}
		/** Use only a signed-in identity from the same status snapshot as its flags. */
		function statusIdentity(value) {
			if (!value || typeof value !== "object") return void 0;
			const status = value;
			return status.authenticated === true && typeof status.activeClientId === "string" && status.activeClientId.length > 0 && typeof status.activeSubject === "string" && status.activeSubject.length > 0 ? {
				clientId: status.activeClientId,
				subject: status.activeSubject
			} : void 0;
		}
		function welcomeIdentity(value) {
			return value && typeof value === "object" && "welcomePending" in value && value.welcomePending === true ? statusIdentity(value) : void 0;
		}
		const emptyStatus = {};
		let statusSnapshot = emptyStatus;
		const statusSubscribers = /* @__PURE__ */ new Set();
		let statusMonitor;
		function publishStatus(snapshot) {
			statusSnapshot = snapshot;
			for (const subscriber of statusSubscribers) subscriber();
		}
		function getStatusSnapshot() {
			return statusSnapshot;
		}
		function getEmptyStatus() {
			return emptyStatus;
		}
		/** One authenticated status poll per browser, regardless of the number of slots. */
		function startStatusMonitor() {
			let disposed = false, sequence = 0;
			let pending;
			let controller;
			let timeout;
			let interval;
			let intervalMs = 1e4;
			const refresh = (force = false) => {
				if (disposed) return Promise.resolve();
				if (pending && !force) return pending;
				if (force) {
					++sequence;
					controller?.abort();
					if (timeout !== void 0) window.clearTimeout(timeout);
				}
				const current = ++sequence;
				const requestController = new AbortController();
				controller = requestController;
				timeout = window.setTimeout(() => requestController.abort(), 15e3);
				pending = request("/status?light=1", "GET", void 0, requestController.signal).then((value) => {
					if (disposed || current !== sequence) return;
					if (!value || typeof value !== "object" || typeof value.authenticated !== "boolean") throw new RequestError();
					const nextInterval = value.login?.state === "pending" || value.pendingRevocation ? 3e3 : 1e4;
					if (nextInterval !== intervalMs) {
						window.clearInterval(interval);
						intervalMs = nextInterval;
						interval = window.setInterval(onFocus, intervalMs);
					}
					publishStatus({ status: value });
				}).catch(() => {
					if (!disposed && current === sequence) publishStatus({
						status: statusSnapshot.status,
						failed: true
					});
				}).finally(() => {
					if (current !== sequence) return;
					if (timeout !== void 0) window.clearTimeout(timeout);
					timeout = void 0;
					controller = void 0;
					pending = void 0;
				});
				return pending;
			};
			const onFocus = () => {
				refresh();
			};
			const onVisibility = () => {
				if (document.visibilityState === "visible") onFocus();
			};
			window.addEventListener("focus", onFocus);
			document.addEventListener("visibilitychange", onVisibility);
			interval = window.setInterval(onFocus, intervalMs);
			onFocus();
			return {
				refresh,
				dispose: () => {
					if (disposed) return;
					disposed = true;
					++sequence;
					controller?.abort();
					if (timeout !== void 0) window.clearTimeout(timeout);
					window.clearInterval(interval);
					window.removeEventListener("focus", onFocus);
					document.removeEventListener("visibilitychange", onVisibility);
				}
			};
		}
		function subscribeStatus(subscriber) {
			if (typeof window === "undefined" || typeof document === "undefined") return () => {};
			statusSubscribers.add(subscriber);
			statusMonitor ??= startStatusMonitor();
			return () => {
				if (!statusSubscribers.delete(subscriber) || statusSubscribers.size) return;
				statusMonitor?.dispose();
				statusMonitor = void 0;
				statusSnapshot = emptyStatus;
			};
		}
		function refreshStatus(invalidate = false) {
			if (invalidate && statusMonitor) publishStatus(emptyStatus);
			return statusMonitor?.refresh(true) ?? Promise.resolve();
		}
		function watchWelcome(onChange) {
			let active = true;
			const notify = () => {
				if (!statusSnapshot.failed) onChange(welcomeIdentity(statusSnapshot.status));
			};
			const unsubscribe = subscribeStatus(notify);
			if (statusSnapshot.status) notify();
			return {
				refresh: () => {
					if (active) refreshStatus();
				},
				dispose: () => {
					active = false;
					unsubscribe();
				}
			};
		}
		/** Send the identity captured when the notice was displayed, never a fresh account lookup. */
		async function acknowledgeWelcome(identity) {
			if ((await request("/welcome/ack", "POST", identity))?.ok !== true) throw new RequestError();
		}
		function logoutOutcome(revocation) {
			if (revocation === "confirmed") return {
				message: copy.remoteConfirmed,
				unconfirmed: false
			};
			if (revocation === "not_applicable") return {
				message: copy.remoteNotApplicable,
				unconfirmed: false
			};
			return {
				message: copy.remoteUnknown,
				unconfirmed: true
			};
		}
		const styles = {
			section: {
				maxWidth: 720,
				padding: "4px 0 32px"
			},
			title: {
				fontSize: 20,
				margin: "0 0 8px"
			},
			intro: {
				color: "var(--dsw-alias-label-secondary)",
				lineHeight: 1.6,
				margin: "0 0 20px"
			},
			card: {
				border: "1px solid var(--dsw-alias-border-l2)",
				borderRadius: 12,
				padding: 20
			},
			status: {
				display: "flex",
				alignItems: "center",
				gap: 8,
				fontWeight: 600
			},
			dot: {
				width: 9,
				height: 9,
				borderRadius: "50%",
				flex: "none"
			},
			meta: {
				color: "var(--dsw-alias-label-secondary)",
				fontSize: 13,
				lineHeight: 1.6,
				marginTop: 8
			},
			actions: {
				display: "flex",
				flexWrap: "wrap",
				gap: 8,
				marginTop: 12,
				alignItems: "center"
			},
			button: {
				border: "1px solid var(--dsw-alias-border-l2)",
				borderRadius: 8,
				padding: "9px 12px",
				cursor: "pointer",
				font: "inherit",
				minHeight: 36,
				background: "var(--dsw-alias-button-elevated-fill)",
				color: "var(--dsw-alias-label-primary)"
			},
			primary: {
				background: "var(--dsw-alias-button-primary-fill)",
				borderColor: "transparent",
				color: "var(--dsw-alias-label-primary-foreground)"
			},
			siwc: {
				background: "#000",
				color: "#fff",
				borderColor: "#000",
				display: "inline-flex",
				gap: 10,
				alignItems: "center",
				justifyContent: "center"
			},
			disabled: {
				opacity: .55,
				cursor: "not-allowed"
			},
			error: {
				color: "var(--dsw-alias-state-error-primary)",
				marginTop: 12
			},
			group: { marginTop: 24 },
			heading: {
				fontSize: 15,
				margin: "0 0 4px"
			},
			account: {
				borderTop: "1px solid var(--dsw-alias-border-l2)",
				padding: "12px 0"
			},
			list: {
				listStyle: "none",
				padding: 0,
				margin: "10px 0 0"
			},
			checkbox: {
				display: "flex",
				gap: 8,
				alignItems: "baseline",
				padding: "5px 0",
				cursor: "pointer"
			},
			dialog: {
				maxWidth: 440,
				border: "1px solid var(--dsw-alias-border-l2)",
				borderRadius: 12,
				padding: 24,
				color: "var(--dsw-alias-label-primary)",
				background: "var(--dsw-alias-button-elevated-fill)"
			}
		};
		function buttonStyle(disabled, primary = false, siwc = false) {
			return {
				...styles.button,
				...primary ? styles.primary : {},
				...siwc ? styles.siwc : {},
				...disabled ? styles.disabled : {}
			};
		}
		function Blossom() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				"aria-hidden": "true",
				width: "18",
				height: "18",
				viewBox: "0 0 24 24",
				fill: "currentColor",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M22.418 9.822a5.903 5.903 0 0 0-.52-4.91 6.1 6.1 0 0 0-2.822-2.513 6.204 6.204 0 0 0-3.78-.389A6.055 6.055 0 0 0 13.232.518 6.129 6.129 0 0 0 10.726 0a6.185 6.185 0 0 0-3.615 1.153A6.052 6.052 0 0 0 4.88 4.187a6.102 6.102 0 0 0-2.344 1.018A6.008 6.008 0 0 0 .828 7.087a5.981 5.981 0 0 0 .754 7.09 5.904 5.904 0 0 0 .52 4.911 6.101 6.101 0 0 0 2.821 2.513 6.205 6.205 0 0 0 3.78.389 6.057 6.057 0 0 0 2.065 1.492 6.13 6.13 0 0 0 2.505.518 6.185 6.185 0 0 0 3.617-1.154 6.052 6.052 0 0 0 2.232-3.035 6.101 6.101 0 0 0 2.343-1.018 6.009 6.009 0 0 0 1.709-1.883 5.981 5.981 0 0 0-.756-7.088Zm-9.143 12.609a4.583 4.583 0 0 1-2.918-1.04c.037-.02.102-.056.144-.081l4.844-2.76a.783.783 0 0 0 .397-.68v-6.738L17.79 12.3a.072.072 0 0 1 .04.055v5.58a4.473 4.473 0 0 1-1.335 3.176 4.596 4.596 0 0 1-3.219 1.321Zm-9.793-4.127a4.432 4.432 0 0 1-.544-3.014c.036.021.099.06.144.085l4.843 2.76a.796.796 0 0 0 .795 0l5.913-3.369V17.1a.071.071 0 0 1-.029.062L9.708 19.95a4.617 4.617 0 0 1-3.458.447 4.556 4.556 0 0 1-2.768-2.093ZM2.208 7.872A4.527 4.527 0 0 1 4.58 5.9l-.002.164v5.52a.768.768 0 0 0 .397.68l5.913 3.369-2.047 1.166a.075.075 0 0 1-.069.006l-4.896-2.792a4.51 4.51 0 0 1-2.12-2.73 4.45 4.45 0 0 1 .452-3.411Zm16.818 3.861-5.913-3.368 2.047-1.166a.074.074 0 0 1 .07-.006l4.896 2.789a4.526 4.526 0 0 1 1.762 1.815 4.448 4.448 0 0 1-.418 4.808 4.556 4.556 0 0 1-2.049 1.494v-5.686a.767.767 0 0 0-.395-.68Zm2.038-3.025a6.874 6.874 0 0 0-.144-.085l-4.843-2.76a.797.797 0 0 0-.796 0L9.368 9.23V6.9a.072.072 0 0 1 .03-.062l4.895-2.787a4.608 4.608 0 0 1 4.885.207 4.51 4.51 0 0 1 1.599 1.955c.333.788.433 1.654.287 2.496ZM8.255 12.865 6.208 11.7a.071.071 0 0 1-.04-.056v-5.58c0-.854.248-1.69.713-2.412a4.54 4.54 0 0 1 1.913-1.658 4.614 4.614 0 0 1 4.85.616c-.037.02-.102.055-.144.08L8.657 5.452a.782.782 0 0 0-.398.68l-.004 6.734ZM9.367 10.5 12.001 9l2.633 1.5v3L12.001 15l-2.634-1.5v-3Z" })
			});
		}
		function SignInButton({ disabled, onClick, description }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
				type: "button",
				"data-oai-siwc-button": "",
				"aria-label": `${copy.login} — ${description}`,
				style: buttonStyle(disabled, false, true),
				disabled,
				onClick,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Blossom, {}), copy.login]
			});
		}
		function PrivacyNotice() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: styles.meta,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: copy.privacy }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("ul", { children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
						href: DATA_HANDLING_URL,
						target: "_blank",
						rel: "noopener noreferrer",
						children: copy.dataHandling
					}) }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
						href: PRIVACY_URL,
						target: "_blank",
						rel: "noopener noreferrer",
						children: copy.openAiPrivacy
					}) }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
						href: SIWC_TERMS_URL,
						target: "_blank",
						rel: "noopener noreferrer",
						children: copy.signInTerms
					}) })
				] })]
			});
		}
		function OpenAiOnboarding({ explicit, complete, openSection }) {
			const [visible, setVisible] = (0, react.useState)(false);
			const [busy, setBusy] = (0, react.useState)(false);
			const [authUrl, setAuthUrl] = (0, react.useState)();
			const [error, setError] = (0, react.useState)();
			const ref = (0, react.useRef)(null);
			const inFlight = (0, react.useRef)(false);
			const completeRef = (0, react.useRef)(complete);
			completeRef.current = complete;
			(0, react.useEffect)(() => {
				try {
					if (!explicit && window.localStorage.getItem(ONBOARDING_KEY) === "1") {
						completeRef.current();
						return;
					}
				} catch {}
				const abort = new AbortController();
				Promise.all([request("/status?light=1", "GET", void 0, abort.signal), request("/accounts", "GET", void 0, abort.signal)]).then(([status, saved]) => {
					if (abort.signal.aborted) return;
					if (status.authenticated !== false || !Array.isArray(saved.accounts) || saved.accounts.length || status.pendingRegistration || status.login?.state === "pending") completeRef.current();
					else setVisible(true);
				}, () => {
					if (!abort.signal.aborted) completeRef.current();
				});
				return () => abort.abort();
			}, [explicit]);
			(0, react.useEffect)(() => {
				if (!visible) return;
				const dialog = ref.current;
				dialog?.showModal();
				return () => dialog?.close();
			}, [visible]);
			const dismiss = (settings) => {
				try {
					window.localStorage.setItem(ONBOARDING_KEY, "1");
				} catch {}
				complete();
				if (settings) openSection("openai-oauth");
			};
			const login = async () => {
				if (inFlight.current) return;
				inFlight.current = true;
				const popup = window.open("about:blank", "_blank");
				if (popup) popup.opener = null;
				setBusy(true);
				setError(void 0);
				setAuthUrl(void 0);
				try {
					const result = await request("/login", "POST", { newAccount: true });
					if (!isAuthorizationUrl(result?.authUrl)) throw new Error(copy.invalidUrl);
					refreshStatus();
					if (popup) {
						popup.location.href = result.authUrl;
						dismiss(true);
					} else setAuthUrl(result.authUrl);
				} catch (reason) {
					popup?.close();
					setError(reason instanceof Error && reason.message === copy.invalidUrl ? copy.invalidUrl : failureText(reason, copy.loginFailure));
				} finally {
					inFlight.current = false;
					setBusy(false);
				}
			};
			const stop = async () => {
				if (inFlight.current) return;
				if (!authUrl) {
					dismiss(false);
					return;
				}
				inFlight.current = true;
				setBusy(true);
				try {
					await request("/login/cancel", "POST");
					refreshStatus();
					dismiss(false);
				} catch (reason) {
					setError(failureText(reason, copy.stopFailure));
				} finally {
					inFlight.current = false;
					setBusy(false);
				}
			};
			if (!visible) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dialog", {
				ref,
				style: styles.dialog,
				"aria-labelledby": "siwc-onboarding-title",
				onCancel: (event) => {
					event.preventDefault();
					stop();
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
						id: "siwc-onboarding-title",
						children: copy.onboarding
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: copy.usage }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: copy.consent }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(PrivacyNotice, {}),
					authUrl ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
						href: authUrl,
						target: "_blank",
						rel: "noopener noreferrer",
						onClick: () => dismiss(true),
						children: copy.popupBlocked
					}) }) : null,
					error ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						role: "alert",
						style: styles.error,
						children: error
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: styles.actions,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SignInButton, {
							description: copy.onboarding,
							disabled: busy || !!authUrl,
							onClick: () => {
								login();
							}
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							style: buttonStyle(busy),
							disabled: busy,
							onClick: () => {
								stop();
							},
							children: authUrl ? copy.stop : copy.notNow
						})]
					})
				]
			});
		}
		function Welcome({ onAcknowledge }) {
			const ref = (0, react.useRef)(null);
			const inFlight = (0, react.useRef)(false), mounted = (0, react.useRef)(false);
			const [busy, setBusy] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)();
			(0, react.useEffect)(() => {
				mounted.current = true;
				const dialog = ref.current;
				dialog?.showModal();
				return () => {
					mounted.current = false;
					dialog?.close();
				};
			}, []);
			const acknowledge = async () => {
				if (inFlight.current) return;
				inFlight.current = true;
				setBusy(true);
				setError(void 0);
				try {
					await onAcknowledge();
				} catch (reason) {
					if (mounted.current) setError(failureText(reason, copy.welcomeFailure));
				} finally {
					inFlight.current = false;
					if (mounted.current) setBusy(false);
				}
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dialog", {
				ref,
				style: {
					...styles.dialog,
					pointerEvents: "auto"
				},
				"aria-labelledby": "siwc-welcome-title",
				onCancel: (event) => event.preventDefault(),
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Blossom, {}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
						id: "siwc-welcome-title",
						children: copy.welcomeTitle
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: copy.welcomeBody }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
						href: USAGE_URL,
						target: "_blank",
						rel: "noopener noreferrer",
						children: copy.manage
					}) }),
					error ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						role: "alert",
						style: styles.error,
						children: error
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						autoFocus: true,
						style: buttonStyle(busy, true),
						disabled: busy,
						onClick: () => {
							acknowledge();
						},
						children: copy.gotIt
					})
				]
			});
		}
		function WelcomeHost() {
			const [identity, setIdentity] = (0, react.useState)();
			const monitor = (0, react.useRef)();
			const acknowledging = (0, react.useRef)(false);
			(0, react.useEffect)(() => {
				const watcher = watchWelcome(setIdentity);
				monitor.current = watcher;
				return () => {
					monitor.current = void 0;
					watcher.dispose();
				};
			}, []);
			const acknowledge = async (shown) => {
				if (acknowledging.current) throw new RequestError();
				acknowledging.current = true;
				try {
					await acknowledgeWelcome(shown);
					if (monitor.current) setIdentity((current) => current?.clientId === shown.clientId && current.subject === shown.subject ? void 0 : current);
				} finally {
					acknowledging.current = false;
					monitor.current?.refresh();
				}
			};
			return identity ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Welcome, { onAcknowledge: () => acknowledge(identity) }, JSON.stringify([identity.clientId, identity.subject])) : null;
		}
		function OpenAiOAuthSection(_props) {
			const { status, failed: statusFailed } = (0, react.useSyncExternalStore)(subscribeStatus, getStatusSnapshot, getEmptyStatus);
			const [accounts, setAccounts] = (0, react.useState)();
			const [accountError, setAccountError] = (0, react.useState)();
			const [busy, setBusy] = (0, react.useState)(false);
			const [waiting, setWaiting] = (0, react.useState)(false);
			const [authUrl, setAuthUrl] = (0, react.useState)();
			const [error, setError] = (0, react.useState)();
			const [notice, setNotice] = (0, react.useState)();
			const [unconfirmed, setUnconfirmed] = (0, react.useState)(false), generation = (0, react.useRef)(0), accountRequest = (0, react.useRef)(0);
			(0, react.useRef)(false);
			const refreshAccounts = (0, react.useCallback)(async () => {
				const current = ++accountRequest.current, action = generation.current;
				try {
					const saved = await request("/accounts");
					if (current !== accountRequest.current || action !== generation.current) return;
					if (!Array.isArray(saved?.accounts)) throw new RequestError();
					setAccounts(saved.accounts);
					setAccountError(void 0);
				} catch {
					if (current === accountRequest.current && action === generation.current) {
						setAccounts(void 0);
						setAccountError(copy.accountFailure);
					}
				}
			}, []);
			const refresh = (0, react.useCallback)(async (invalidate = false) => {
				await Promise.all([refreshStatus(invalidate), refreshAccounts()]);
			}, [refreshAccounts]);
			(0, react.useEffect)(() => () => {
				generation.current += 1;
				accountRequest.current += 1;
			}, []);
			const hasStatus = !!status || !!statusFailed;
			(0, react.useEffect)(() => {
				if (hasStatus) refreshAccounts();
			}, [
				refreshAccounts,
				hasStatus,
				status?.activeClientId,
				status?.activeSubject,
				status?.login?.state
			]);
			(0, react.useEffect)(() => {
				if (!status || statusFailed) return;
				if (status.login?.state === "pending") setWaiting(true);
				else {
					setWaiting(false);
					setAuthUrl(void 0);
					if (status.login?.state === "failed") setError(status.login.code === "invalid_client" ? copy.clientRejected : status.login.code === "access_denied" ? copy.consentDenied : copy.failure);
				}
			}, [status, statusFailed]);
			const login = async (options, path = "/login") => {
				const popup = window.open("about:blank", "_blank");
				if (popup !== null) popup.opener = null;
				const action = ++generation.current;
				setAuthUrl(void 0);
				setBusy(true);
				setError(void 0);
				setNotice(void 0);
				setUnconfirmed(false);
				try {
					const result = await request(path, "POST", options);
					if (!isAuthorizationUrl(result?.authUrl)) throw new Error(copy.invalidUrl);
					if (action !== generation.current) {
						popup?.close();
						return;
					}
					setWaiting(true);
					if (popup === null) setAuthUrl(result.authUrl);
					else popup.location.href = result.authUrl;
					refreshStatus();
				} catch (reason) {
					popup?.close();
					if (action === generation.current) setError(reason instanceof Error && reason.message === copy.invalidUrl ? copy.invalidUrl : failureText(reason, path === "/accounts/select" ? copy.selectFailure : copy.loginFailure));
				} finally {
					if (action === generation.current) setBusy(false);
				}
			};
			const stopWaiting = async () => {
				++generation.current;
				setBusy(true);
				setWaiting(false);
				setAuthUrl(void 0);
				setError(void 0);
				try {
					await request("/login/cancel", "POST");
					setNotice(copy.stopped);
				} catch (reason) {
					setError(failureText(reason, copy.stopFailure));
				} finally {
					setBusy(false);
					await refresh();
				}
			};
			const logout = async (pendingOnly = false) => {
				++generation.current;
				setBusy(true);
				setError(void 0);
				setNotice(void 0);
				setWaiting(false);
				setAuthUrl(void 0);
				try {
					const result = await request("/logout", "POST", pendingOnly ? { pendingOnly: true } : void 0);
					if (result?.ok !== true) throw new RequestError();
					const outcome = logoutOutcome(result.revocation);
					setAccounts(void 0);
					setUnconfirmed(outcome.unconfirmed);
					setNotice(pendingOnly && result.revocation !== "not_applicable" ? outcome.unconfirmed ? copy.pendingUnknown : copy.pendingRevoked : outcome.message);
					await refresh(!pendingOnly);
				} catch (reason) {
					setError(failureText(reason, copy.logoutFailure));
					await refresh(!pendingOnly);
				} finally {
					setBusy(false);
				}
			};
			const [authMode, setAuthMode] = (0, react.useState)();
			const [authModeFailed, setAuthModeFailed] = (0, react.useState)(false);
			const [modeBusy, setModeBusy] = (0, react.useState)(false);
			const modeGeneration = (0, react.useRef)(0);
			(0, react.useEffect)(() => {
				const current = ++modeGeneration.current;
				request("/auth-mode").then((value) => {
					if (current !== modeGeneration.current) return;
					setAuthMode(value);
					setAuthModeFailed(false);
				}, () => {
					if (current !== modeGeneration.current) return;
					setAuthMode(void 0);
					setAuthModeFailed(true);
				});
				return () => {
					modeGeneration.current += 1;
				};
			}, [
				status?.authenticated,
				status?.activeClientId,
				status?.login?.state
			]);
			const switchMode = async (mode) => {
				if (modeBusy || authMode === void 0 || authMode.mode === mode) return;
				setModeBusy(true);
				setError(void 0);
				setNotice(void 0);
				try {
					const next = await request("/auth-mode", "POST", { mode });
					setAuthMode(next);
					setNotice(copy.modeSwitched.replace("{mode}", () => mode === "api" ? copy.modeApi : copy.modePlan));
					await refresh();
				} catch (reason) {
					setError(failureText(reason, copy.modeFailure));
				} finally {
					setModeBusy(false);
				}
			};
			statusIdentity(status);
			const connected = status?.authenticated === true;
			const pending = waiting || status?.login?.state === "pending";
			const locked = busy || pending;
			const active = accounts?.find((account) => account.active && account.clientId === status?.activeClientId);
			const statusLabel = status === void 0 ? statusFailed ? copy.unavailable : copy.loading : connected ? copy.connected : copy.disconnected;
			const planLabel = status?.planUsage === "enabled" ? copy.authorized : status?.planUsage === "disabled" ? copy.disabled : copy.unknown;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				style: styles.section,
				"aria-labelledby": "openai-oauth-title",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
						id: "openai-oauth-title",
						style: styles.title,
						children: copy.title
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: styles.intro,
						children: copy.intro
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: styles.card,
						"aria-busy": busy,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: styles.status,
								role: "status",
								"aria-live": "polite",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									"aria-hidden": "true",
									style: {
										...styles.dot,
										background: connected ? "var(--dsw-alias-state-success-primary)" : "var(--dsw-alias-state-idle-primary)"
									}
								}), statusLabel]
							}),
							connected && active ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
								style: styles.meta,
								children: [
									copy.active,
									": ",
									active.label
								]
							}) : connected && status?.email ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
								style: styles.meta,
								children: [
									copy.active,
									": ",
									status.email
								]
							}) : null,
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: styles.meta,
								children: connected ? planLabel : copy.consent
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: styles.meta,
								children: copy.usage
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(PrivacyNotice, {}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
								href: USAGE_URL,
								target: "_blank",
								rel: "noopener noreferrer",
								children: copy.manage
							}) }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: styles.actions,
								children: [
									connected ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										style: buttonStyle(locked),
										disabled: locked,
										onClick: () => {
											logout();
										},
										children: copy.logout
									}) : null,
									status?.pendingRevocation ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										style: buttonStyle(locked),
										disabled: locked,
										onClick: () => {
											logout(true);
										},
										children: copy.pendingRevocation
									}) : null,
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										style: buttonStyle(busy),
										disabled: busy,
										onClick: () => {
											refresh();
										},
										children: copy.refresh
									}),
									pending ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										style: buttonStyle(busy),
										disabled: busy,
										onClick: () => {
											stopWaiting();
										},
										children: copy.stop
									}) : null
								]
							}),
							pending ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
								style: styles.meta,
								role: "status",
								children: [
									copy.waiting,
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("br", {}),
									copy.waitingHelp
								]
							}) : null,
							authUrl ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
								href: authUrl,
								target: "_blank",
								rel: "noopener noreferrer",
								onClick: () => setAuthUrl(void 0),
								children: copy.popupBlocked
							}) }) : null,
							statusFailed ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: styles.meta,
								role: "status",
								children: copy.statusFailure
							}) : null,
							notice ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: styles.meta,
								role: "status",
								children: notice
							}) : null,
							error ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
								style: styles.error,
								role: "alert",
								children: [copy.errorPrefix, error]
							}) : null,
							connected || unconfirmed || status?.pendingRevocation || status?.login?.code === "invalid_client" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
								style: styles.meta,
								children: [
									copy.signOutInfo,
									" ",
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
										href: SETTINGS_URL,
										target: "_blank",
										rel: "noopener noreferrer",
										children: copy.settings
									})
								]
							}) : null,
							authMode !== void 0 || authModeFailed ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: styles.group,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
										style: styles.heading,
										children: copy.authMode
									}),
									authMode === void 0 || authModeFailed ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										style: styles.meta,
										role: "status",
										children: copy.modeUnavailable
									}) : authMode.mode === "missing" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										style: styles.meta,
										children: copy.modeNoRoute
									}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										style: styles.meta,
										children: copy.authModeHint
									}),
									authMode !== void 0 && !authModeFailed && authMode.mode !== "missing" && !authMode.canSwitch ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										style: styles.meta,
										children: copy.modeNoEditor
									}) : null,
									authMode !== void 0 && !authModeFailed && authMode.mode !== "missing" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										style: styles.actions,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											style: buttonStyle(modeBusy || !authMode.canSwitch || authMode.mode === "plan", authMode.mode === "plan"),
											disabled: modeBusy || !authMode.canSwitch || authMode.mode === "plan",
											onClick: () => {
												switchMode("plan");
											},
											children: copy.usePlan
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											style: buttonStyle(modeBusy || !authMode.canSwitch || authMode.mode === "api" || !authMode.apiKeyAvailable, authMode.mode === "api"),
											disabled: modeBusy || !authMode.canSwitch || authMode.mode === "api" || !authMode.apiKeyAvailable,
											onClick: () => {
												switchMode("api");
											},
											children: copy.useApiKey
										})]
									}) : null,
									authMode !== void 0 && !authModeFailed && authMode.mode === "plan" && !authMode.signedIn ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										style: styles.meta,
										children: copy.planNeedsSignIn
									}) : null,
									authMode !== void 0 && !authModeFailed && !authMode.apiKeyAvailable ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										style: styles.meta,
										children: copy.apiKeyMissing
									}) : null,
									authMode !== void 0 && !authModeFailed && authMode.mode === "other" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										style: styles.meta,
										children: copy.modeUnknown
									}) : null
								]
							}) : null,
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: styles.group,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
										style: styles.heading,
										children: copy.accounts
									}),
									accountError ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										role: "alert",
										style: styles.error,
										children: accountError
									}) : null,
									accounts?.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										style: styles.meta,
										children: copy.noAccounts
									}) : null,
									accounts?.map((account) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										style: styles.account,
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: account.label }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												style: styles.meta,
												children: [account.active ? `${copy.active} · ` : "", account.signedIn ? copy.signedIn : copy.signedOut]
											}),
											!account.active && account.signedIn ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
												style: styles.actions,
												children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
													type: "button",
													disabled: locked,
													style: buttonStyle(locked),
													onClick: () => {
														login({ clientId: account.clientId }, "/accounts/select");
													},
													children: copy.selectAccount
												})
											}) : null,
											!account.signedIn ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
												style: styles.actions,
												children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SignInButton, {
													description: `${copy.signInSaved}: ${account.label}`,
													disabled: locked,
													onClick: () => {
														login({ clientId: account.clientId });
													}
												})
											}) : null,
											account.active && account.signedIn && status?.planUsage === "disabled" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												style: styles.actions,
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SignInButton, {
													description: copy.enable,
													disabled: locked,
													onClick: () => {
														login({
															clientId: account.clientId,
															enablePlan: true
														});
													}
												}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													style: styles.meta,
													children: copy.enable
												})]
											}) : null
										]
									}, account.clientId)),
									status?.pendingRegistration ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										style: styles.actions,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: copy.pendingRegistration }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SignInButton, {
											description: copy.pendingRegistration,
											disabled: locked,
											onClick: () => {
												login({ retryRegistration: true });
											}
										})]
									}) : null,
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										style: styles.actions,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: copy.newAccount }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SignInButton, {
											description: copy.newAccount,
											disabled: locked || status === void 0 || accounts === void 0 || status.pendingRegistration === true,
											onClick: () => {
												login({ newAccount: true });
											}
										})]
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: styles.group,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
									style: styles.heading,
									children: copy.models
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									style: styles.meta,
									children: copy.modelsHint
								})]
							})
						]
					})
				]
			});
		}
		function apply(ctx) {
			ctx.effect(() => ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "openai-oauth",
				order: 11,
				label: () => copy.title
			}, OpenAiOAuthSection)), "openai-oauth.settings-section");
			ctx.effect(() => ctx.slots.inject("settings.onboarding", () => ctx.slots.register({
				name: "settings.onboarding",
				id: "openai-oauth",
				order: 100,
				label: () => copy.onboarding
			}, OpenAiOnboarding)), "openai-oauth.onboarding");
			ctx.effect(() => ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "openai-oauth-welcome",
				order: 100
			}, WelcomeHost)), "openai-oauth.welcome");
		}
		const inject = ["slots"];
		//#endregion
		exports.OpenAiOAuthSection = OpenAiOAuthSection;
		exports.OpenAiOnboarding = OpenAiOnboarding;
		exports.WelcomeHost = WelcomeHost;
		exports.acknowledgeWelcome = acknowledgeWelcome;
		exports.apply = apply;
		exports.inject = inject;
		exports.isAuthorizationUrl = isAuthorizationUrl;
		exports.logoutOutcome = logoutOutcome;
		exports.parseModels = parseModels;
		exports.statusIdentity = statusIdentity;
		exports.watchWelcome = watchWelcome;
		exports.welcomeIdentity = welcomeIdentity;
		return module.exports;
	}
});
