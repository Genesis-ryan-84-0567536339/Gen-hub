<script lang="ts">
	import { resolve } from '$app/paths';
	import CopyButton from '$lib/components/CopyButton.svelte';
	import Layout from '$lib/components/Layout.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import TweenedMetric from '$lib/components/TweenedMetric.svelte';
	import { DEFAULT_MCP_CATALOG_ID } from '$lib/constants';
	import { AdminService, UserService, type MCPCatalogServer } from '$lib/services';
	import type { TopServerUsageRow, TopToolCallRow } from '$lib/services/dashboard/types';
	import {
		compileServerAndEntries,
		topServersFromStats,
		topToolCallsFromStats
	} from '$lib/services/dashboard/utils';
	import { errors, mcpServersAndEntries } from '$lib/stores';
	import { startOfDay, endOfDay } from 'date-fns';
	import { onMount } from 'svelte';
	import { fade } from 'svelte/transition';

	let loading = $state(true);
	let loadingToolUsage = $state(true);

	let topToolCalls = $state<TopToolCallRow[]>([]);
	let topServerUsage = $state<TopServerUsageRow[]>([]);

	let mounted = $state(false);
	let currentOrigin = $state('');
	onMount(() => {
		mounted = true;
		currentOrigin = window.location.origin;
	});
	let mcpGatewayUrl = $derived(mounted && currentOrigin ? `${currentOrigin}/mcp` : '');

	const now = new Date();
	const startToday = startOfDay(now);
	const endToday = endOfDay(now);

	let deployedCatalogEntryServers = $state<MCPCatalogServer[]>([]);
	let deployedWorkspaceCatalogEntryServers = $state<MCPCatalogServer[]>([]);
	let serversData = $derived.by(() => {
		if (mcpServersAndEntries.current.loading || loading) return [];
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const seen = new Set<string>();
		const result: MCPCatalogServer[] = [];
		for (const list of [
			deployedCatalogEntryServers,
			deployedWorkspaceCatalogEntryServers,
			mcpServersAndEntries.current.servers
		]) {
			for (const server of list) {
				if (server.deleted || seen.has(server.id)) continue;
				seen.add(server.id);
				result.push(server);
			}
		}
		return result;
	});

	const serverAndEntries = $derived(mcpServersAndEntries.current);
	const { totalServers: _totalServers } = $derived(
		compileServerAndEntries(serversData, serverAndEntries.entries, false)
	);

	let todayToolCalls = $derived.by<number | null>(() => {
		if (loadingToolUsage) return null;
		return topToolCalls.reduce((acc, curr) => acc + curr.count, 0);
	});

	let configuredOauthCount = $derived.by(() => {
		return serverAndEntries.entries.filter((e) => e.oauthCredentialConfigured).length;
	});

	let activeMcpCount = $derived.by(() => {
		if (serverAndEntries.loading) return null;
		return serverAndEntries.entries.length;
	});

	onMount(async () => {
		UserService.listMcpAuditLogUsageStats({
			start_time: startToday.toISOString(),
			end_time: endToday.toISOString()
		})
			.then((stats) => {
				const statsToUse = (stats.items ?? []).filter(
					(s) =>
						!s.mcpID.startsWith('sms1') &&
						!s.mcpServerDisplayName.startsWith('nba1') &&
						!s.mcpServerDisplayName.startsWith('Obot ')
				);
				const adjustedStats = {
					...stats,
					items: statsToUse
				};
				topToolCalls = topToolCallsFromStats(adjustedStats);
				topServerUsage = topServersFromStats(adjustedStats);
			})
			.catch((error) => {
				if (error?.name === 'AbortError') return;
				errors.append(error);
			})
			.finally(() => {
				loadingToolUsage = false;
			});

		try {
			const [catalogServers, workspaceServers] = await Promise.all([
				AdminService.listAllCatalogDeployedSingleRemoteServers(DEFAULT_MCP_CATALOG_ID),
				AdminService.listAllWorkspaceDeployedSingleRemoteServers()
			]);

			deployedCatalogEntryServers = catalogServers;
			deployedWorkspaceCatalogEntryServers = workspaceServers;
		} catch (err) {
			console.error('Failed loading dashboard resources:', err);
		} finally {
			loading = false;
		}
	});

	let statCards = $derived([
		{
			id: 'active-mcps',
			label: 'MCP ĐANG BẬT',
			value: activeMcpCount,
			loading: loading || serverAndEntries.loading,
			sub: 'máy chủ MCP khả dụng'
		},
		{
			id: 'connected-agents',
			label: 'AGENT ĐÃ DUYỆT',
			value: null,
			loading: false,
			sub: 'kích hoạt ở E4'
		},
		{
			id: 'today-calls',
			label: 'TOOL CALL HÔM NAY',
			value: todayToolCalls,
			loading: loadingToolUsage,
			sub: todayToolCalls !== null ? 'ghi nhận từ 00:00 hôm nay' : 'chưa có dữ liệu'
		},
		{
			id: 'vault-count',
			label: 'CREDENTIAL',
			value: configuredOauthCount,
			loading: serverAndEntries.loading || loading,
			sub: 'OAuth đã cấu hình trong catalog'
		}
	]);

	function getMcpIcon(name: string): string {
		const lower = name.toLowerCase();
		if (lower.includes('git')) return '◉';
		if (lower.includes('drive')) return '△';
		if (lower.includes('search')) return '⌕';
		if (lower.includes('postgre') || lower.includes('db') || lower.includes('data')) return 'DB';
		if (lower.includes('file')) return '▤';
		if (lower.includes('mail')) return 'M';
		if (lower.includes('cal')) return '17';
		if (lower.includes('slack')) return '#';
		return '◈';
	}
