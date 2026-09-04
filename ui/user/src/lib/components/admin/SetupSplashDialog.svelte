<script lang="ts">
	import ResponsiveDialog from '../ResponsiveDialog.svelte';
	import GenHubLogo from '../gen-hub/GenHubLogo.svelte';
	import CopyField from '../CopyField.svelte';
	import Loading from '$lib/icons/Loading.svelte';
	import { ApiKeysService } from '$lib/services';
	import { profile } from '$lib/stores';
	import {
		Globe,
		KeyRound,
		RadioTower,
		ShieldCheck,
		ChevronRight,
		ChevronLeft,
		CheckCircle2,
		Sparkles,
		Terminal,
		Server,
		Check,
		ExternalLink
	} from '@lucide/svelte';
	import { onMount } from 'svelte';
	import { fade, slide } from 'svelte/transition';
	import { twMerge } from 'tailwind-merge';

	let dialog = $state<ReturnType<typeof ResponsiveDialog>>();
	let currentStep = $state(1);

	export function open() {
		currentStep = 1;
		dialog?.open();
	}

	export function close() {
		dialog?.close();
	}

	onMount(() => {
		if (typeof localStorage !== 'undefined') {
			const seen = localStorage.getItem('seenSplashDialog');
			if (!seen && profile.current.loaded) {
				open();
			}
		}
	});

	// Step 1 State: Network Domain
	let domainMode = $state<'localhost' | 'domain' | 'tunnel'>('localhost');
	let customDomain = $state('genhub.my-company.com');

	// Step 2 State: First Agent Scope
	let scopeName = $state('Claude-Code-Agent');
	let createdApiKey = $state<string | null>(null);
	let creatingKey = $state(false);

	async function handleCreateQuickScope() {
		if (creatingKey || createdApiKey) return;
		creatingKey = true;
		try {
			const res = await ApiKeysService.createApiKey({
				name: scopeName.trim() || 'My-AI-Agent',
				description: 'Phân quyền khởi tạo tự động từ Setup Wizard',
				mcpServerIds: ['*'],
				canAccessLLMProxy: true,
				canAccessSkills: true
			});
			createdApiKey = res.key;
		} catch (err) {
			console.error('Failed to create key:', err);
		} finally {
			creatingKey = false;
		}
	}

	// Step 3 State: Fast MCP Tools
	let selectedTools = $state({
		webSearch: true,
		gdrive: true,
		github: true,
		filesystem: true
	});

	function toggleTool(key: keyof typeof selectedTools) {
		selectedTools[key] = !selectedTools[key];
	}

	function handleCompleteSetup() {
		localStorage.setItem('seenSplashDialog', new Date().toISOString());
		dialog?.close();
	}
</script>

<ResponsiveDialog
	bind:this={dialog}
	class="w-full max-w-2xl bg-white dark:bg-slate-900 border border-[#e6e9ef] dark:border-slate-800 rounded-3xl p-0 overflow-hidden shadow-2xl"
