<script lang="ts">
	import { resolve } from '$app/paths';
	import Layout from '$lib/components/Layout.svelte';
	import { AdminService } from '$lib/services';
	import type { AuthProvider } from '$lib/services/admin/types';
	import { mcpServersAndEntries, profile } from '$lib/stores';
	import { onMount } from 'svelte';
	import { fade } from 'svelte/transition';

	let authProviders = $state<AuthProvider[]>([]);
	let loading = $state(true);

	onMount(async () => {
		try {
			if (profile.current.hasAdminAccess?.()) {
				authProviders = await AdminService.listAuthProviders();
			}
		} catch (err) {
			console.error('Failed to load auth providers:', err);
		} finally {
			loading = false;
		}
	});

	let mcpEntries = $derived(mcpServersAndEntries.current.entries);
</script>

<svelte:head>
	<title>Gen Hub | Két bảo mật</title>
</svelte:head>

<Layout title="Két bảo mật" subtitle="OAuth, API keys và token gốc chỉ được lưu tại Hub">
	<div class="flex flex-col gap-4 w-full" in:fade={{ duration: 150 }}>
		<div class="flex items-center justify-between">
			<div>
				<h2 class="text-[16px] font-bold text-[#172033] dark:text-white m-0">Két bảo mật</h2>
				<p class="text-[12px] text-[#6b7280] dark:text-slate-400 mt-1 m-0">
					OAuth, API keys và token gốc chỉ được lưu tại Hub.
				</p>
			</div>
			<button
				class="bg-[#4f46e5] border border-[#4f46e5] text-white px-3 py-2 rounded-[10px] font-bold text-[13px] opacity-60 cursor-not-allowed"
				disabled
			>
				+ Thêm credential (E5)
			</button>
		</div>

		<!-- Vault Grid (2 columns on desktop) -->
		<div class="grid grid-cols-1 md:grid-cols-2 gap-3.5">
			{#if loading}
				{#each Array.from({ length: 4 }) as _, i (i)}
					<div class="skeleton h-20 rounded-2xl"></div>
				{/each}
			{:else}
				<!-- Auth Provider Credentials -->
				{#each authProviders as provider (provider.id)}
					<div
						class="bg-white dark:bg-slate-900 border border-[#e6e9ef] dark:border-slate-800 rounded-2xl p-[17px] shadow-[0_2px_10px_rgba(31,41,55,0.03)] flex items-center justify-between gap-3"
					>
						<div class="flex items-center gap-3 min-w-0">
							<div
								class="size-[38px] rounded-[10px] bg-[#f3f4f6] dark:bg-slate-800 flex items-center justify-center text-[19px] shrink-0 font-bold text-slate-700 dark:text-slate-200"
							>
								▣
							</div>
							<div class="flex flex-col min-w-0">
								<div class="text-[14px] font-[750] text-[#172033] dark:text-white truncate">
									{provider.name}
								</div>
								<div class="font-mono text-xs text-[#6b7280] dark:text-slate-400 mt-0.5 truncate">
									Auth Provider · {provider.configured ? 'Đã cấu hình' : 'Chưa cấu hình'}
								</div>
							</div>
						</div>
						<div class="flex items-center gap-1.5 shrink-0">
							<a
								href={resolve('/admin/auth-providers')}
								class="border border-[#e6e9ef] dark:border-slate-800 bg-white dark:bg-slate-900 text-[#374151] dark:text-slate-300 px-2.5 py-1.5 rounded-[10px] font-bold text-xs hover:bg-[#f8fafc]"
							>
								Sửa
							</a>
						</div>
					</div>
				{/each}

				<!-- MCP Connectors OAuth / Credential status -->
				{#each mcpEntries.slice(0, 6) as entry (entry.id)}
					{@const name = entry.manifest?.name || entry.id}
					<div
						class="bg-white dark:bg-slate-900 border border-[#e6e9ef] dark:border-slate-800 rounded-2xl p-[17px] shadow-[0_2px_10px_rgba(31,41,55,0.03)] flex items-center justify-between gap-3"
					>
						<div class="flex items-center gap-3 min-w-0">
							<div
								class="size-[38px] rounded-[10px] bg-[#f3f4f6] dark:bg-slate-800 flex items-center justify-center text-[19px] shrink-0 font-bold text-slate-700 dark:text-slate-200"
							>
								▣
							</div>
							<div class="flex flex-col min-w-0">
								<div class="text-[14px] font-[750] text-[#172033] dark:text-white truncate">
									{name}
								</div>
								<div class="font-mono text-xs text-[#6b7280] dark:text-slate-400 mt-0.5 truncate">
									MCP Credential · {entry.oauthCredentialConfigured
										? 'OAuth credential đã cấu hình'
										: 'Chưa có OAuth credential'}
								</div>
							</div>
						</div>
						<div class="flex items-center gap-1.5 shrink-0">
							<a
								href={resolve(`/mcp-catalog/c/${entry.id}` as Parameters<typeof resolve>[0])}
								class="border border-[#e6e9ef] dark:border-slate-800 bg-white dark:bg-slate-900 text-[#374151] dark:text-slate-300 px-2.5 py-1.5 rounded-[10px] font-bold text-xs hover:bg-[#f8fafc]"
							>
								Sửa
							</a>
						</div>
					</div>
				{/each}
			{/if}
		</div>
	</div>
</Layout>
