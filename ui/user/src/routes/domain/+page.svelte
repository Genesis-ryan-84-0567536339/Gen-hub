<script lang="ts">
	import CopyButton from '$lib/components/CopyButton.svelte';
	import Layout from '$lib/components/Layout.svelte';
	import DomainSetupAssistant from '$lib/components/admin/DomainSetupAssistant.svelte';
	import {
		checkDomainDNS,
		getDomainStatus,
		type DomainDNSCheck,
		type DomainStatus
	} from '$lib/services';
	import { onMount } from 'svelte';
	import { fade } from 'svelte/transition';

	let status = $state<DomainStatus | null>(null);
	let dnsCheck = $state<DomainDNSCheck | null>(null);
	let loading = $state(true);
	let checkingDNS = $state(false);
	let loadError = $state('');

	onMount(() => {
		void loadStatus();
	});

	async function loadStatus() {
		loading = true;
		loadError = '';
		try {
			status = await getDomainStatus();
		} catch (error) {
			loadError = error instanceof Error ? error.message : 'Không tải được trạng thái domain.';
		} finally {
			loading = false;
		}
	}

	async function runDNSCheck() {
		if (!status?.domain) return;
		checkingDNS = true;
		dnsCheck = null;
		try {
			dnsCheck = await checkDomainDNS(status.domain);
		} catch (error) {
			dnsCheck = {
				domain: status.domain,
				valid: false,
				error: error instanceof Error ? error.message : 'Không kiểm tra được DNS.'
			};
		} finally {
			checkingDNS = false;
		}
	}

	let stateLabel = $derived.by(() => {
		switch (status?.state) {
			case 'dns_not_ready':
				return 'DNS chưa sẵn sàng';
			case 'tls_pending':
				return status.tlsActive ? 'HTTPS đang hoạt động' : 'Đang chờ HTTPS';
			case 'configured':
				return 'Cấu hình nền đã lưu';
			case 'ready':
				return 'Sẵn sàng';
			case 'error':
				return 'Lỗi cấu hình';
			default:
				return 'Chưa cấu hình';
		}
	});
</script>

<svelte:head>
	<title>Gen Hub | Domain & Cài đặt</title>
</svelte:head>