>
	<div class="flex flex-col w-full">
		<!-- Header Stepper Banner -->
		<div class="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white p-6 relative">
			<div class="flex items-center justify-between">
				<div class="flex items-center gap-3">
					<GenHubLogo variant="dark" />
					<span class="text-xs px-2.5 py-1 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-400/30 font-bold uppercase tracking-wider">
						Quick Setup Wizard
					</span>
				</div>
				<button 
					onclick={close} 
					class="text-slate-400 hover:text-white text-xs font-semibold px-2 py-1 rounded-lg hover:bg-slate-800 transition-colors"
				>
					Bỏ qua
				</button>
			</div>

			<h2 class="text-xl font-bold text-white mt-4">Hướng dẫn Khởi tạo & Thiết lập Nhanh</h2>
			<p class="text-xs text-slate-300 mt-1">Hoàn tất 4 bước đơn giản để kết nối Agent của bạn với Gen Hub.</p>

			<!-- 4-Step Progress Indicator -->
			<div class="grid grid-cols-4 gap-2 mt-6">
				{#each [
					{ step: 1, label: 'Tên miền & Mạng', icon: Globe },
					{ step: 2, label: 'Scope Agent', icon: KeyRound },
					{ step: 3, label: 'MCP Catalog', icon: RadioTower },
					{ step: 4, label: 'Két bảo mật', icon: ShieldCheck }
				] as item (item.step)}
					<button
						onclick={() => (currentStep = item.step)}
						class={twMerge(
							'flex items-center gap-2 p-2 rounded-xl text-left transition-all text-xs font-medium border',
							currentStep === item.step
								? 'bg-indigo-600 text-white border-indigo-400 font-bold shadow-md'
								: currentStep > item.step
									? 'bg-slate-800/80 text-emerald-400 border-emerald-500/40'
									: 'bg-slate-900/60 text-slate-400 border-slate-800'
						)}
					>
						<div class="size-6 rounded-lg flex items-center justify-center shrink-0 font-bold bg-black/30">
							{#if currentStep > item.step}
								<CheckCircle2 class="size-4 text-emerald-400" />
							{:else}
								<span>{item.step}</span>
							{/if}
						</div>
						<span class="truncate hidden md:inline">{item.label}</span>
					</button>
				{/each}
			</div>
		</div>

		<!-- Step Contents -->
		<div class="p-6 flex flex-col min-h-[340px] justify-between">
			{#if currentStep === 1}
				<!-- STEP 1: Domain & Access -->
				<div class="flex flex-col gap-4" in:fade={{ duration: 150 }}>
					<div>
						<h3 class="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
							<Globe class="size-5 text-indigo-600 dark:text-indigo-400" />
							Bước 1: Chọn Chế độ Kết nối & Tên miền (Domain)
						</h3>
						<p class="text-xs text-slate-500 dark:text-slate-400 mt-1">
							Gen Hub hỗ trợ mở cổng truy cập linh hoạt từ Localhost, Tên miền riêng hoặc Cloudflare Tunnel.
						</p>
					</div>

					<div class="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-2">
						<button
							onclick={() => (domainMode = 'localhost')}
							class={twMerge(
								'p-4 rounded-2xl border text-left flex flex-col justify-between transition-all gap-2',
								domainMode === 'localhost'
									? 'border-indigo-600 bg-indigo-50/50 dark:bg-indigo-950/30 ring-2 ring-indigo-600/30'
									: 'border-slate-200 dark:border-slate-800 hover:border-slate-300'
							)}
						>
							<div class="flex items-center justify-between">
								<span class="text-xs font-bold text-indigo-600 dark:text-indigo-400">Cục bộ (Local)</span>
								{#if domainMode === 'localhost'}<CheckCircle2 class="size-4 text-indigo-600" />{/if}
							</div>
							<div>
								<div class="text-sm font-bold text-slate-800 dark:text-slate-200">http://localhost:8080</div>
								<div class="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">Khởi chạy nhanh trên máy cá nhân</div>
							</div>
						</button>

						<button
							onclick={() => (domainMode = 'tunnel')}
							class={twMerge(
								'p-4 rounded-2xl border text-left flex flex-col justify-between transition-all gap-2',
								domainMode === 'tunnel'
									? 'border-indigo-600 bg-indigo-50/50 dark:bg-indigo-950/30 ring-2 ring-indigo-600/30'
									: 'border-slate-200 dark:border-slate-800 hover:border-slate-300'
							)}
						>
							<div class="flex items-center justify-between">
								<span class="text-xs font-bold text-indigo-600 dark:text-indigo-400">Cloudflare Tunnel</span>
								{#if domainMode === 'tunnel'}<CheckCircle2 class="size-4 text-indigo-600" />{/if}
							</div>
							<div>
								<div class="text-sm font-bold text-slate-800 dark:text-slate-200">Public HTTPS Tunnel</div>
								<div class="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">Mở cổng an toàn ra Internet không cần mở Port Router</div>
							</div>
						</button>

						<button
							onclick={() => (domainMode = 'domain')}
							class={twMerge(
								'p-4 rounded-2xl border text-left flex flex-col justify-between transition-all gap-2',
								domainMode === 'domain'
									? 'border-indigo-600 bg-indigo-50/50 dark:bg-indigo-950/30 ring-2 ring-indigo-600/30'
									: 'border-slate-200 dark:border-slate-800 hover:border-slate-300'
							)}
						>
							<div class="flex items-center justify-between">
								<span class="text-xs font-bold text-indigo-600 dark:text-indigo-400">Tên miền riêng</span>
								{#if domainMode === 'domain'}<CheckCircle2 class="size-4 text-indigo-600" />{/if}
							</div>
							<div>
								<div class="text-sm font-bold text-slate-800 dark:text-slate-200">Custom Domain</div>
								<div class="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">Gắn SSL & Caddy/Nginx reverse proxy</div>
							</div>
						</button>
					</div>

					<div class="p-3.5 rounded-xl bg-slate-900 text-slate-100 text-xs font-mono flex items-center justify-between">
						<div class="flex items-center gap-2">
							<Terminal class="size-4 text-indigo-400 shrink-0" />
							<span>Lệnh khởi động Server: <strong class="text-emerald-400">./bin/gen-hub server</strong></span>
						</div>
						<span class="text-[10px] text-slate-400 px-2 py-0.5 rounded bg-slate-800">Cổng: 8080</span>
					</div>
				</div>

			{:else if currentStep === 2}
				<!-- STEP 2: Agent Auth Scope -->
				<div class="flex flex-col gap-4" in:fade={{ duration: 150 }}>
					<div>
						<h3 class="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
							<KeyRound class="size-5 text-indigo-600 dark:text-indigo-400" />
							Bước 2: Khởi tạo Phân quyền Agent đầu tiên (Auth Scope)
						</h3>
						<p class="text-xs text-slate-500 dark:text-slate-400 mt-1">
							Tạo một API Key gắn liền với chính sách truy cập MCP Server và LLM Proxy cho Agent của bạn (Claude Code, Cursor, Windsurf...).
						</p>
					</div>

					{#if !createdApiKey}
						<div class="flex flex-col gap-3 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50">
							<label class="text-xs font-bold text-slate-700 dark:text-slate-300">
								Tên Agent / Phạm vi Phân quyền
							</label>
							<div class="flex gap-2">
								<input
									type="text"
									bind:value={scopeName}
									placeholder="VD: Claude-Code-Agent"
									class="text-input-filled flex-1 text-sm"
								/>
								<button
									onclick={handleCreateQuickScope}
									disabled={creatingKey}
									class="btn btn-primary text-xs px-4"
								>
									{#if creatingKey}
										<Loading class="size-4" />
									{:else}
										Tạo Scope Nhanh
									{/if}
								</button>
							</div>
							<p class="text-[11px] text-slate-500">Scope này tự động cấp quyền truy cập các MCP tool và LLM proxy cần thiết.</p>
						</div>
					{:else}
						<div class="flex flex-col gap-3 p-4 rounded-2xl border border-emerald-500/30 bg-emerald-50/50 dark:bg-emerald-950/20">
							<div class="flex items-center gap-2 text-emerald-700 dark:text-emerald-400 font-bold text-xs">
								<CheckCircle2 class="size-4" />
								Đã tạo API Key thành công cho {scopeName}!
							</div>
							<CopyField value={createdApiKey} id="wizard-created-key">
								{#snippet preContent()}
									<KeyRound class="size-4 text-slate-400" />
								{/snippet}
							</CopyField>
							<p class="text-[11px] text-slate-500">Vui lòng sao chép API Key này để dán vào cấu hình Agent của bạn.</p>
						</div>
					{/if}
				</div>

			{:else if currentStep === 3}
				<!-- STEP 3: MCP Catalog Quick Select -->
				<div class="flex flex-col gap-4" in:fade={{ duration: 150 }}>
					<div>
						<h3 class="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
							<RadioTower class="size-5 text-indigo-600 dark:text-indigo-400" />
							Bước 3: Chọn các MCP Server phổ biến để sẵn sàng sử dụng
						</h3>
						<p class="text-xs text-slate-500 dark:text-slate-400 mt-1">
							Bật các công cụ MCP chuẩn được Gen Hub tích hợp sẵn cho Agent của bạn.
						</p>
					</div>

					<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
						{#each [
							{ key: 'webSearch', name: 'Web Search Tool', desc: 'Cho phép Agent tìm kiếm Google/Brave trên Web' },
							{ key: 'gdrive', name: 'Google Drive MCP', desc: 'Đọc và duyệt tài liệu Google Docs / Sheets' },
							{ key: 'github', name: 'GitHub Integration', desc: 'Truy vấn repository, commit và PR' },
							{ key: 'filesystem', name: 'Local Filesystem', desc: 'Thao tác đọc ghi tệp tin trên máy cục bộ' }
						] as tool (tool.key)}
							{@const isSelected = selectedTools[tool.key as keyof typeof selectedTools]}
							<button
								onclick={() => toggleTool(tool.key as keyof typeof selectedTools)}
								class={twMerge(
									'p-3.5 rounded-2xl border text-left flex items-start gap-3 transition-all',
									isSelected
										? 'border-indigo-600 bg-indigo-50/40 dark:bg-indigo-950/30'
										: 'border-slate-200 dark:border-slate-800'
								)}
							>
								<div class={twMerge(
									'size-5 rounded flex items-center justify-center shrink-0 mt-0.5 border',
									isSelected ? 'bg-indigo-600 text-white border-indigo-600' : 'border-slate-300 dark:border-slate-700'
								)}>
									{#if isSelected}<Check class="size-3.5" />{/if}
								</div>
								<div class="flex flex-col min-w-0">
									<div class="text-xs font-bold text-slate-800 dark:text-slate-200">{tool.name}</div>
									<div class="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-1">{tool.desc}</div>
								</div>
							</button>
						{/each}
					</div>
				</div>

			{:else if currentStep === 4}
				<!-- STEP 4: Vault & Ready -->
				<div class="flex flex-col gap-4 text-center items-center py-2" in:fade={{ duration: 150 }}>
					<div class="size-16 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
						<ShieldCheck class="size-9" />
					</div>

					<h3 class="text-lg font-bold text-slate-900 dark:text-white">
						Gen Hub đã sẵn sàng hoạt động!
					</h3>
					<p class="text-xs text-slate-600 dark:text-slate-300 max-w-lg leading-relaxed">
						Hệ thống Mã hóa Master Vault (AES-256 GCM) đã kích hoạt. Mọi OAuth credentials, API keys và thông tin truy cập đều được lưu giữ bảo mật tuyệt đối tại máy của bạn.
					</p>

					<div class="flex items-center gap-3 p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-xs text-slate-700 dark:text-slate-300">
						<Sparkles class="size-4 text-amber-500 shrink-0" />
						<span>Bạn có thể tùy chỉnh lại cài đặt bất kỳ lúc nào từ thanh điều hướng <strong>Domain & Cài đặt</strong>.</span>
					</div>
				</div>
			{/if}

			<!-- Bottom Footer Navigation -->
			<div class="flex items-center justify-between border-t border-slate-200 dark:border-slate-800 pt-4 mt-4">
				<button
					onclick={() => (currentStep = Math.max(1, currentStep - 1))}
					disabled={currentStep === 1}
					class="btn btn-secondary text-xs flex items-center gap-1.5"
				>
					<ChevronLeft class="size-4" /> Quay lại
				</button>

				{#if currentStep < 4}
					<button
						onclick={() => (currentStep = Math.min(4, currentStep + 1))}
						class="btn btn-primary text-xs flex items-center gap-1.5"
					>
						Tiếp theo <ChevronRight class="size-4" />
					</button>
				{:else}
					<button
						onclick={handleCompleteSetup}
						class="btn btn-primary text-xs px-6 flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 border-emerald-600"
					>
						🚀 Hoàn tất Setup & Bắt đầu
					</button>
				{/if}
			</div>
		</div>
	</div>
</ResponsiveDialog>
