<script lang="ts">
	import { resolve } from '$app/paths';
	import CopyButton from '$lib/components/CopyButton.svelte';
	import Layout from '$lib/components/Layout.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import TweenedMetric from '$lib/components/TweenedMetric.svelte';
	import TokenUsageTimelineCard from '$lib/components/admin/token-usage/TokenUsageTimelineCard.svelte';
	import { formatTokenUsageUSD } from '$lib/components/admin/token-usage/tokenUsageTimeline';
	import { DEFAULT_MCP_CATALOG_ID } from '$lib/constants';
	import { formatNumber } from '$lib/format';
	import Loading from '$lib/icons/Loading.svelte';
	import { stripMarkdownToText } from '$lib/markdown';
	import {
		AdminService,
		UserService,
		type MCPCatalogServer,
		type OrgUser,
		type TotalTokenUsage
	} from '$lib/services';
	import type { TopServerUsageRow, TopToolCallRow } from '$lib/services/dashboard/types';
	import {
		avgToolCallResponseTimeFromStats,
		compileServerAndEntries,
		topServersFromStats,
		topToolCallsFromStats
	} from '$lib/services/dashboard/utils';
	import { getMCPDisplayName } from '$lib/services/user/mcp';
	import { errors, mcpServersAndEntries, profile, version } from '$lib/stores';
	import {
		Activity,
		ChevronRight,
		CircleDollarSign,
		Coins,
		RadioTower,
		Server,
		ShieldAlert,
		Users,
		Wrench,
		ArrowUpRight,
		ShieldCheck,
		Lock,
		CheckCircle2,
		AlertCircle,
		Sparkles
	} from '@lucide/svelte';
	import { isWithinInterval, subMonths } from 'date-fns';
	import { onMount } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { twMerge } from 'tailwind-merge';

	let loading = $state(true);
	let loadingToolUsage = $state(true);

	let usersData = $state<OrgUser[]>([]);
	let totalTokensData = $state<TotalTokenUsage>();

	let topToolCalls = $state<TopToolCallRow[]>([]);
	let topServerUsage = $state<TopServerUsageRow[]>([]);

	let mounted = $state(false);
	let currentOrigin = $state('');
	onMount(() => {
		mounted = true;
		currentOrigin = window.location.origin;
	});
	let mcpGatewayUrl = $derived(mounted && currentOrigin ? `${currentOrigin}/mcp` : '');

	const end = new Date();
	const start = subMonths(end, 1);

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
	const { popularServers, totalServers } = $derived(
		compileServerAndEntries(serversData, serverAndEntries.entries, false)
	);

	let totalKnownTools = $derived.by<number | null>(() => {
		if (serverAndEntries.loading || loading) return null;
		let count = 0;
		let hasKnownPreviews = false;
		for (const entry of serverAndEntries.entries) {
			const preview = entry.manifest?.toolPreview;
			if (preview && preview.length > 0) {
				count += preview.length;
				hasKnownPreviews = true;
			}
		}
		return hasKnownPreviews ? count : null;
	});

	let todayToolCalls = $derived.by<number | null>(() => {
		if (loadingToolUsage) return null;
		return topToolCalls.reduce((acc, curr) => acc + curr.count, 0);
	});

	onMount(async () => {
		UserService.listMcpAuditLogUsageStats({
			start_time: start.toISOString(),
			end_time: end.toISOString()
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
			const [users, tokens, catalogServers, workspaceServers] = await Promise.all([
				UserService.listUsersIncludeDeleted(),
				AdminService.listTotalTokenUsage({ start, end }),
				AdminService.listAllCatalogDeployedSingleRemoteServers(DEFAULT_MCP_CATALOG_ID),
				AdminService.listAllWorkspaceDeployedSingleRemoteServers()
			]);

			usersData = users;
			totalTokensData = tokens;
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
			value: serverAndEntries.entries.length,
			loading: serverAndEntries.loading || loading,
			icon: RadioTower,
			color: 'text-indigo-600 dark:text-indigo-400',
			bgColor: 'bg-indigo-50 dark:bg-indigo-950/40',
			href: '/mcp-catalog',
			sublabel: `${totalServers} server instance đang triển khai`
		},
		{
			id: 'connected-agents',
			label: 'AGENT KẾT NỐI',
			value: usersData.length,
			loading,
			icon: Users,
			color: 'text-emerald-600 dark:text-emerald-400',
			bgColor: 'bg-emerald-50 dark:bg-emerald-950/40',
			href: '/agent-auth-scopes',
			sublabel: 'Agent identities / API Keys'
		},
		{
			id: 'granted-tools',
			label: 'TOOL ĐANG CẤP',
			value: totalKnownTools,
			loading: serverAndEntries.loading || loading,
			icon: Wrench,
			color: 'text-blue-600 dark:text-blue-400',
			bgColor: 'bg-blue-50 dark:bg-blue-950/40',
			href: '/mcp-catalog',
			sublabel: totalKnownTools !== null ? 'Tool khai báo trong catalog' : 'Chưa có dữ liệu runtime'
		},
		{
			id: 'today-calls',
			label: 'TOOL CALLS (30 NGÀY)',
			value: todayToolCalls,
			loading: loadingToolUsage,
			icon: Activity,
			color: 'text-amber-600 dark:text-amber-400',
			bgColor: 'bg-amber-50 dark:bg-amber-950/40',
			href: '/admin/audit-logs',
			sublabel: 'Ghi nhận từ Audit log native'
		}
	]);
</script>

<svelte:head>
	<title>Gen Hub | Tổng quan</title>
</svelte:head>

<Layout title="Tổng quan" subtitle="Trung tâm Giám sát Cổng Composite MCP">
	<div class="flex flex-col gap-6 w-full max-w-7xl" in:fade={{ duration: 150 }}>
		<!-- 4 Stat Cards Top Row -->
		<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
			{#each statCards as stat (stat.id)}
				<a
					href={resolve(stat.href as `/${string}`)}
					class="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs transition-all duration-200 hover:border-indigo-300 hover:shadow-md dark:border-slate-800 dark:bg-slate-900 flex flex-col justify-between group"
				>
					<div class="flex items-center justify-between">
						<span class="text-[11px] font-bold text-slate-500 dark:text-slate-400 tracking-wider uppercase">
							{stat.label}
						</span>
						<div class={twMerge('size-8 rounded-xl flex items-center justify-center', stat.bgColor)}>
							<stat.icon class={twMerge('size-4', stat.color)} />
						</div>
					</div>
					<div class="mt-4">
						{#if stat.loading}
							<div class="skeleton h-8 w-16 rounded-md"></div>
						{:else if stat.value !== null}
							<div class="text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
								<TweenedMetric target={stat.value} />
							</div>
						{:else}
							<div class="text-2xl font-bold text-slate-400 dark:text-slate-500 tracking-tight">
								—
							</div>
						{/if}
						<div class="text-xs text-slate-400 mt-1 flex items-center justify-between">
							<span>{stat.sublabel}</span>
							<ChevronRight class="size-3.5 opacity-0 group-hover:opacity-100 transition-opacity text-slate-400" />
						</div>
					</div>
				</a>
			{/each}
		</div>

		<!-- Middle Row: Composite Gateway Banner & Pending Connection Card -->
		<div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
			<!-- Composite Gateway Card (8 cols) -->
			<div class="lg:col-span-8 rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-900 via-indigo-950 to-slate-950 p-6 text-white shadow-md flex flex-col justify-between relative overflow-hidden">
				<div class="absolute -right-10 -bottom-10 size-60 rounded-full bg-indigo-500/10 blur-2xl pointer-events-none"></div>
				<div class="relative z-10">
					<div class="flex items-center gap-2 mb-2">
						<span class="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold tracking-wider uppercase bg-indigo-500/30 text-indigo-200 border border-indigo-400/30">
							SSOT GATEWAY
						</span>
						<span class="inline-flex items-center gap-1 text-[11px] text-emerald-400 font-medium">
							<CheckCircle2 class="size-3.5" /> Sẵn sàng kết nối
						</span>
					</div>
					<h2 class="text-xl font-bold tracking-tight text-white mb-2">
						Composite MCP Gateway
					</h2>
					<p class="text-xs text-indigo-200/80 max-w-xl leading-relaxed">
						Mọi AI Agent và IDE (Cursor, VS Code, Windsurf) chỉ cần kết nối vào <strong>một Endpoint MCP duy nhất</strong>. Hub tự động điều phối quyền gọi tool, giữ kín secret nguồn và ghi nhận toàn bộ audit trail.
					</p>

					<div class="mt-5 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
						<div class="bg-black/40 backdrop-blur-md rounded-xl px-4 py-2.5 font-mono text-xs text-indigo-200 border border-indigo-500/30 flex-1 truncate flex items-center justify-between min-h-10">
							{#if mcpGatewayUrl}
								<span class="truncate">{mcpGatewayUrl}</span>
							{:else}
								<span class="text-slate-400 italic">Đang tải endpoint runtime...</span>
							{/if}
						</div>
						<div class="flex items-center gap-2">
							{#if mcpGatewayUrl}
								<CopyButton text={mcpGatewayUrl} classes={{ button: 'btn btn-primary btn-sm text-xs' }} />
							{/if}
							<a href="/domain" class="btn btn-ghost btn-sm text-white hover:bg-white/10 text-xs">
								Chi tiết Domain
							</a>
						</div>
					</div>
				</div>
			</div>

			<!-- Pending Agent Requests (4 cols) -->
			<div class="lg:col-span-4 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-xs dark:border-slate-800 dark:bg-slate-900 flex flex-col justify-between">
				<div>
					<div class="flex items-center justify-between mb-3">
						<h3 class="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
							<ShieldCheck class="size-4 text-indigo-600 dark:text-indigo-400" />
							<span>Yêu cầu kết nối Agent</span>
						</h3>
					</div>
					<p class="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
						Chính sách <strong>Dangerous-by-default</strong> yêu cầu mọi Agent mới phải được phê duyệt tường minh trước khi nhận quyền gọi tool.
					</p>
				</div>

				<div class="my-4 p-4 rounded-xl border border-dashed border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 text-center flex flex-col items-center justify-center gap-1.5">
					<Lock class="size-5 text-slate-400" />
					<span class="text-xs font-semibold text-slate-600 dark:text-slate-300">Tính năng phê duyệt kết nối</span>
					<span class="text-[11px] text-slate-400">Quy trình Agent Approval & Pending State sẽ được kích hoạt tại Epic E4.</span>
				</div>

				<a
					href="/agent-auth-scopes"
					class="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center justify-center gap-1 pt-1"
				>
					Xem danh sách Agent Identities <ChevronRight class="size-3" />
				</a>
			</div>
		</div>

		<!-- Active MCPs Grid Section -->
		<div class="flex flex-col gap-4">
			<div class="flex items-center justify-between">
				<div>
					<h3 class="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
						<RadioTower class="size-5 text-indigo-600 dark:text-indigo-400" />
						<span>MCP Đang Hoạt Động Trên Hub</span>
					</h3>
					<p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
						Danh mục MCP được cấp quyền qua Composite Gateway cho các Agent.
					</p>
				</div>
				<a
					href="/mcp-catalog"
					class="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1"
				>
					Xem toàn bộ kho MCP ({serverAndEntries.entries.length}) <ChevronRight class="size-3" />
				</a>
			</div>

			{#if serverAndEntries.loading}
				<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
					{#each Array.from({ length: 3 }) as _, i (i)}
						<Skeleton type="card" class="h-44 rounded-2xl" />
					{/each}
				</div>
			{:else if serverAndEntries.entries.length === 0}
				<div class="rounded-2xl border border-slate-200/80 bg-white p-12 text-center text-slate-400 dark:border-slate-800 dark:bg-slate-900">
					Chưa có MCP Catalog Entry nào được khởi tạo.
				</div>
			{:else}
				<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
					{#each serverAndEntries.entries.slice(0, 6) as entry (entry.id)}
						{@const knownTools = entry.manifest?.toolPreview?.length}
						{@const isCatalogConfigured = !entry.oauthCredentialConfigured && entry.manifest?.runtime === 'remote' && entry.manifest?.remoteConfig?.staticOAuthRequired ? false : true}
						<div class="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900 flex flex-col justify-between hover:border-slate-300 dark:hover:border-slate-700 transition-colors">
							<div>
								<div class="flex items-start justify-between gap-3 mb-3">
									<div class="flex items-center gap-3 min-w-0">
										{#if entry.manifest?.icon}
											<img src={entry.manifest.icon} alt={entry.manifest.name} class="size-9 rounded-xl p-1 bg-slate-100 dark:bg-slate-800 shrink-0" />
										{:else}
											<div class="size-9 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 flex items-center justify-center shrink-0">
												<Server class="size-5" />
											</div>
										{/if}
										<div class="flex flex-col min-w-0">
											<h4 class="text-sm font-bold text-slate-900 dark:text-white truncate">
												{entry.manifest?.name || entry.id}
											</h4>
											<span class="text-[11px] text-slate-400 truncate">
												{entry.manifest?.runtime === 'composite' ? 'Composite Layer' : 'Remote MCP'}
											</span>
										</div>
									</div>
									{#if isCatalogConfigured}
										<span class="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/40 shrink-0">
											SẴN SÀNG
										</span>
									{:else}
										<span class="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 border border-amber-200 dark:border-amber-800/40 shrink-0">
											CẦN AUTH
										</span>
									{/if}
								</div>

								<p class="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 min-h-8">
									{entry.manifest?.description || 'Dịch vụ kết nối tích hợp trong hệ thống Gateway.'}
								</p>
							</div>

							<div class="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs">
								<span class="font-medium text-slate-600 dark:text-slate-300">
									{knownTools !== undefined ? `${knownTools} tools khai báo` : 'Chưa có dữ liệu tool'}
								</span>
								<a
									href={`/mcp-catalog/c/${entry.id}?view=tools`}
									class="text-indigo-600 dark:text-indigo-400 font-semibold hover:underline flex items-center gap-1"
								>
									Quản lý tool <ChevronRight class="size-3" />
								</a>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	</div>
</Layout>
