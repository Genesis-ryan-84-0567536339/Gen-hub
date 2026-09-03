<script lang="ts">
	import { twMerge } from 'tailwind-merge';

	interface Props {
		class?: string;
		collapsed?: boolean;
		variant?: 'dark' | 'light' | 'auto';
	}

	let { class: klass, collapsed = false, variant = 'auto' }: Props = $props();
</script>

<div class={twMerge('flex items-center gap-3', klass)}>
	<div
		class="size-10 rounded-xl bg-gradient-to-br from-indigo-500 via-indigo-600 to-indigo-700 flex items-center justify-center text-white font-black text-xl shadow-md shadow-indigo-500/20 shrink-0"
	>
		G
	</div>
	{#if !collapsed}
		<div class="flex flex-col min-w-0">
			<div
				class={twMerge(
					'font-extrabold text-base tracking-tight truncate',
					variant === 'dark' && 'text-white',
					variant === 'light' && 'text-slate-900',
					variant === 'auto' && 'text-slate-900 dark:text-white'
				)}
			>
				Gen Hub
			</div>
			<div
				class={twMerge(
					'text-[11px] font-normal truncate',
					variant === 'dark' && 'text-slate-400',
					variant === 'light' && 'text-slate-500',
					variant === 'auto' && 'text-slate-500 dark:text-slate-400'
				)}
			>
				Personal MCP Gateway
			</div>
		</div>
	{/if}
</div>
