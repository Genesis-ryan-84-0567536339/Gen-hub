<script lang="ts">
	import CopyButton from '$lib/components/CopyButton.svelte';
	import JsonPreview from '$lib/components/JsonPreview.svelte';
	import IconButton from '$lib/components/primitives/IconButton.svelte';
	import type { AuditLogEvent } from '$lib/services';
	import { userDeviceSettings } from '$lib/stores';
	import { formatLogTimestamp } from '$lib/time';
	import { X, CheckCircle2, AlertTriangle, ShieldAlert, Clock, Terminal, Activity, FileJson } from '@lucide/svelte';
	import { twMerge } from 'tailwind-merge';

	interface Props {
		auditLog: AuditLogEvent & { user: string };
		onClose: () => void;
	}

	let { auditLog, onClose }: Props = $props();
	const details = $derived(auditLog.details);

	function hasBody(body: unknown) {
		if (body == null) return false;
		if (typeof body === 'object' && !Array.isArray(body)) return Object.keys(body).length > 0;
		return true;
	}

	function formatHeaderValue(value: string | string[]) {
		const values = Array.isArray(value) ? value : [value];
		return values.map((v) => `"${v}"`).join(', ');
	}
</script>

<div class="bg-base-200 text-base-content flex h-full w-[inherit] min-w-[inherit] flex-col">
	<!-- Inspector Header -->
	<div class="dark:bg-base-300 bg-base-100 relative flex w-full flex-col p-4 pl-5 shadow-xs border-b border-base-300 dark:border-base-400">
		<div
			class={twMerge(
				'absolute top-0 left-0 h-full w-1.5',
				auditLog.outcome.status === 'success' && 'bg-primary',
				auditLog.outcome.status === 'unknown' && 'bg-base-400',
				['failure', 'denied', 'timeout'].includes(auditLog.outcome.status) && 'bg-error'
			)}
		></div>
		
		<div class="flex items-center justify-between pr-10">
			<div class="flex items-center gap-2">
				<span class="text-xs font-bold uppercase tracking-wider text-primary">Request Inspector</span>
				<span class="text-xs text-muted-content font-mono">#{auditLog.id?.slice(0, 10)}</span>
			</div>
			<IconButton onclick={onClose} class="absolute top-4 right-4">
				<X class="size-5" />
			</IconButton>
		</div>

		<h3 class="text-lg font-bold tracking-tight mt-1 text-slate-900 dark:text-white flex items-center gap-2">
			<span>{auditLog.target.name || auditLog.action.name || auditLog.action.operation}</span>
		</h3>
		<p class="text-muted-content text-xs font-mono">
			{formatLogTimestamp(auditLog.timestamp.occurredAt, userDeviceSettings.timeFormat)}
		</p>
	</div>

	<div class="default-scrollbar-thin relative h-[calc(100%-72px)] overflow-y-auto pb-6">
		<!-- Summary Chips -->
		<div class="flex flex-wrap gap-2 py-4 px-5 border-b border-base-300 dark:border-base-400/50 bg-base-100/50 dark:bg-base-200/50">
			{@render chip('Trạng thái', auditLog.outcome.status, auditLog.outcome.status === 'success' ? 'bg-success/15 text-success' : 'bg-error/15 text-error')}
			{@render chip('Nguồn', auditLog.eventType === 'mcp_call' ? 'Composite Gateway' : 'Local Agent Hook')}
			{@render chip('Thao tác', auditLog.action.operation)}
			{@render chip('Mục tiêu', auditLog.target.targetType)}
			{#if auditLog.outcome.durationMs}
				{@render chip('Thời gian xử lý', `${auditLog.outcome.durationMs} ms`)}
			{/if}
		</div>

		<div class="px-5 flex flex-col gap-6 pt-5">
			<!-- Payload: Input Arguments -->
			<div class="flex flex-col gap-2">
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
						<Terminal class="size-4 text-indigo-600" />
						<span>Đầu vào / Tool Arguments (INPUT)</span>
					</div>
					{#if details && hasBody(details.request?.body)}
						<CopyButton
							text={typeof details.request?.body === 'string' ? details.request.body : JSON.stringify(details.request?.body, null, 2)}
							classes={{ button: 'btn-ghost btn-xs text-xs' }}
						/>
					{/if}
				</div>

				{#if details?.payloadRedacted}
					<div class="bg-base-300 text-muted-content rounded-xl p-4 text-xs italic">
						Dữ liệu đối số đầu vào bị ẩn theo chính sách phân quyền bảo mật.
					</div>
				{:else if details && hasBody(details.request?.body)}
					<div class="relative rounded-xl overflow-hidden border border-base-300 dark:border-base-400">
						<JsonPreview value={details.request?.body} ariaLabel="Request Input Arguments" maximizable />
					</div>
				{:else}
					<div class="bg-base-100 dark:bg-base-300/40 text-muted-content rounded-xl p-4 text-xs font-mono border border-dashed border-base-300 dark:border-base-400">
						(Không có tham số đầu vào / rỗng)
					</div>
				{/if}
			</div>

			<!-- Payload: Output Result -->
			<div class="flex flex-col gap-2">
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
						<FileJson class="size-4 text-emerald-600" />
						<span>Kết quả trả về / Tool Result (OUTPUT)</span>
					</div>
					{#if details && hasBody(details.response?.body)}
						<CopyButton
							text={typeof details.response?.body === 'string' ? details.response.body : JSON.stringify(details.response?.body, null, 2)}
							classes={{ button: 'btn-ghost btn-xs text-xs' }}
						/>
					{/if}
				</div>

				{#if details?.payloadRedacted}
					<div class="bg-base-300 text-muted-content rounded-xl p-4 text-xs italic">
						Kết quả trả về bị ẩn theo chính sách phân quyền bảo mật.
					</div>
				{:else if details && hasBody(details.response?.body)}
					<div class="relative rounded-xl overflow-hidden border border-base-300 dark:border-base-400">
						<JsonPreview value={details.response?.body} ariaLabel="Response Tool Result" maximizable />
					</div>
				{:else}
					<div class="bg-base-100 dark:bg-base-300/40 text-muted-content rounded-xl p-4 text-xs font-mono border border-dashed border-base-300 dark:border-base-400">
						(Không có nội dung trả về / rỗng)
					</div>
				{/if}
			</div>

			<!-- Error / Policy Block Details -->
			{#if auditLog.outcome.error || auditLog.outcome.status === 'denied'}
				<div class="flex flex-col gap-2 p-4 rounded-xl bg-error/10 border border-error/20">
					<div class="flex items-center gap-2 text-sm font-bold text-error">
						<ShieldAlert class="size-4" />
						<span>Lỗi thực thi / Quyết định chặn (POLICY / ERROR)</span>
					</div>
					<p class="text-xs font-mono text-error font-medium leading-relaxed">
						{auditLog.outcome.error || auditLog.outcome.reason || 'Yêu cầu bị từ chối do chính sách phân quyền'}
					</p>
				</div>
			{/if}

			<div class="divider my-0 text-xs font-semibold text-muted-content uppercase tracking-wider">Thông tin chi tiết (Metadata)</div>

			<!-- Event Meta Table -->
			<div class="rounded-xl border border-base-300 dark:border-base-400 bg-base-100 dark:bg-base-300/30 p-4 flex flex-col gap-2.5 text-xs">
				{@render metaRow('Request ID', details?.trace?.requestID || auditLog.id)}
				{@render metaRow('Session ID', details?.trace?.sessionID || '—')}
				{@render metaRow('Agent / Client', [details?.agent?.provider, details?.client?.name || auditLog.client].filter(Boolean).join(' / ') || '—')}
				{@render metaRow('Mã định danh Actor', auditLog.user || auditLog.actor.id || 'Unknown')}
				{@render metaRow('Quyền xác thực', auditLog.actor.credentialID || '—')}
				{@render metaRow('Target MCP', auditLog.target.parent?.name || auditLog.target.parent?.id || auditLog.target.name || '—')}
				{@render metaRow('Target Function', auditLog.target.name || auditLog.action.name || '—')}
				{@render metaRow('HTTP Code / Reason', [auditLog.outcome.httpStatus, auditLog.outcome.reason].filter(Boolean).join(' / ') || '—')}
				{@render metaRow('Ghi nhận lúc', formatLogTimestamp(auditLog.timestamp.recordedAt, userDeviceSettings.timeFormat))}
			</div>

			{#if details?.environment}
				<div class="rounded-xl border border-base-300 dark:border-base-400 bg-base-100 dark:bg-base-300/30 p-4 flex flex-col gap-2 text-xs">
					<span class="font-bold text-slate-700 dark:text-slate-300 mb-1">Môi trường Client</span>
					{@render metaRow('Working Directory', details.environment.cwd)}
					{@render metaRow('Git Commit', details.environment.gitCommit)}
					{@render metaRow('Host & User', [details.device?.hostname, details.device?.localUsername].filter(Boolean).join(' @ '))}
				</div>
			{/if}
		</div>
	</div>
</div>

{#snippet chip(label: string, value: string | undefined | null, customClass?: string)}
	{#if value}
		<div class={twMerge('rounded-full px-3 py-1 text-[11px] font-medium bg-base-300 dark:bg-base-400/80 text-base-content', customClass)}>
			<span class="opacity-70">{label}:</span> {value}
		</div>
	{/if}
{/snippet}

{#snippet metaRow(label: string, value: string | number | undefined | null)}
	{#if value !== undefined && value !== null && value !== ''}
		<div class="grid grid-cols-12 gap-2 py-0.5 border-b border-base-200 dark:border-base-400/30 last:border-0">
			<span class="col-span-4 font-semibold text-muted-content">{label}</span>
			<span class="col-span-8 font-mono break-all text-slate-800 dark:text-slate-200">{value}</span>
		</div>
	{/if}
{/snippet}
