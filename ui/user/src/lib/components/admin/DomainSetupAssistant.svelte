<script lang="ts">
	import CopyButton from '$lib/components/CopyButton.svelte';
	import {
		checkDomainDNS,
		configureDomain,
		getDomainStatus,
		type DomainDNSCheck,
		type DomainStatus
	} from '$lib/services';
	import {
		AlertCircle,
		AlertTriangle,
		ArrowRight,
		Check,
		CheckCircle2,
		ExternalLink,
		Globe,
		Lock,
		RadioTower,
		RefreshCw,
		Server,
		ShieldCheck,
		Sparkles
	} from '@lucide/svelte';
	import { onMount } from 'svelte';
	import { fade, slide } from 'svelte/transition';
	import { twMerge } from 'tailwind-merge';

	let { onDomainUpdated }: { onDomainUpdated?: (status: DomainStatus) => void } = $props();

	let status = $state<DomainStatus | null>(null);
	let loading = $state(true);
	let loadError = $state('');

	// Wizard Form State
	let domainInput = $state('');
	let enableTLS = $state(true);
	let tlsMode = $state<'letsencrypt' | 'custom' | 'none'>('letsencrypt');
	let skipDNS = $state(false);

	// DNS Check State
	let isCheckingDNS = $state(false);
	let dnsCheckResult = $state<DomainDNSCheck | null>(null);

	// Action State
	let isSaving = $state(false);
	let saveError = $state('');
	let saveSuccessMessage = $state('');
	let isEditing = $state(false);

	onMount(() => {
		void loadStatus();
	});

	async function loadStatus() {
		loading = true;
		loadError = '';
		try {
			status = await getDomainStatus();
			if (status.domain && status.domain !== 'localhost' && status.domain !== 'hub.local') {
				domainInput = status.domain;
				enableTLS = status.tlsConfigured;
				tlsMode = (status.tlsMode as 'letsencrypt' | 'custom' | 'none') || 'letsencrypt';
			}
		} catch (err) {
			loadError = err instanceof Error ? err.message : 'Không tải được trạng thái domain.';
		} finally {
			loading = false;
		}
	}

	async function handleCheckDNS() {
		const target = domainInput.trim().toLowerCase();
		if (!target) return;
		isCheckingDNS = true;
		dnsCheckResult = null;
		saveError = '';
		try {
			dnsCheckResult = await checkDomainDNS(target);
		} catch (err) {
			dnsCheckResult = {
				domain: target,
				valid: false,
				error: err instanceof Error ? err.message : 'Lỗi kiểm tra DNS.'
			};
		} finally {
			isCheckingDNS = false;
		}
	}

	async function handleSaveDomain() {
		const target = domainInput.trim().toLowerCase();
		if (!target) {
			saveError = 'Vui lòng nhập tên miền hợp lệ (ví dụ: mcp.yourcompany.com).';
			return;
		}

		isSaving = true;
		saveError = '';
		saveSuccessMessage = '';

		try {
			const updated = await configureDomain({
				domain: target,
				enableTLS: enableTLS,
				tlsMode: enableTLS ? tlsMode : 'none',
				skipDNS: skipDNS
			});

			if (updated.state === 'error' && updated.error) {
				saveError = updated.error;
			} else {
				status = updated;
				saveSuccessMessage = `Kết nối tên miền ${updated.domain} thành công!`;
				isEditing = false;
				if (onDomainUpdated) {
					onDomainUpdated(updated);
				}
			}
		} catch (err) {
			saveError = err instanceof Error ? err.message : 'Không lưu được cấu hình tên miền.';
		} finally {
			isSaving = false;
		}
	}

	let isLocalEnvironment = $derived(
		!status?.domain ||
			status.domain === 'localhost' ||
			status.domain === 'hub.local' ||
			status.state === 'unconfigured' ||
			status.state === 'dns_not_ready'
	);

	let showWizard = $derived(isLocalEnvironment || isEditing);
</script>

<div
	class="w-full bg-white dark:bg-slate-900 border border-[#e6e9ef] dark:border-slate-800 rounded-2xl p-5 shadow-[0_2px_10px_rgba(31,41,55,0.03)] flex flex-col gap-4 transition-all"
