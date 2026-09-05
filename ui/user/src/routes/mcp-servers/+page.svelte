<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import Layout from '$lib/components/Layout.svelte';
	import Search from '$lib/components/Search.svelte';
	import { PAGE_TRANSITION_DURATION } from '$lib/constants';
	import { Group } from '$lib/services';
	import { profile } from '$lib/stores/index';
	import { setUrlParamAndUpdateUrl } from '$lib/url';
	import ConnectorsView from './ConnectorsView.svelte';
	import { Server } from '@lucide/svelte';
	import { fade, fly } from 'svelte/transition';

	let { data } = $props();

	let workspaceId = $derived(data.workspace?.id);
	let isAtLeastPowerUser = $derived(profile.current.groups.includes(Group.POWERUSER));

	let query = $derived(page.url.searchParams.get('query') || '');

	const updateSearchQuery = (value: string) => {
		setUrlParamAndUpdateUrl(page.url, 'query', value);
	};

	const duration = PAGE_TRANSITION_DURATION;
	let title = 'MCP Server Cá Nhân';
</script>

<Layout classes={{ navbar: 'bg-base-200', container: 'pt-0' }} {title}>
	{#snippet rightNavActions()}
		<a class="btn btn-primary" href={resolve('/install-cli')}>Cài đặt Gen Hub CLI</a>
	{/snippet}
	<div class="flex min-h-full flex-col gap-2" in:fade>
		{@render mainContent()}
	</div>
</Layout>

{#snippet mainContent()}
	<div
		class="flex flex-col"
		in:fly={{ x: 100, delay: duration, duration }}
		out:fly={{ x: -100, duration }}
	>
		<div class="bg-base-200 dark:bg-base-100 sticky top-16 left-0 z-20 w-full py-1">
			<div class="mb-2">
				<Search
					class="dark:bg-base-200 dark:border-base-400 bg-base-100 border border-transparent shadow-sm"
					value={query}
					onChange={updateSearchQuery}
					placeholder="Tìm kiếm server..."
				/>
			</div>
		</div>
		<ConnectorsView id={workspaceId} entity="workspace" {query}>
			{#snippet noDataContent()}
				<div class="my-12 flex w-md flex-col items-center gap-4 self-center text-center">
					<Server class="text-base-content/80 size-24 opacity-25" />
					<h4 class="text-muted-content text-lg font-semibold">Chưa có MCP Server cá nhân nào</h4>
					<p class="text-muted-content text-sm font-light">
						{#if isAtLeastPowerUser}
							Bạn chưa khởi tạo MCP Server cá nhân nào. <br />
							Hãy truy cập
							<a
								href={resolve(`${profile.current.hasAdminAccess?.() ? '/admin' : ''}/mcp-catalog`)}
								class="text-link">Kho MCP ▸ Danh mục MCP Server</a
							> để bắt đầu.
						{:else}
							Hiện tại chưa có MCP Server nào để kết nối. <br />
							Vui lòng thử lại sau hoặc liên hệ quản trị viên.
						{/if}
					</p>
				</div>
			{/snippet}
		</ConnectorsView>
	</div>
{/snippet}

<svelte:head>
	<title>Gen Hub | MCP Server Cá Nhân</title>
</svelte:head>
