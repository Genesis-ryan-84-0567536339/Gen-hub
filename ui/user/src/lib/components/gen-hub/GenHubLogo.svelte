<script lang="ts">
	import { twMerge } from 'tailwind-merge';

	interface Props {
		class?: string;
		collapsed?: boolean;
	}

	let { class: klass, collapsed = false }: Props = $props();
</script>

<div class={twMerge('flex items-center gap-3', klass)}>
	<div
		class="size-10 rounded-xl bg-gradient-to-br from-indigo-500 via-indigo-600 to-indigo-700 flex items-center justify-center text-white font-black text-xl shadow-md shadow-indigo-500/20 shrink-0"
	>
		G
	</div>
	{#if !collapsed}
		<div class="flex flex-col min-w-0">
			<div class="font-extrabold text-base tracking-tight text-white flex items-center gap-1.5">
				<span>Gen Hub</span>
				<span
					class="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded-full bg-indigo-500/30 text-indigo-200 border border-indigo-400/30"
				>
					v2
				</span>
			</div>
			<div class="text-[11px] text-slate-400 font-normal truncate">Personal MCP Gateway</div>
		</div>
	{/if}
</div>
