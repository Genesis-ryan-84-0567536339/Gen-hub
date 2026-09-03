<script lang="ts">
	import { browser } from '$app/environment';
	import { toHTMLFromMarkdownWithNewTabLinks } from '$lib/markdown';
	import {
		UserService,
		type MCPCatalogEntry,
		type MCPCatalogEntryServerManifest,
		type MCPCatalogServer,
		type MCPServerTool
	} from '$lib/services';
	import { conflictIssue, duplicateToolNames, toolNameIssue } from '$lib/services/user/mcp';
	import Search from '../Search.svelte';
	import Toggle from '../Toggle.svelte';
	import IconButton from '../primitives/IconButton.svelte';
	import McpOauth from './McpOauth.svelte';
	import ToolNameIssueIcon from './ToolNameIssueIcon.svelte';
	import { CircleAlert, ChevronDown, ChevronUp, Info, Wrench, ShieldAlert, CheckCircle2, Shield, Eye, Edit3, Terminal, Lock } from '@lucide/svelte';
	import type { Snippet } from 'svelte';
	import { slide } from 'svelte/transition';
	import { twMerge } from 'tailwind-merge';

	interface Props {
		entry: MCPCatalogEntry | MCPCatalogServer;
		server?: MCPCatalogServer;
		onAuthenticate?: () => void;
		noToolsContent?: Snippet;
		classes?: {
			root?: string;
		};
		previewOverride?: MCPCatalogEntryServerManifest['toolPreview'];
		showToolNameIssues?: boolean;
	}

	let {
		entry,
		server,
		onAuthenticate,
		noToolsContent,
		classes,
		previewOverride,
		showToolNameIssues = false
	}: Props = $props();
	let search = $state('');
	let tools = $state<MCPServerTool[]>([]);
	let previewTools = $derived(previewOverride ?? getToolPreview(entry));
	let loading = $state(false);
	let previousEntryId = $state<string | undefined>(undefined);
	let previousServerId = $state<string | undefined>(undefined);
	let error = $state('');

	let expanded = $state<Record<string, boolean>>({});
	let allDescriptionsEnabled = $state(false);
	let abortController = $state<AbortController | null>(null);

	// Determine if we have "real" tools or should show previews
	let showRealTools = $derived(
		!('isCatalogEntry' in entry) || ('isCatalogEntry' in entry && server)
	);
	let showPreviewTools = $derived(previewTools.length > 0 && !showRealTools);
	let displayTools = $derived(
		(showRealTools
			? tools
			: showPreviewTools
				? previewTools.map((t) => ({ ...t, id: t.id || t.name }))
				: []
		).filter(
			(tool) =>
				tool.name.toLowerCase().includes(search.toLowerCase()) ||
				tool.description?.toLowerCase().includes(search.toLowerCase())
		)
	);

	let toolNameDuplicates = $derived(
		showToolNameIssues ? duplicateToolNames(displayTools.map((t) => t.name)) : new Set<string>()
	);

	function getToolPreview(entry: MCPCatalogEntry | MCPCatalogServer): MCPServerTool[] {
		if ('manifest' in entry) {
			return entry.manifest?.toolPreview || [];
		}
		return [];
	}

	function classifyTool(toolName: string): { label: string; color: string; isDangerous: boolean } {
		const lower = toolName.toLowerCase();
		if (
			lower.includes('delete') ||
			lower.includes('remove') ||
			lower.includes('drop') ||
			lower.includes('destroy') ||
			lower.includes('merge') ||
			lower.includes('exec') ||
			lower.includes('execute') ||
			lower.includes('run') ||
			lower.includes('send') ||
			lower.includes('post') ||
			lower.includes('write')
		) {
			return { label: 'Dangerous', color: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-400 dark:border-rose-800/40', isDangerous: true };
		}
		if (lower.includes('update') || lower.includes('create') || lower.includes('insert') || lower.includes('set') || lower.includes('patch')) {
			return { label: 'Write', color: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800/40', isDangerous: false };
		}
		return { label: 'Read', color: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700', isDangerous: false };
	}

	function handleToggleDescription(toolId: string, show: boolean) {
		if (allDescriptionsEnabled && !show) {
			allDescriptionsEnabled = false;
			for (const { id: refToolId } of displayTools) {
				if (toolId !== refToolId) {
					expanded[refToolId] = true;
				}
			}
		}

		expanded[toolId] = show;
		const expandedValues = Object.values(expanded);
		if (expandedValues.length === displayTools.length && expandedValues.every((v) => v)) {
			allDescriptionsEnabled = true;
		}
	}

	async function loadTools() {
		if (abortController) {
			abortController.abort();
		}

		abortController = new AbortController();
		loading = true;
		try {
			let id = 'isCatalogEntry' in entry && server ? server.id : entry.id;
			let toolCall = UserService.listMcpCatalogServerTools(id, {
				signal: abortController.signal
			});
			tools = await toolCall;
		} catch (err) {
			if (err instanceof DOMException && err.name === 'AbortError') return;
			error = err instanceof Error ? err.message : 'An unknown error occurred';
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		if (!showRealTools) return;
		const changedEntry = entry && (!previousEntryId || entry.id !== previousEntryId);
		const changedServer =
			(server?.id && (!previousServerId || server.id !== previousServerId)) ||
			(!server && previousServerId);
		if (changedEntry || changedServer) {
			previousEntryId = entry?.id;
			previousServerId = server?.id;
			loadTools();
		}
	});

	async function handleAuthenticate() {
		await loadTools();
		onAuthenticate?.();
	}
</script>

<div class={twMerge('flex w-full flex-col gap-4', classes?.root)}>
	{#if showPreviewTools || error}
		<div class="flex w-full flex-col items-center gap-2 md:flex-row">
			{#if showPreviewTools}
				<div class="notification-info w-full p-3 text-xs font-light rounded-xl">
					<div class="flex items-center gap-2.5">
						<Info class="size-4 shrink-0 text-indigo-600" />
						<div>
							Xem trước danh mục Tool khai báo trong manifest; chức năng bật/tắt quyền từng tool sẽ được kết nối hoàn chỉnh tại Epic E3.
						</div>
					</div>
				</div>
			{/if}
			{#if error}
				<div class="notification-error flex w-full items-center gap-2 p-3 rounded-xl">
					<CircleAlert class="size-4" />
					<div class="flex flex-col">
						<p class="text-xs font-semibold">Không thể truy xuất danh sách Tool của server</p>
						<p class="text-xs font-light">{error}</p>
					</div>
				</div>
			{/if}
		</div>
	{/if}

	{#if showRealTools}
		{#key server?.id ?? entry.id}
			<McpOauth entry={server ?? entry} onAuthenticate={handleAuthenticate} bind:error />
		{/key}
	{/if}

	<div class="flex w-full flex-col gap-3">
		<div class="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
			<Search
				class="dark:bg-base-200 dark:border-base-400 bg-base-100 border border-slate-200 shadow-xs flex-1 rounded-xl"
				onChange={(val) => (search = val)}
				placeholder="Tìm kiếm function / tool..."
			/>

			<div class="flex items-center justify-end gap-3 shrink-0">
				<Toggle
					checked={allDescriptionsEnabled}
					onChange={(checked) => {
						allDescriptionsEnabled = checked;
						expanded = {};
					}}
					label="Hiện toàn bộ mô tả"
					labelInline
					classes={{
						label: 'text-xs gap-2 text-slate-600 dark:text-slate-400'
					}}
				/>
			</div>
		</div>

		<div class="flex flex-col gap-2.5 overflow-hidden">
			{#if loading}
				{#each Array.from({ length: 3 }) as _, i (i)}
					<div class="skeleton h-16 w-full rounded-xl"></div>
				{/each}
			{:else if displayTools.length > 0}
				{#each displayTools as tool, index (`${tool.name}-${index}`)}
					{@const classification = classifyTool(tool.name)}
					{@const hasContentDisplayed = allDescriptionsEnabled || expanded[tool.id]}
					<div
						class="border border-slate-200/80 dark:bg-slate-900 dark:border-slate-800 bg-white flex flex-col gap-2 rounded-2xl p-4 shadow-xs transition-colors"
						class:pb-3={hasContentDisplayed}
					>
						<div class="flex items-center justify-between gap-3">
							<div class="flex items-center gap-2.5 min-w-0 flex-1 flex-wrap sm:flex-nowrap">
								<code class="font-mono text-sm font-bold text-slate-900 dark:text-white truncate" title={tool.name}>
									{tool.name}
								</code>

								<span
									class={twMerge('px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border shrink-0', classification.color)}
									title="Phân loại cảnh báo heuristic dựa theo quy ước đặt tên tool"
								>
									{classification.label} (Heuristic)
								</span>

								{#if classification.isDangerous}
									<span class="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-600 dark:text-rose-400 shrink-0">
										<ShieldAlert class="size-3.5" /> Thao tác rủi ro cao
									</span>
								{/if}

								{#if showToolNameIssues}
									{@const conflict = conflictIssue(tool.name, toolNameDuplicates)}
									<ToolNameIssueIcon issue={conflict ?? toolNameIssue(tool.name)} />
								{/if}
							</div>

							<div class="flex shrink-0 items-center gap-3">
								<!-- E3 Policy Tool Control (Disabled in E2) -->
								<div class="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700" title="Chính sách phân quyền từng tool sẽ được kết nối tại Epic E3">
									<Lock class="size-3 text-slate-400" />
									<span class="text-[10px] font-medium text-slate-500">Quyền: Bật (Kích hoạt ở E3)</span>
								</div>

								<IconButton
									class="btn-xs rounded-lg"
									onclick={() => handleToggleDescription(tool.id, !hasContentDisplayed)}
								>
									{#if hasContentDisplayed}
										<ChevronUp class="size-4" />
									{:else}
										<ChevronDown class="size-4" />
									{/if}
								</IconButton>
							</div>
						</div>

						{#if hasContentDisplayed}
							{#if browser}
								<div
									in:slide={{ axis: 'y' }}
									class="milkdown-content text-slate-600 dark:text-slate-400 max-w-none text-xs leading-relaxed pt-1"
								>
									{@html toHTMLFromMarkdownWithNewTabLinks(tool.description || 'Không có mô tả chi tiết.', true)}
								</div>
							{/if}
							{#if Object.keys(tool.params ?? {}).length > 0}
								<div class="mt-2 pt-2 border-t border-slate-100 dark:border-slate-800 flex flex-col gap-1.5 text-xs" in:slide={{ axis: 'y' }}>
									<span class="text-[10px] font-bold uppercase tracking-wider text-slate-400">Tham số đối số (Parameters):</span>
									<div class="flex flex-col gap-1 bg-slate-50 dark:bg-slate-800/40 p-3 rounded-xl border border-slate-100 dark:border-slate-800">
										{#each Object.keys(tool.params ?? {}) as paramKey (paramKey)}
											<div class="flex items-start gap-2">
												<code class="text-indigo-600 dark:text-indigo-400 font-mono font-semibold text-xs shrink-0">{paramKey}:</code>
												<span class="text-slate-600 dark:text-slate-400 text-xs">{tool.params?.[paramKey]}</span>
											</div>
										{/each}
									</div>
								</div>
							{/if}
						{/if}
					</div>
				{/each}
			{:else if noToolsContent}
				{@render noToolsContent()}
			{:else}
				<div class="my-12 flex w-md flex-col items-center gap-3 self-center text-center">
					<Wrench class="text-slate-300 dark:text-slate-700 size-16 opacity-50" />
					<h4 class="text-slate-700 dark:text-slate-300 text-base font-semibold">Chưa có Tool nào khả dụng</h4>
					<p class="text-slate-400 text-xs">
						{#if showRealTools}
							MCP Server này chưa khai báo hoặc chưa kích hoạt tool nào.
						{:else}
							Cần kết nối hoặc triển khai MCP Server để đồng bộ danh sách tool.
						{/if}
					</p>
				</div>
			{/if}
		</div>
	</div>
</div>