<Layout title="Domain & Cài đặt" subtitle="Cấu hình domain công khai và thông số gateway">
	<div class="flex flex-col gap-5 w-full" in:fade={{ duration: 150 }}>
		<!-- Trợ lý kết nối tên miền tự động -->
		<DomainSetupAssistant onDomainUpdated={() => void loadStatus()} />

		<div class="grid grid-cols-1 lg:grid-cols-12 gap-5 w-full">
		<!-- Left Panel: Domain của Gen Hub -->
		<div
			class="lg:col-span-7 bg-white dark:bg-slate-900 border border-[#e6e9ef] dark:border-slate-800 rounded-2xl p-5 shadow-[0_2px_10px_rgba(31,41,55,0.03)] flex flex-col"
		>
			<h2 class="text-[16px] font-bold text-[#172033] dark:text-white m-0">Domain của Gen Hub</h2>
			<p class="text-[12px] text-[#6b7280] dark:text-slate-400 mt-1.5 leading-relaxed">
				Production cần domain công khai để các agent trên máy khác kết nối vào Hub.
			</p>

			<div
				class="mt-4 flex items-center justify-between rounded-[10px] border border-[#e6e9ef] bg-[#f8fafc] px-3 py-2.5 text-xs dark:border-slate-800 dark:bg-slate-800/40"
			>
				<span class="font-semibold text-[#64748b] dark:text-slate-400">Trạng thái</span>
				<span class="font-bold text-[#172033] dark:text-white"
					>{loading ? 'Đang tải...' : stateLabel}</span
				>
			</div>

			{#if loadError || status?.error}
				<div
					role="alert"
					class="mt-3 rounded-[10px] border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
				>
					{loadError || status?.error}
				</div>
			{/if}

			<div class="mt-4 flex flex-col gap-1.5">
				<label for="domainInput" class="text-xs font-bold text-[#172033] dark:text-slate-200"
					>Domain</label
				>
				<input
					id="domainInput"
					class="w-full border border-[#e6e9ef] dark:border-slate-800 rounded-[10px] p-2.5 px-3 outline-none text-sm bg-white dark:bg-slate-800 text-[#172033] dark:text-white"
					value={loading ? 'Đang tải...' : status?.domain || 'Chưa cấu hình'}
					readonly
				/>
			</div>

			<div class="mt-4 flex flex-col gap-1.5">
				<label for="endpointInput" class="text-xs font-bold text-[#172033] dark:text-slate-200"
					>MCP Endpoint</label
				>
				<div class="flex items-center gap-2">
					<input
						id="endpointInput"
						class="w-full border border-[#e6e9ef] dark:border-slate-800 rounded-[10px] p-2.5 px-3 outline-none text-sm bg-[#fafafa] dark:bg-slate-800/80 text-[#172033] dark:text-white font-mono"
						value={loading ? 'Đang tải...' : status?.mcpEndpoint || 'Chưa có endpoint'}
						readonly
					/>
					{#if status?.mcpEndpoint}
						<CopyButton
							text={status.mcpEndpoint}
							classes={{ button: 'btn btn-primary btn-sm text-xs' }}
						/>
					{/if}
				</div>
			</div>

			<div class="flex items-center gap-2 mt-4">
				<button
					class="border border-[#e6e9ef] dark:border-slate-800 bg-white dark:bg-slate-900 text-[#374151] dark:text-slate-300 px-3 py-2 rounded-[10px] font-bold text-[13px] disabled:opacity-60 disabled:cursor-not-allowed"
					disabled={!status?.domain || checkingDNS}
					onclick={runDNSCheck}
				>
					{checkingDNS ? 'Đang kiểm tra DNS...' : 'Kiểm tra DNS'}
				</button>
				<button
					class="border border-transparent text-[#4f46e5] dark:text-indigo-300 px-3 py-2 rounded-[10px] font-bold text-[13px]"
					onclick={loadStatus}
				>
					Tải lại trạng thái
				</button>
			</div>

			{#if dnsCheck}
				<div
					role="status"
					class="mt-3 rounded-[10px] border border-[#d8dee9] bg-[#f8fafc] px-3 py-2.5 text-xs text-[#64748b] dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-300"
				>
					{#if dnsCheck.valid}
						DNS đã sẵn sàng{dnsCheck.resolvedIPs?.length
							? `: ${dnsCheck.resolvedIPs.join(', ')}`
							: '.'}
					{:else}
						DNS chưa sẵn sàng: {dnsCheck.error || 'Không tìm thấy bản ghi A/AAAA.'}
					{/if}
				</div>
			{/if}

			<div
				class="mt-4 p-3 px-3.5 bg-[#f8fafc] dark:bg-slate-800/40 border border-dashed border-[#d8dee9] dark:border-slate-800 rounded-[10px] text-[#64748b] dark:text-slate-400 text-xs leading-relaxed"
			>
				Domain được cấu hình có chủ ý bằng lệnh bootstrap trên server. Trang này chỉ đọc trạng thái
				thực tế và kiểm tra DNS, không tự thay đổi cấu hình production.
			</div>
		</div>

		<!-- Right Panel: Luồng cài đặt lần đầu -->
		<div
			class="lg:col-span-5 bg-white dark:bg-slate-900 border border-[#e6e9ef] dark:border-slate-800 rounded-2xl p-5 shadow-[0_2px_10px_rgba(31,41,55,0.03)] flex flex-col"
		>
			<h2 class="text-[16px] font-bold text-[#172033] dark:text-white m-0">
				Luồng cài đặt lần đầu
			</h2>

			<div class="flex gap-3 my-3.5 items-start">
				<div
					class="size-7 rounded-[9px] bg-[#eef2ff] text-[#4338ca] dark:bg-indigo-950/60 dark:text-indigo-300 flex items-center justify-center font-black text-xs shrink-0"
				>
					1
				</div>
				<div class="flex flex-col text-xs">
					<b class="text-[13px] text-[#172033] dark:text-white">Nhập domain</b>
					<p class="text-[#6b7280] dark:text-slate-400 m-0 mt-0.5 leading-normal">
						Ví dụ: mcp.tenmiencuaban.com
					</p>
				</div>
			</div>

			<div class="flex gap-3 my-3.5 items-start">
				<div
					class="size-7 rounded-[9px] bg-[#eef2ff] text-[#4338ca] dark:bg-indigo-950/60 dark:text-indigo-300 flex items-center justify-center font-black text-xs shrink-0"
				>
					2
				</div>
				<div class="flex flex-col text-xs">
					<b class="text-[13px] text-[#172033] dark:text-white">Trỏ DNS về server</b>
					<p class="text-[#6b7280] dark:text-slate-400 m-0 mt-0.5 leading-normal">
						Gen Hub kiểm tra tự động trước khi đi tiếp.
					</p>
				</div>
			</div>

			<div class="flex gap-3 my-3.5 items-start">
				<div
					class="size-7 rounded-[9px] bg-[#eef2ff] text-[#4338ca] dark:bg-indigo-950/60 dark:text-indigo-300 flex items-center justify-center font-black text-xs shrink-0"
				>
					3
				</div>
				<div class="flex flex-col text-xs">
					<b class="text-[13px] text-[#172033] dark:text-white">Bật HTTPS</b>
					<p class="text-[#6b7280] dark:text-slate-400 m-0 mt-0.5 leading-normal">
						Certificate được cấu hình cho domain.
					</p>
				</div>
			</div>

			<div class="flex gap-3 my-3.5 items-start">
				<div
					class="size-7 rounded-[9px] bg-[#eef2ff] text-[#4338ca] dark:bg-indigo-950/60 dark:text-indigo-300 flex items-center justify-center font-black text-xs shrink-0"
				>
					4
				</div>
				<div class="flex flex-col text-xs">
					<b class="text-[13px] text-[#172033] dark:text-white">Kết nối Google / GitHub</b>
					<p class="text-[#6b7280] dark:text-slate-400 m-0 mt-0.5 leading-normal">
						OAuth một lần, token nằm trong vault.
					</p>
				</div>
			</div>

			<div class="flex gap-3 my-3.5 items-start">
				<div
					class="size-7 rounded-[9px] bg-[#eef2ff] text-[#4338ca] dark:bg-indigo-950/60 dark:text-indigo-300 flex items-center justify-center font-black text-xs shrink-0"
				>
					5
				</div>
				<div class="flex flex-col text-xs">
					<b class="text-[13px] text-[#172033] dark:text-white">Cấp endpoint cho agent</b>
					<p class="text-[#6b7280] dark:text-slate-400 m-0 mt-0.5 leading-normal">
						Mọi agent dùng cùng một cổng MCP của Hub.
					</p>
				</div>
			</div>

			<!-- Chi tiết Hướng dẫn Cấu hình Tunnel & Caddy -->
			<div class="mt-4 pt-4 border-t border-[#e6e9ef] dark:border-slate-800 flex flex-col gap-3">
				<h3 class="text-[14px] font-bold text-[#172033] dark:text-white m-0">
					🛠️ Hướng dẫn Cấu hình & Tunnel
				</h3>

				<!-- Section: DNS A Record -->
				<div
					class="p-3 bg-[#f8fafc] dark:bg-slate-800/40 rounded-xl border border-[#e6e9ef] dark:border-slate-800 text-xs"
				>
					<span class="font-bold text-[#4338ca] dark:text-indigo-400"
						>1. Trỏ DNS A Record (Public Domain)</span
					>
					<p class="text-[#6b7280] dark:text-slate-400 mt-1 mb-2">
						Tạo 2 bản ghi A trỏ về IP Public máy chủ của bạn:
					</p>
					<code class="block p-2 bg-[#1e293b] text-emerald-400 rounded-md font-mono text-[11px]">
						A &nbsp; {status?.domain || 'domain.com'} &nbsp;&rarr;&nbsp; &lt;PUBLIC_IP&gt;<br />
						A &nbsp; *.{status?.domain || 'domain.com'} &nbsp;&rarr;&nbsp; &lt;PUBLIC_IP&gt;
					</code>
				</div>

				<!-- Section: Tunnel khi sau NAT -->
				<div
					class="p-3 bg-[#f8fafc] dark:bg-slate-800/40 rounded-xl border border-[#e6e9ef] dark:border-slate-800 text-xs"
				>
					<span class="font-bold text-[#4338ca] dark:text-indigo-400"
						>2. Kết nối Tunnel (Khi nằm sau Router/NAT)</span
					>
					<p class="text-[#6b7280] dark:text-slate-400 mt-1 mb-2">
						Mở cổng ra ngoài Internet không cần trỏ Port Forwarding:
					</p>
					<div class="flex items-center gap-2">
						<code
							class="w-full p-2 bg-[#1e293b] text-emerald-400 rounded-md font-mono text-[11px] overflow-x-auto"
						>
							./bin/gen-hub tunnel --url http://localhost:8080
						</code>
						<CopyButton
							text="./bin/gen-hub tunnel --url http://localhost:8080"
							classes={{ button: 'btn btn-primary btn-sm text-xs shrink-0' }}
						/>
					</div>
				</div>

				<!-- Section: Caddy Reverse Proxy -->
				<div
					class="p-3 bg-[#f8fafc] dark:bg-slate-800/40 rounded-xl border border-[#e6e9ef] dark:border-slate-800 text-xs"
				>
					<span class="font-bold text-[#4338ca] dark:text-indigo-400"
						>3. Cấu hình Caddy (HTTPS SSL Tự động)</span
					>
					<p class="text-[#6b7280] dark:text-slate-400 mt-1 mb-2">
						Nội dung mẫu file <code class="font-mono bg-slate-200 dark:bg-slate-700 px-1 rounded"
							>Caddyfile</code
						>:
					</p>
					<div class="flex items-center gap-2">
						<pre
							class="w-full p-2 bg-[#1e293b] text-emerald-400 rounded-md font-mono text-[11px] m-0 overflow-x-auto">{status?.domain ||
								'genos.top'} &#123;&#10;  reverse_proxy localhost:8080&#10;&#125;</pre>
						<CopyButton
							text={`${status?.domain || 'genos.top'} {\n  reverse_proxy localhost:8080\n}`}
							classes={{ button: 'btn btn-primary btn-sm text-xs shrink-0' }}
						/>
					</div>
				</div>
			</div>
		</div>
	</div>
	</div>
</Layout>
