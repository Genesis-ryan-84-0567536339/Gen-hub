<script lang="ts">
	import Layout from '$lib/components/Layout.svelte';
	import { AdminService, UserService, type OrgUser } from '$lib/services';
	import type { AuthProvider } from '$lib/services/admin/types';
	import { mcpServersAndEntries, profile } from '$lib/stores';
	import {
		Shield,
		Lock,
		KeyRound,
		RadioTower,
		Info,
		CheckCircle2,
		ExternalLink,
		Server,
		AlertTriangle
	} from '@lucide/svelte';
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

	let mcpEntriesWithAuth = $derived.by(() => {
		return mcpServersAndEntries.current.entries.filter((entry) => {
			const runtime = entry.manifest?.runtime;
			const remoteConfig = entry.manifest?.remoteConfig;
			return (
				remoteConfig?.staticOAuthRequired ||
				(entry.manifest?.env && entry.manifest.env.length > 0) ||
				(remoteConfig?.headers && remoteConfig.headers.length > 0)
			);
		});
	});
</script>

<svelte:head>
	<title>Gen Hub | Két bảo mật</title>
</svelte:head>

<Layout title="Két bảo mật" subtitle="Quản lý Chứng thực & Khóa API Tích hợp">
	<div class="flex flex-col gap-6 max-w-5xl w-full" in:fade={{ duration: 150 }}>
		<!-- Invariants Notification -->
		<div class="rounded-2xl border border-indigo-100 bg-indigo-50/70 p-5 dark:border-indigo-900/40 dark:bg-indigo-950/20 text-slate-800 dark:text-slate-200">
			<div class="flex items-start gap-3">
				<Shield class="size-5 text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5" />
				<div class="flex flex-col gap-1 text-sm">
					<p class="font-semibold text-indigo-950 dark:text-indigo-200">
						Nguyên tắc An toàn Tuyệt đối (Security Invariants)
					</p>
					<p class="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
						Mọi Secret, API Key và Token xác thực OAuth được lưu trữ và mã hóa tập trung phía Server trong Vault. AI Agent chỉ nhận quyền gọi Tool thông qua Composite Gateway và <strong>tuyệt đối không bao giờ nhận mã Token hay Mật khẩu nguồn</strong>. Secret luôn được ẩn (masked) hoàn toàn trên giao diện.
					</p>
				</div>
			</div>
		</div>

		<!-- Summary Stats -->
		<div class="grid grid-cols-1 md:grid-cols-3 gap-4">
			<div class="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
				<div class="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">
					Xác thực Hệ thống
				</div>
				<div class="flex items-baseline justify-between mt-2">
					<div class="text-2xl font-bold text-slate-900 dark:text-white">
						{authProviders.filter((p) => p.configured).length}
					</div>
					<Lock class="size-4 text-indigo-600" />
				</div>
				<div class="text-xs text-slate-500 mt-1">Nhà cung cấp danh tính (SSO/Local)</div>
			</div>

			<div class="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
				<div class="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">
					MCP Connectors Cần Khóa
				</div>
				<div class="flex items-baseline justify-between mt-2">
					<div class="text-2xl font-bold text-slate-900 dark:text-white">
						{mcpEntriesWithAuth.length}
					</div>
					<RadioTower class="size-4 text-emerald-600" />
				</div>
				<div class="text-xs text-slate-500 mt-1">Dịch vụ tích hợp cấu hình bảo mật</div>
			</div>

			<div class="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
				<div class="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">
					Chính sách Bảo mật
				</div>
				<div class="flex items-baseline justify-between mt-2">
					<div class="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
						No Plaintext Expose
					</div>
					<Shield class="size-4 text-amber-600" />
				</div>
				<div class="text-xs text-slate-500 mt-1">Không hiển thị secret thô trên UI</div>
			</div>
		</div>

		<!-- Identity & Auth Providers Section -->
		<div class="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-xs dark:border-slate-800 dark:bg-slate-900 flex flex-col gap-4">
			<div class="flex items-center justify-between">
				<div>
					<h3 class="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
						<KeyRound class="size-5 text-indigo-600 dark:text-indigo-400" />
						<span>Xác thực Cổng & Danh tính (Auth Providers)</span>
					</h3>
					<p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
						Các kết nối SSO và đăng nhập quản trị hệ thống.
					</p>
				</div>
				{#if profile.current.hasAdminAccess?.()}
					<a
						href="/admin/auth-providers"
						class="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1"
					>
						Quản lý SSO <ExternalLink class="size-3" />
					</a>
				{/if}
			</div>

			{#if loading}
				<div class="skeleton h-24 w-full rounded-xl"></div>
			{:else if authProviders.length === 0}
				<div class="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/40 text-xs text-slate-500 text-center">
					Chưa có cấu hình Auth Provider nào.
				</div>
			{:else}
				<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
					{#each authProviders as provider (provider.id)}
						<div class="p-4 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 flex items-center justify-between">
							<div class="flex items-center gap-3">
								{#if provider.icon}
									<img src={provider.icon} alt={provider.name} class="size-7 rounded-lg p-1 bg-white dark:bg-slate-700 shadow-xs" />
								{:else}
									<Lock class="size-6 text-slate-400" />
								{/if}
								<div class="flex flex-col">
									<span class="text-xs font-bold text-slate-800 dark:text-slate-200">{provider.name}</span>
									<span class="text-[10px] font-mono text-slate-400">••••••••••••••••</span>
								</div>
							</div>
							{#if provider.configured}
								<span class="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600">
									<CheckCircle2 class="size-3.5" /> Đã kết nối
								</span>
							{:else}
								<span class="text-[11px] text-slate-400">Chưa cấu hình</span>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		</div>

		<!-- MCP Connectors Auth Mapping Section -->
		<div class="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-xs dark:border-slate-800 dark:bg-slate-900 flex flex-col gap-4">
			<div class="flex items-center justify-between">
				<div>
					<h3 class="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
						<RadioTower class="size-5 text-indigo-600 dark:text-indigo-400" />
						<span>Chứng thực Dịch vụ MCP (Service Connectors)</span>
					</h3>
					<p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
						Trạng thái nạp chứng thực cho từng dịch vụ MCP trong Hub.
					</p>
				</div>
				<a
					href="/mcp-catalog"
					class="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1"
				>
					Kho MCP <ExternalLink class="size-3" />
				</a>
			</div>

			<div class="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-100 dark:border-slate-800 rounded-xl overflow-hidden">
				{#each mcpEntriesWithAuth as entry (entry.id)}
					<div class="p-4 flex items-center justify-between bg-white dark:bg-slate-900 hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors">
						<div class="flex items-center gap-3 min-w-0">
							{#if entry.manifest?.icon}
								<img src={entry.manifest.icon} alt={entry.manifest.name} class="size-8 rounded-lg p-1 bg-slate-100 dark:bg-slate-800 shrink-0" />
							{:else}
								<Server class="size-8 text-slate-400 shrink-0" />
							{/if}
							<div class="flex flex-col min-w-0">
								<span class="text-xs font-bold text-slate-900 dark:text-white truncate">
									{entry.manifest?.name || entry.id}
								</span>
								<span class="text-[11px] text-slate-400 truncate">
									{entry.manifest?.description || 'MCP Connector'}
								</span>
							</div>
						</div>

						<div class="flex items-center gap-4 shrink-0">
							<span class="text-[11px] font-mono text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded-md">
								Vault Key: ok1-****-vault
							</span>
							{#if entry.oauthCredentialConfigured}
								<span class="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600">
									<CheckCircle2 class="size-3.5" /> Sẵn sàng
								</span>
							{:else}
								<span class="text-[11px] text-slate-400 font-medium">Server Env / Auto</span>
							{/if}
						</div>
					</div>
				{:else}
					<div class="p-6 text-center text-xs text-slate-400">
						Chưa có MCP Connector nào yêu cầu chứng thực riêng.
					</div>
				{/each}
			</div>
		</div>
	</div>
</Layout>