>
	<!-- Header Bar -->
	<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800/80 pb-4">
		<div class="flex items-start gap-3">
			<div
				class="p-2.5 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-100 dark:border-indigo-900/60 text-indigo-600 dark:text-indigo-400 shrink-0"
			>
				<Globe class="size-5" />
			</div>
			<div>
				<div class="flex items-center gap-2 flex-wrap">
					<h3 class="text-[16px] font-bold text-[#172033] dark:text-white m-0">
						Trợ lý Kết nối Tên miền Tự động
					</h3>
					{#if isLocalEnvironment}
						<span
							class="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300 border border-amber-200 dark:border-amber-800"
						>
							Đang chạy Localhost
						</span>
					{:else}
						<span
							class="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"
						>
							Tên miền đã kích hoạt
						</span>
					{/if}
				</div>
				<p class="text-[12px] text-[#6b7280] dark:text-slate-400 m-0 mt-0.5">
					Hỗ trợ tự động kiểm tra DNS, cấu hình SSL/TLS và mở cổng MCP cho Agent từ xa kết nối.
				</p>
			</div>
		</div>

		{#if !showWizard}
			<button
				type="button"
				onclick={() => (isEditing = true)}
				class="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors cursor-pointer"
			>
				<RefreshCw class="size-3.5" />
				<span>Thay đổi tên miền</span>
			</button>
		{/if}
	</div>

	{#if !showWizard && status?.domain}
		<!-- Active Configured View -->
		<div class="flex flex-col gap-3 py-1" in:fade={{ duration: 150 }}>
			<div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
				<div
					class="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 flex flex-col justify-between"
				>
					<span class="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Tên miền công khai</span>
					<span class="text-[14px] font-bold text-slate-900 dark:text-slate-100 font-mono mt-1">
						{status.domain}
					</span>
				</div>
				<div
					class="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 flex flex-col justify-between"
				>
					<span class="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Bảo mật HTTPS / TLS</span>
					<span class="text-[14px] font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5 mt-1">
						<Lock class="size-3.5" />
						{status.tlsActive || status.tlsConfigured ? "Let's Encrypt (Kích hoạt)" : "HTTP"}
					</span>
				</div>
				<div
					class="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 flex flex-col justify-between"
				>
					<span class="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Trạng thái DNS</span>
					<span class="text-[14px] font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5 mt-1">
						<CheckCircle2 class="size-3.5" />
						{status.dnsStatus === 'resolved' ? 'Đã trỏ chính xác' : 'Bỏ qua / Sẵn sàng'}
					</span>
				</div>
			</div>

			<div
				class="bg-[#0f172a] text-[#e2e8f0] p-3 rounded-xl flex items-center gap-2.5 overflow-hidden mt-1"
			>
				<span class="text-xs text-slate-400 font-medium shrink-0">MCP URL công khai:</span>
				<code class="font-mono text-xs truncate flex-1 text-emerald-300 font-bold">
					{status.mcpEndpoint || `https://${status.domain}/mcp`}
				</code>
				<CopyButton
					text={status.mcpEndpoint || `https://${status.domain}/mcp`}
					classes={{
						button:
							'border-0 bg-[#27324a] text-white rounded-lg px-2.5 py-1 font-bold text-xs hover:bg-[#344262]'
					}}
				/>
			</div>
		</div>
	{:else}
		<!-- Wizard Steps View -->
		<div class="flex flex-col gap-4" in:slide={{ duration: 180 }}>
			<!-- Alert Notification for Localhost -->
			<div
				class="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 text-amber-800 dark:text-amber-200 flex items-start gap-2.5 text-xs leading-relaxed"
			>
				<AlertTriangle class="size-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
				<div>
					<strong>Gen Hub đang chạy local:</strong> Các AI agent trên máy tính cá nhân có thể gọi qua <code>http://localhost:8080/mcp</code>. Nếu bạn muốn agent từ máy khác (Claude Desktop, Cursor trên laptop, v.v.) kết nối được, hãy hoàn tất 3 bước dưới đây:
				</div>
			</div>

			<div class="grid grid-cols-1 md:grid-cols-3 gap-4">
				<!-- Step 1: Nhập Domain -->
				<div
					class="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 flex flex-col gap-2.5"
				>
					<div class="flex items-center gap-2">
						<span
							class="size-6 rounded-full bg-indigo-600 text-white font-bold text-xs flex items-center justify-center"
							>1</span
						>
						<span class="text-xs font-bold text-slate-900 dark:text-white"
							>Nhập Tên miền (Domain)</span
						>
					</div>
					<p class="text-[11px] text-slate-500 dark:text-slate-400">
						Nhập tên miền riêng hoặc subdomain bạn sở hữu.
					</p>
					<input
						type="text"
						bind:value={domainInput}
						placeholder="vd: mcp.yourcompany.com"
						class="w-full px-3 py-2 text-xs font-mono font-medium rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
					/>
				</div>

				<!-- Step 2: Kiểm tra DNS -->
				<div
					class="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 flex flex-col gap-2.5"
				>
					<div class="flex items-center gap-2">
						<span
							class="size-6 rounded-full bg-indigo-600 text-white font-bold text-xs flex items-center justify-center"
							>2</span
						>
						<span class="text-xs font-bold text-slate-900 dark:text-white"
							>Kiểm tra Bản ghi DNS</span
						>
					</div>
					<p class="text-[11px] text-slate-500 dark:text-slate-400">
						Trỏ bản ghi <strong>A</strong> của tên miền về IP máy chủ của bạn.
					</p>

					<button
						type="button"
						onclick={handleCheckDNS}
						disabled={!domainInput.trim() || isCheckingDNS}
						class="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-50 dark:bg-indigo-950/70 border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 text-xs font-bold hover:bg-indigo-100 dark:hover:bg-indigo-900/60 transition-colors disabled:opacity-50 cursor-pointer"
					>
						{#if isCheckingDNS}
							<RefreshCw class="size-3.5 animate-spin" />
							<span>Đang tra cứu DNS...</span>
						{:else}
							<Globe class="size-3.5" />
							<span>Kiểm tra DNS trực tiếp</span>
						{/if}
					</button>

					{#if dnsCheckResult}
						<div
							class={twMerge(
								'p-2.5 rounded-lg text-[11px] leading-tight border',
								dnsCheckResult.valid
									? 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800'
									: 'bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800'
							)}
						>
							{#if dnsCheckResult.valid}
								<span class="font-bold">✅ DNS hợp lệ:</span>
								<span class="font-mono text-[10px] block mt-0.5">
									{(dnsCheckResult.resolvedIPs || []).join(', ')}
								</span>
							{:else}
								<span class="font-bold">⚠️ Chưa trỏ DNS:</span>
								<span class="block mt-0.5">{dnsCheckResult.error || 'Chưa tìm thấy IP'}</span>
							{/if}
						</div>
					{/if}
				</div>

				<!-- Step 3: HTTPS & TLS Mode -->
				<div
					class="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 flex flex-col gap-2.5"
				>
					<div class="flex items-center gap-2">
						<span
							class="size-6 rounded-full bg-indigo-600 text-white font-bold text-xs flex items-center justify-center"
							>3</span
						>
						<span class="text-xs font-bold text-slate-900 dark:text-white"
							>Chứng chỉ SSL / TLS</span
						>
					</div>

					<div class="flex flex-col gap-1.5 mt-0.5">
						<label class="flex items-center gap-2 text-xs font-semibold text-slate-800 dark:text-slate-200 cursor-pointer">
							<input
								type="radio"
								name="tls-mode"
								checked={enableTLS && tlsMode === 'letsencrypt'}
								onchange={() => {
									enableTLS = true;
									tlsMode = 'letsencrypt';
								}}
								class="accent-indigo-600"
							/>
							<span>Let's Encrypt TLS (Tự động)</span>
						</label>

						<label class="flex items-center gap-2 text-xs font-semibold text-slate-800 dark:text-slate-200 cursor-pointer">
							<input
								type="radio"
								name="tls-mode"
								checked={!enableTLS || tlsMode === 'none'}
								onchange={() => {
									enableTLS = false;
									tlsMode = 'none';
								}}
								class="accent-indigo-600"
							/>
							<span>HTTP thuần (Không mã hóa)</span>
						</label>

						<label class="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400 mt-1 cursor-pointer">
							<input
								type="checkbox"
								bind:checked={skipDNS}
								class="accent-indigo-600 rounded"
							/>
							<span>Bỏ qua kiểm tra DNS (Dùng Dev / Tunnel)</span>
						</label>
					</div>
				</div>
			</div>

			{#if saveError}
				<div
					class="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 text-rose-800 dark:text-rose-200 text-xs flex items-center gap-2"
				>
					<AlertCircle class="size-4 shrink-0" />
					<span>{saveError}</span>
				</div>
			{/if}

			{#if saveSuccessMessage}
				<div
					class="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 text-emerald-800 dark:text-emerald-200 text-xs flex items-center gap-2 font-semibold"
				>
					<CheckCircle2 class="size-4 shrink-0" />
					<span>{saveSuccessMessage}</span>
				</div>
			{/if}

			<!-- Action Footer -->
			<div class="flex items-center justify-between pt-2">
				<div class="text-[11px] text-slate-500 dark:text-slate-400">
					Endpoint sau khi kết nối sẽ là: <code class="font-bold text-slate-700 dark:text-slate-300 font-mono">{domainInput.trim() ? (enableTLS ? 'https://' : 'http://') + domainInput.trim() + '/mcp' : 'https://<domain>/mcp'}</code>
				</div>

				<div class="flex items-center gap-2">
					{#if isEditing}
						<button
							type="button"
							onclick={() => (isEditing = false)}
							class="px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
						>
							Hủy bỏ
						</button>
					{/if}

					<button
						type="button"
						onclick={handleSaveDomain}
						disabled={!domainInput.trim() || isSaving}
						class="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs transition-all shadow-md hover:shadow-lg disabled:opacity-50 cursor-pointer"
					>
						{#if isSaving}
							<RefreshCw class="size-3.5 animate-spin" />
							<span>Đang lưu & kích hoạt...</span>
						{:else}
							<Sparkles class="size-3.5" />
							<span>Lưu & Kích hoạt Tên miền</span>
						{/if}
					</button>
				</div>
			</div>
		</div>
	{/if}
</div>