</script>

<svelte:head>
	<title>Gen Hub | Tổng quan</title>
</svelte:head>

<Layout title="Tổng quan" subtitle="Một cổng MCP duy nhất cho toàn bộ agent của bạn">
	<div class="flex flex-col gap-5 w-full" in:fade={{ duration: 150 }}>
		<!-- 4 Stat Cards Top Row -->
		<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
			{#each statCards as stat (stat.id)}
				<div
					class="bg-white dark:bg-slate-900 border border-[#e6e9ef] dark:border-slate-800 rounded-2xl p-[18px] shadow-[0_2px_10px_rgba(31,41,55,0.03)] flex flex-col justify-between"
				>
					<div
						class="text-[12px] text-[#6b7280] dark:text-slate-400 font-bold tracking-wider uppercase"
					>
						{stat.label}
					</div>
					<div
						class="text-[28px] font-extrabold my-2 text-[#172033] dark:text-white tracking-tight"
					>
						{#if stat.loading}
							<div class="skeleton h-8 w-16 rounded-md"></div>
						{:else if stat.value !== null}
							<TweenedMetric target={stat.value} />
						{:else}
							<span class="text-slate-400 font-semibold">—</span>
						{/if}
					</div>
					<div class="text-[12px] text-[#6b7280] dark:text-slate-400 truncate">
						{stat.sub}
					</div>
				</div>
			{/each}
		</div>

		<!-- Gateway Section: Ổ cắm tổng MCP -->
		<div
			class="bg-white dark:bg-slate-900 border border-[#e6e9ef] dark:border-slate-800 rounded-2xl p-5 shadow-[0_2px_10px_rgba(31,41,55,0.03)] grid grid-cols-1 lg:grid-cols-12 gap-5 items-center"
		>
			<div class="lg:col-span-6 flex flex-col gap-1.5">
				<h3 class="text-[18px] font-bold text-[#172033] dark:text-white m-0">Ổ cắm tổng MCP</h3>
				<p class="text-[13px] text-[#6b7280] dark:text-slate-400 m-0 leading-relaxed">
					Agent chỉ kết nối vào endpoint này. Gen Hub sẽ tự định tuyến tới GitHub, Google Drive,
					Database, Search và các MCP khác theo quyền bạn cấp.
				</p>
			</div>
			<div class="lg:col-span-6 flex flex-col gap-1.5">
				<div
					class="bg-[#0f172a] text-[#e2e8f0] p-3.5 rounded-xl flex items-center gap-2.5 overflow-hidden"
				>
					<code class="font-mono text-xs truncate flex-1 text-slate-200">
						{#if mcpGatewayUrl}
							{mcpGatewayUrl}
						{:else}
							<span class="text-slate-400 italic">Đang tải endpoint runtime...</span>
						{/if}
					</code>
					{#if mcpGatewayUrl}
						<CopyButton
							text={mcpGatewayUrl}
							classes={{
								button:
									'border-0 bg-[#27324a] text-white rounded-lg px-2.5 py-1.5 font-bold text-xs hover:bg-[#344262]'
							}}
						/>
					{/if}
				</div>
				<div class="text-[12px] text-[#6b7280] dark:text-slate-400">
					Domain đang cấu hình theo runtime. Cấu hình chi tiết ở mục “Domain & Cài đặt”.
				</div>
			</div>
		</div>

		<!-- Pending Agent Requests Section -->
		<div class="flex flex-col gap-3 mt-1">
			<div class="flex items-center justify-between">
				<div>
					<h2 class="text-[16px] font-bold text-[#172033] dark:text-white m-0">
						Yêu cầu kết nối mới
					</h2>
					<p class="text-[12px] text-[#6b7280] dark:text-slate-400 mt-1 m-0">
						Agent mới phải được bạn duyệt trước khi nhìn thấy tool.
					</p>
				</div>
				<a
					href={resolve('/agent-auth-scopes')}
					class="border border-[#e6e9ef] dark:border-slate-800 bg-white dark:bg-slate-900 text-[#374151] dark:text-slate-200 px-3 py-1.5 rounded-[10px] font-bold text-[12px] hover:bg-[#f8fafc]"
				>
					Xem tất cả
				</a>
			</div>

			<div
				class="bg-white dark:bg-slate-900 border border-[#e6e9ef] dark:border-slate-800 rounded-2xl p-[18px] shadow-[0_2px_10px_rgba(31,41,55,0.03)]"
			>
				<div class="flex flex-col sm:flex-row items-start gap-3.5">
					<div
						class="size-11 rounded-[13px] bg-[#111827] text-white flex items-center justify-center font-black text-lg shrink-0"
					>
						A
					</div>
					<div class="flex-1 min-w-0">
						<div class="flex items-center gap-2 flex-wrap">
							<h4 class="text-[14px] font-bold text-[#172033] dark:text-white m-0 truncate">
								Antigravity IDE · Máy Fedora
							</h4>
							<span
								class="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800/40"
							>
								Visual Fixture · E4 Scope
							</span>
						</div>
						<div class="text-[12px] text-[#6b7280] dark:text-slate-400 mt-0.5">
							Quy trình duyệt và cấp quyền Agent (Agent Approval) sẽ được kích hoạt tại Epic E4.
						</div>

						<div class="flex flex-wrap gap-2 mt-3">
							<span
								class="px-2.5 py-1.5 border border-[#c7d2fe] rounded-lg text-xs bg-[#eef2ff] text-[#3730a3] font-bold"
								>GitHub</span
							>
							<span
								class="px-2.5 py-1.5 border border-[#c7d2fe] rounded-lg text-xs bg-[#eef2ff] text-[#3730a3] font-bold"
								>Google Drive</span
							>
							<span
								class="px-2.5 py-1.5 border border-[#c7d2fe] rounded-lg text-xs bg-[#eef2ff] text-[#3730a3] font-bold"
								>Web Search</span
							>
							<span
								class="px-2.5 py-1.5 border border-[#e6e9ef] dark:border-slate-800 rounded-lg text-xs bg-[#fafafa] dark:bg-slate-800 text-slate-500"
								>Database</span
							>
							<span
								class="px-2.5 py-1.5 border border-[#e6e9ef] dark:border-slate-800 rounded-lg text-xs bg-[#fafafa] dark:bg-slate-800 text-slate-500"
								>Filesystem</span
							>
						</div>

						<div class="flex flex-wrap gap-2 mt-3.5">
							<button
								class="bg-[#4f46e5] border border-[#4f46e5] text-white px-3 py-2 rounded-[10px] font-bold text-[13px] opacity-60 cursor-not-allowed"
								disabled
							>
								Duyệt kết nối (Kích hoạt ở E4)
							</button>
							<button
								class="border border-[#e6e9ef] dark:border-slate-800 bg-white dark:bg-slate-900 text-[#374151] dark:text-slate-300 px-3 py-2 rounded-[10px] font-bold text-[13px] opacity-60 cursor-not-allowed"
								disabled
							>
								Cấp toàn bộ tool
							</button>
							<button
								class="border border-[#fecaca] bg-[#fef2f2] text-[#dc2626] px-3 py-2 rounded-[10px] font-bold text-[13px] opacity-60 cursor-not-allowed"
								disabled
							>
								Từ chối
							</button>
						</div>
					</div>
				</div>
			</div>
		</div>

		<!-- Active MCPs Section: MCP đang dùng -->
		<div class="flex flex-col gap-3 mt-1">
			<div class="flex items-center justify-between">
				<div>
					<h2 class="text-[16px] font-bold text-[#172033] dark:text-white m-0">MCP đang dùng</h2>
					<p class="text-[12px] text-[#6b7280] dark:text-slate-400 mt-1 m-0">
						Danh sách máy chủ MCP khả dụng trong Gen Hub.
					</p>
				</div>
				<a
					href={resolve('/mcp-catalog')}
					class="border border-[#e6e9ef] dark:border-slate-800 bg-white dark:bg-slate-900 text-[#374151] dark:text-slate-200 px-3 py-1.5 rounded-[10px] font-bold text-[12px] hover:bg-[#f8fafc]"
				>
					Quản lý MCP
				</a>
			</div>

			{#if serverAndEntries.loading}
				<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
					{#each Array.from({ length: 3 }) as _, i (i)}
						<Skeleton type="card" class="h-32 rounded-2xl" />
					{/each}
				</div>
			{:else if serverAndEntries.entries.length === 0}
				<div
					class="bg-white dark:bg-slate-900 border border-[#e6e9ef] dark:border-slate-800 rounded-2xl p-8 text-center text-xs text-slate-400"
				>
					Chưa có MCP Catalog Entry nào được khởi tạo.
				</div>
			{:else}
				<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
					{#each serverAndEntries.entries.slice(0, 6) as entry (entry.id)}
						{@const name = entry.manifest?.name || entry.id}
						{@const desc = entry.manifest?.description || 'Dịch vụ kết nối tích hợp'}
						<div
							class="bg-white dark:bg-slate-900 border border-[#e6e9ef] dark:border-slate-800 rounded-2xl p-4 shadow-[0_2px_10px_rgba(31,41,55,0.03)] flex flex-col justify-between"
						>
							<div class="flex justify-between items-start gap-3">
								<div class="flex gap-2.5 min-w-0">
									<div
										class="size-[38px] rounded-[10px] bg-[#f3f4f6] dark:bg-slate-800 flex items-center justify-center text-[19px] font-bold text-slate-700 dark:text-slate-200 shrink-0"
									>
										{#if entry.manifest?.icon}
											<img src={entry.manifest.icon} alt={name} class="size-6 object-contain" />
										{:else}
											{getMcpIcon(name)}
										{/if}
									</div>
									<div class="flex flex-col min-w-0">
										<h4
											class="text-[14px] font-bold text-[#172033] dark:text-white m-0 truncate leading-tight"
										>
											{name}
										</h4>
										<small class="text-xs text-[#6b7280] dark:text-slate-400 truncate mt-0.5">
											{desc}
										</small>
									</div>
								</div>

								<span
									class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#ecfdf5] text-[#059669] dark:bg-emerald-950/40 dark:text-[#34d399]"
								>
									Khả dụng
								</span>
							</div>

							<div
								class="flex justify-between items-center mt-3.5 pt-3 border-t border-[#e6e9ef] dark:border-slate-800 text-xs text-[#6b7280] dark:text-slate-400"
							>
								<span
									class="font-medium flex items-center gap-1 text-[#059669] dark:text-[#34d399]"
								>
									● Đang hoạt động
								</span>
								<span class="truncate">
									{#if entry.oauthCredentialConfigured}
										OAuth đã cấu hình
									{:else}
										Chưa có OAuth credential
									{/if}
								</span>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	</div>
</Layout>
