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
		class="size-9 rounded-[11px] bg-gradient-to-br from-[#7c3aed] to-[#4f46e5] flex items-center justify-center text-white font-extrabold text-base shadow-md shadow-indigo-600/30 shrink-0"
	>
		G
	</div>
	{#if !collapsed}
		<div class="flex flex-col min-w-0">
			<b
				class={twMerge(
					'text-[17px] leading-tight font-bold truncate',
					variant === 'dark' && 'text-white',
					variant === 'light' && 'text-[#172033]',
					variant === 'auto' && 'text-[#172033] dark:text-white'
				)}
			>
				Gen Hub
			</b>
			<small
				class={twMerge(
					'text-xs leading-none truncate mt-0.5',
					variant === 'dark' && 'text-[#9ca3af]',
					variant === 'light' && 'text-[#6b7280]',
					variant === 'auto' && 'text-[#6b7280] dark:text-[#9ca3af]'
				)}
			>
				MCP Gateway
			</small>
		</div>
	{/if}
</div>
