<script lang="ts">
	import CopyButton from '$lib/components/CopyButton.svelte';
	import Layout from '$lib/components/Layout.svelte';
	import { onMount } from 'svelte';
	import { fade } from 'svelte/transition';

	let mounted = $state(false);
	let currentHost = $state('');
	let currentOrigin = $state('');

	onMount(() => {
		mounted = true;
		currentHost = window.location.host;
		currentOrigin = window.location.origin;
	});

	let mcpEndpoint = $derived(mounted && currentOrigin ? `${currentOrigin}/mcp` : '');
</script>

<svelte:head>
	<title>Gen Hub | Domain & Cài đặt</title>
</svelte:head>

<Layout title="Domain & Cài đặt" subtitle="Cấu hình domain công khai và thông số gateway">
	<div class="grid grid-cols-1 lg:grid-cols-12 gap-5 w-full" in:fade={{ duration: 150 }}>
		<!-- Left Panel: Domain của Gen Hub -->
		<div class="lg:col-span-7 bg-white dark:bg-slate-900 border border-[#e6e9ef] dark:border-slate-800 rounded-2xl p-5 shadow-[0_2px_10px_rgba(31,41,55,0.03)] flex flex-col">
			<h2 class="text-[16px] font-bold text-[#172033] dark:text-white m-0">Domain của Gen Hub</h2>
			<p class="text-[12px] text-[#6b7280] dark:text-slate-400 mt-1.5 leading-relaxed">
				Production cần domain công khai để các agent trên máy khác kết nối vào Hub.
			</p>

			<div class="mt-4 flex flex-col gap-1.5">
				<label for="domainInput" class="text-xs font-bold text-[#172033] dark:text-slate-200">Domain</label>
				<input
					id="domainInput"
					class="w-full border border-[#e6e9ef] dark:border-slate-800 rounded-[10px] p-2.5 px-3 outline-none text-sm bg-white dark:bg-slate-800 text-[#172033] dark:text-white"
					value={mounted && currentHost ? currentHost : 'Đang tải host runtime...'}
					readonly
				/>
			</div>

			<div class="mt-4 flex flex-col gap-1.5">
				<label for="endpointInput" class="text-xs font-bold text-[#172033] dark:text-slate-200">MCP Endpoint</label>
				<div class="flex items-center gap-2">
					<input
						id="endpointInput"
						class="w-full border border-[#e6e9ef] dark:border-slate-800 rounded-[10px] p-2.5 px-3 outline-none text-sm bg-[#fafafa] dark:bg-slate-800/80 text-[#172033] dark:text-white font-mono"
						value={mcpEndpoint || 'Đang tải endpoint...'}
						readonly
					/>
					{#if mcpEndpoint}
						<CopyButton text={mcpEndpoint} classes={{ button: 'btn btn-primary btn-sm text-xs' }} />
					{/if}
				</div>
			</div>

			<div class="flex items-center gap-2 mt-4">
				<button class="bg-[#4f46e5] border border-[#4f46e5] text-white px-3 py-2 rounded-[10px] font-bold text-[13px] opacity-60 cursor-not-allowed" disabled>
					Áp dụng domain (E1)
				</button>
				<button class="border border-[#e6e9ef] dark:border-slate-800 bg-white dark:bg-slate-900 text-[#374151] dark:text-slate-300 px-3 py-2 rounded-[10px] font-bold text-[13px] opacity-60 cursor-not-allowed" disabled>
					Kiểm tra DNS
				</button>
			</div>

			<div class="mt-4 p-3 px-3.5 bg-[#f8fafc] dark:bg-slate-800/40 border border-dashed border-[#d8dee9] dark:border-slate-800 rounded-[10px] text-[#64748b] dark:text-slate-400 text-xs leading-relaxed">
				First-run Setup (E1): khi làm thật, quy trình bootstrap sẽ tự kiểm tra DNS → cấu hình HTTPS → cập nhật OAuth callback → sinh endpoint MCP. Màn hình này chỉ hiển thị trạng thái runtime.
			</div>
		</div>

		<!-- Right Panel: Luồng cài đặt lần đầu -->
		<div class="lg:col-span-5 bg-white dark:bg-slate-900 border border-[#e6e9ef] dark:border-slate-800 rounded-2xl p-5 shadow-[0_2px_10px_rgba(31,41,55,0.03)] flex flex-col">
			<h2 class="text-[16px] font-bold text-[#172033] dark:text-white m-0">Luồng cài đặt lần đầu</h2>

			<div class="flex gap-3 my-3.5 items-start">
				<div class="size-7 rounded-[9px] bg-[#eef2ff] text-[#4338ca] dark:bg-indigo-950/60 dark:text-indigo-300 flex items-center justify-center font-black text-xs shrink-0">
					1
				</div>
				<div class="flex flex-col text-xs">
					<b class="text-[13px] text-[#172033] dark:text-white">Nhập domain</b>
					<p class="text-[#6b7280] dark:text-slate-400 m-0 mt-0.5 leading-normal">Ví dụ: mcp.tenmiencuaban.com</p>
				</div>
			</div>

			<div class="flex gap-3 my-3.5 items-start">
				<div class="size-7 rounded-[9px] bg-[#eef2ff] text-[#4338ca] dark:bg-indigo-950/60 dark:text-indigo-300 flex items-center justify-center font-black text-xs shrink-0">
					2
				</div>
				<div class="flex flex-col text-xs">
					<b class="text-[13px] text-[#172033] dark:text-white">Trỏ DNS về server</b>
					<p class="text-[#6b7280] dark:text-slate-400 m-0 mt-0.5 leading-normal">Gen Hub kiểm tra tự động trước khi đi tiếp.</p>
				</div>
			</div>

			<div class="flex gap-3 my-3.5 items-start">
				<div class="size-7 rounded-[9px] bg-[#eef2ff] text-[#4338ca] dark:bg-indigo-950/60 dark:text-indigo-300 flex items-center justify-center font-black text-xs shrink-0">
					3
				</div>
				<div class="flex flex-col text-xs">
					<b class="text-[13px] text-[#172033] dark:text-white">Bật HTTPS</b>
					<p class="text-[#6b7280] dark:text-slate-400 m-0 mt-0.5 leading-normal">Certificate được cấu hình cho domain.</p>
				</div>
			</div>

			<div class="flex gap-3 my-3.5 items-start">
				<div class="size-7 rounded-[9px] bg-[#eef2ff] text-[#4338ca] dark:bg-indigo-950/60 dark:text-indigo-300 flex items-center justify-center font-black text-xs shrink-0">
					4
				</div>
				<div class="flex flex-col text-xs">
					<b class="text-[13px] text-[#172033] dark:text-white">Kết nối Google / GitHub</b>
					<p class="text-[#6b7280] dark:text-slate-400 m-0 mt-0.5 leading-normal">OAuth một lần, token nằm trong vault.</p>
				</div>
			</div>

			<div class="flex gap-3 my-3.5 items-start">
				<div class="size-7 rounded-[9px] bg-[#eef2ff] text-[#4338ca] dark:bg-indigo-950/60 dark:text-indigo-300 flex items-center justify-center font-black text-xs shrink-0">
					5
				</div>
				<div class="flex flex-col text-xs">
					<b class="text-[13px] text-[#172033] dark:text-white">Cấp endpoint cho agent</b>
					<p class="text-[#6b7280] dark:text-slate-400 m-0 mt-0.5 leading-normal">Mọi agent dùng cùng một cổng MCP của Hub.</p>
				</div>
			</div>
		</div>
	</div>
</Layout>
