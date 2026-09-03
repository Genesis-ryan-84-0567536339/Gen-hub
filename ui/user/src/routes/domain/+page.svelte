<script lang="ts">
	import CopyButton from '$lib/components/CopyButton.svelte';
	import Layout from '$lib/components/Layout.svelte';
	import { profile } from '$lib/stores';
	import {
		Globe,
		Lock,
		RadioTower,
		KeyRound,
		Info,
		CheckCircle2,
		AlertCircle,
		Terminal,
		ArrowRight
	} from '@lucide/svelte';
	import { onMount } from 'svelte';
	import { fade } from 'svelte/transition';

	let mounted = $state(false);
	let currentHost = $state('');
	let currentOrigin = $state('');
	let isHttps = $state(false);

	onMount(() => {
		mounted = true;
		currentHost = window.location.host;
		currentOrigin = window.location.origin;
		isHttps = window.location.protocol === 'https:';
	});

	let mcpEndpoint = $derived(mounted && currentOrigin ? `${currentOrigin}/mcp` : '');
</script>

<svelte:head>
	<title>Gen Hub | Domain & Endpoint</title>
</svelte:head>

<Layout title="Domain & Endpoint" subtitle="Thông tin kết nối & Trạng thái Gateway">
	<div class="flex flex-col gap-6 max-w-5xl w-full" in:fade={{ duration: 150 }}>
		<!-- Notice: First-run info -->
		<div class="rounded-2xl border border-indigo-100 bg-indigo-50/70 p-5 dark:border-indigo-900/40 dark:bg-indigo-950/20 text-slate-800 dark:text-slate-200">
			<div class="flex items-start gap-3">
				<Info class="size-5 text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5" />
				<div class="flex flex-col gap-1 text-sm">
					<p class="font-semibold text-indigo-950 dark:text-indigo-200">
						Cấu hình Domain & Bảo mật Cổng
					</p>
					<p class="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
						Domain gốc và chứng chỉ SSL/TLS được thiết lập trong <strong>quy trình khởi tạo First-run (E1 / TUI)</strong> khi triển khai server. Màn hình này chỉ hiển thị trạng thái hoạt động thực tế (runtime) và thông số endpoint, không chỉnh sửa trực tiếp domain nhằm bảo vệ tính toàn vẹn của kết nối Composite MCP.
					</p>
				</div>
			</div>
		</div>

		<!-- Grid of Runtime Status Cards -->
		<div class="grid grid-cols-1 md:grid-cols-3 gap-4">
			<!-- Public Host Card -->
			<div class="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900 flex flex-col justify-between">
				<div class="flex items-center justify-between mb-2">
					<div class="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
						<Globe class="size-4 text-indigo-600 dark:text-indigo-400" />
						<span>Current Host</span>
					</div>
				</div>
				<div class="bg-slate-50 dark:bg-slate-800/60 rounded-xl p-3 border border-slate-100 dark:border-slate-800 my-1 flex items-center justify-between">
					{#if mounted && currentHost}
						<code class="text-xs font-mono text-slate-800 dark:text-slate-200 truncate">{currentHost}</code>
						<CopyButton text={currentHost} />
					{:else}
						<span class="text-xs text-slate-400 italic">Đang tải...</span>
					{/if}
				</div>
				<div class="text-[11px] text-slate-500">Host nhận diện từ phiên truy cập hiện tại.</div>
			</div>

			<!-- DNS Status Card -->
			<div class="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900 flex flex-col justify-between">
				<div class="flex items-center justify-between mb-2">
					<div class="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
						<Terminal class="size-4 text-indigo-600 dark:text-indigo-400" />
						<span>DNS Status</span>
					</div>
					<span class="text-[10px] font-semibold text-slate-400">E1 Scope</span>
				</div>
				<div class="bg-slate-50 dark:bg-slate-800/60 rounded-xl p-3 border border-slate-100 dark:border-slate-800 my-1">
					<span class="text-xs font-medium text-slate-500 dark:text-slate-400">Chưa có dữ liệu runtime</span>
				</div>
				<div class="text-[11px] text-slate-500">DNS check tự động được kích hoạt tại E1.</div>
			</div>

			<!-- HTTPS Status Card -->
			<div class="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900 flex flex-col justify-between">
				<div class="flex items-center justify-between mb-2">
					<div class="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
						<Lock class="size-4 text-indigo-600 dark:text-indigo-400" />
						<span>HTTPS / SSL</span>
					</div>
					{#if mounted}
						{#if isHttps}
							<span class="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border border-emerald-200">
								<CheckCircle2 class="size-3" /> HTTPS
							</span>
						{:else}
							<span class="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 border border-amber-200">
								<AlertCircle class="size-3" /> HTTP
							</span>
						{/if}
					{/if}
				</div>
				<div class="bg-slate-50 dark:bg-slate-800/60 rounded-xl p-3 border border-slate-100 dark:border-slate-800 my-1">
					<span class="text-xs font-medium text-slate-700 dark:text-slate-300">
						{#if !mounted}
							Đang kiểm tra...
						{:else if isHttps}
							Đã bảo mật (HTTPS)
						{:else}
							HTTP / chưa có HTTPS
						{/if}
					</span>
				</div>
				<div class="text-[11px] text-slate-500">Môi trường production yêu cầu HTTPS.</div>
			</div>
		</div>

		<!-- Endpoints Section -->
		<div class="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-xs dark:border-slate-800 dark:bg-slate-900 flex flex-col gap-5">
			<div>
				<h3 class="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
					<RadioTower class="size-5 text-indigo-600 dark:text-indigo-400" />
					<span>Composite MCP Endpoint</span>
				</h3>
				<p class="text-xs text-slate-500 dark:text-slate-400 mt-1">
					Địa chỉ MCP duy nhất mà tất cả AI Agents, IDE (Cursor, VS Code, Windsurf) và CLI kết nối tới để sử dụng toàn bộ tool được ủy quyền.
				</p>
			</div>

			<div class="flex flex-col gap-2">
				<label for="mcp-endpoint-input" class="text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
					Primary MCP Gateway URL
				</label>
				<div class="flex items-center justify-between bg-slate-900 text-slate-100 rounded-xl px-4 py-3 font-mono text-sm border border-slate-800 shadow-inner min-h-12">
					{#if mcpEndpoint}
						<span id="mcp-endpoint-input" class="truncate text-indigo-300 font-medium">{mcpEndpoint}</span>
						<CopyButton text={mcpEndpoint} classes={{ button: 'btn-ghost text-white hover:bg-slate-800' }} />
					{:else}
						<span class="text-slate-400 italic text-xs">Đang tải endpoint runtime...</span>
					{/if}
				</div>
			</div>

			<div class="border-t border-slate-100 dark:border-slate-800 pt-4 flex flex-col gap-2">
				<label for="oauth-callback-input" class="text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
					<KeyRound class="size-3.5 text-slate-400" />
					<span>OAuth Callback Redirect URI</span>
				</label>
				<div class="bg-slate-50 dark:bg-slate-800/60 rounded-xl px-3 py-2 border border-slate-200 dark:border-slate-700 text-xs text-slate-500 dark:text-slate-400">
					Chưa có dữ liệu runtime (Sẽ được cấu hình chính thức tại Epic E1 / First-run setup).
				</div>
			</div>
		</div>

		<!-- Deployment Workflow Pipeline Illustration -->
		<div class="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-xs dark:border-slate-800 dark:bg-slate-900 flex flex-col gap-4">
			<h3 class="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
				<Terminal class="size-4 text-indigo-600 dark:text-indigo-400" />
				<span>Quy trình First-run Bootstrap (E1)</span>
			</h3>
			
			<div class="grid grid-cols-1 sm:grid-cols-5 gap-2 pt-2">
				<div class="flex flex-col items-center text-center p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800">
					<span class="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider">Bước 1</span>
					<span class="text-xs font-semibold mt-1">Public Domain</span>
				</div>
				<div class="flex items-center justify-center text-slate-300 dark:text-slate-700 hidden sm:flex">
					<ArrowRight class="size-4" />
				</div>
				<div class="flex flex-col items-center text-center p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800">
					<span class="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider">Bước 2</span>
					<span class="text-xs font-semibold mt-1">DNS & HTTPS</span>
				</div>
				<div class="flex items-center justify-center text-slate-300 dark:text-slate-700 hidden sm:flex">
					<ArrowRight class="size-4" />
				</div>
				<div class="flex flex-col items-center text-center p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800">
					<span class="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider">Bước 3</span>
					<span class="text-xs font-semibold mt-1">Khởi chạy Gateway</span>
				</div>
			</div>
		</div>
	</div>
</Layout>
