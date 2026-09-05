<script lang="ts">
	import ResponsiveDialog from '../ResponsiveDialog.svelte';
	import GenHubLogo from '../gen-hub/GenHubLogo.svelte';
	import CopyField from '../CopyField.svelte';
	import Loading from '$lib/icons/Loading.svelte';
	import { ApiKeysService } from '$lib/services';
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
		Check,
		X
	} from '@lucide/svelte';
	import { fade } from 'svelte/transition';
	import { twMerge } from 'tailwind-merge';

	let dialog = $state<ReturnType<typeof ResponsiveDialog>>();
	let currentStep = $state(1);

	export function open() {
		currentStep = 1;
		dialog?.open();
	}

	export function close() {
		if (typeof localStorage !== 'undefined') {
			localStorage.setItem('seenSplashDialog', new Date().toISOString());
		}
		dialog?.close();
	}

	// Step 1 State: Network Domain
	let domainMode = $state<'localhost' | 'domain' | 'tunnel'>('localhost');

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
		close();
	}
</script>

<ResponsiveDialog
	bind:this={dialog}
	hideClose
	class="w-full max-w-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-0 overflow-hidden shadow-2xl"
>
	<div class="flex flex-col w-full text-slate-900 dark:text-slate-100">
		<!-- Header Stepper Banner -->
		<div class="bg-slate-950 text-white p-6 relative border-b border-slate-800">
			<div class="flex items-center justify-between">
				<div class="flex items-center gap-3">
					<GenHubLogo variant="dark" />
					<span class="text-xs px-2.5 py-1 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-400/30 font-bold uppercase tracking-wider">
						Quick Setup Wizard
					</span>
				</div>
				<button 
					type="button"
					onclick={close} 
					class="text-slate-300 hover:text-white text-xs font-semibold px-3 py-1.5 rounded-xl bg-slate-850 hover:bg-slate-800 transition-colors flex items-center gap-1.5 border border-slate-700 cursor-pointer"
				>
					<X class="size-3.5 text-slate-300" />
					<span>Bỏ qua</span>
				</button>
			</div>

			<h2 class="text-xl font-bold text-white mt-4">Hướng dẫn Khởi tạo & Thiết lập Nhanh</h2>
			<p class="text-xs text-slate-300 mt-1">Hoàn tất 4 bước đơn giản để kết nối Agent của bạn với Gen Hub.</p>

			<!-- 4-Step Progress Indicator -->
			<div class="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-5">
				{#each [
					{ step: 1, label: '1. Tên miền & Mạng', icon: Globe },
					{ step: 2, label: '2. Scope Agent', icon: KeyRound },
					{ step: 3, label: '3. MCP Catalog', icon: RadioTower },
					{ step: 4, label: '4. Két bảo mật', icon: ShieldCheck }
				] as item (item.step)}
					<button
						type="button"
						onclick={() => (currentStep = item.step)}
						class={twMerge(
							'flex items-center gap-2.5 p-2.5 rounded-xl text-left transition-all text-xs font-bold border cursor-pointer',
							currentStep === item.step
								? 'bg-indigo-600 text-white border-indigo-400 shadow-md ring-2 ring-indigo-400/40'
								: currentStep > item.step
									? 'bg-slate-900 text-emerald-300 border-emerald-500/60 hover:bg-slate-850'
									: 'bg-slate-900/90 text-slate-200 border-slate-750 hover:bg-slate-850 hover:text-white'
						)}
					>
						<div class={twMerge(
							'size-6 rounded-lg flex items-center justify-center shrink-0 font-extrabold text-xs shadow-sm',
							currentStep === item.step
								? 'bg-white text-indigo-700'
								: currentStep > item.step
									? 'bg-emerald-950 text-emerald-300 border border-emerald-500/40'
									: 'bg-slate-800 text-slate-200 border border-slate-700'
						)}>
							{#if currentStep > item.step}
								<CheckCircle2 class="size-4 text-emerald-400" />
							{:else}
								<span>{item.step}</span>
							{/if}
						</div>
						<span class="truncate font-bold">{item.label}</span>
					</button>
				{/each}
			</div>
		</div>

		<!-- Step Contents -->
		<div class="p-6 flex flex-col min-h-[340px] justify-between bg-white dark:bg-slate-900">
			{#if currentStep === 1}
				<!-- STEP 1: Domain & Access -->
				<div class="flex flex-col gap-4" in:fade={{ duration: 150 }}>
					<div>
						<h3 class="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
							<Globe class="size-5 text-indigo-600 dark:text-indigo-400" />
							Bước 1: Chọn Chế độ Kết nối & Tên miền (Domain)
						</h3>
						<p class="text-xs text-slate-600 dark:text-slate-400 mt-1">
							Gen Hub hỗ trợ mở cổng truy cập linh hoạt từ Localhost, Tên miền riêng hoặc Cloudflare Tunnel.
						</p>
					</div>

					<div class="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-2">
						<button
							type="button"
							onclick={() => (domainMode = 'localhost')}
							class={twMerge(
								'p-4 rounded-2xl border text-left flex flex-col justify-between transition-all gap-2 cursor-pointer bg-white dark:bg-slate-900',
								domainMode === 'localhost'
									? 'border-indigo-600 bg-indigo-50/80 dark:bg-indigo-950/60 ring-2 ring-indigo-600/30'
									: 'border-slate-200 dark:border-slate-800 hover:border-slate-300'
							)}
						>
							<div class="flex items-center justify-between">
								<span class="text-xs font-bold text-indigo-600 dark:text-indigo-400">Cục bộ (Local)</span>
								{#if domainMode === 'localhost'}<CheckCircle2 class="size-4 text-indigo-600 dark:text-indigo-400" />{/if}
							</div>
							<div>
								<div class="text-sm font-bold text-slate-900 dark:text-slate-100">http://localhost:8080</div>
								<div class="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5 font-medium">Khởi chạy nhanh trên máy cá nhân</div>
							</div>
						</button>

						<button
							type="button"
							onclick={() => (domainMode = 'tunnel')}
							class={twMerge(
								'p-4 rounded-2xl border text-left flex flex-col justify-between transition-all gap-2 cursor-pointer bg-white dark:bg-slate-900',
								domainMode === 'tunnel'
									? 'border-indigo-600 bg-indigo-50/80 dark:bg-indigo-950/60 ring-2 ring-indigo-600/30'
									: 'border-slate-200 dark:border-slate-800 hover:border-slate-300'
							)}
						>
							<div class="flex items-center justify-between">
								<span class="text-xs font-bold text-indigo-600 dark:text-indigo-400">Cloudflare Tunnel</span>
								{#if domainMode === 'tunnel'}<CheckCircle2 class="size-4 text-indigo-600 dark:text-indigo-400" />{/if}
							</div>
							<div>
								<div class="text-sm font-bold text-slate-900 dark:text-slate-100">Public HTTPS Tunnel</div>
								<div class="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5 font-medium">Mở cổng an toàn ra Internet không cần NAT Port</div>
							</div>
						</button>

						<button
							type="button"
							onclick={() => (domainMode = 'domain')}
							class={twMerge(
								'p-4 rounded-2xl border text-left flex flex-col justify-between transition-all gap-2 cursor-pointer bg-white dark:bg-slate-900',
								domainMode === 'domain'
									? 'border-indigo-600 bg-indigo-50/80 dark:bg-indigo-950/60 ring-2 ring-indigo-600/30'
									: 'border-slate-200 dark:border-slate-800 hover:border-slate-300'
							)}
						>
							<div class="flex items-center justify-between">
								<span class="text-xs font-bold text-indigo-600 dark:text-indigo-400">Tên miền riêng</span>
								{#if domainMode === 'domain'}<CheckCircle2 class="size-4 text-indigo-600 dark:text-indigo-400" />{/if}
							</div>
							<div>
								<div class="text-sm font-bold text-slate-900 dark:text-slate-100">Custom Domain</div>
								<div class="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5 font-medium">Gắn SSL & Caddy/Nginx reverse proxy</div>
							</div>
						</button>
					</div>

					<div class="p-3.5 rounded-xl bg-slate-950 text-slate-100 text-xs font-mono flex items-center justify-between border border-slate-800">
						<div class="flex items-center gap-2">
							<Terminal class="size-4 text-indigo-400 shrink-0" />
							<span class="text-slate-200">Lệnh khởi động Server: <strong class="text-emerald-400 font-bold">./bin/gen-hub server</strong></span>
						</div>
						<span class="text-[10px] text-slate-300 px-2 py-0.5 rounded bg-slate-800 border border-slate-700 font-sans font-bold">Cổng: 8080</span>
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
						<p class="text-xs text-slate-600 dark:text-slate-400 mt-1">
							Tạo một API Key gắn liền với chính sách truy cập MCP Server và LLM Proxy cho Agent của bạn (Claude Code, Cursor, Windsurf...).
						</p>
					</div>

					{#if !createdApiKey}
						<div class="flex flex-col gap-3 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50">
							<label for="wizard-scope-name-input" class="text-xs font-bold text-slate-800 dark:text-slate-200">
								Tên Agent / Phạm vi Phân quyền
							</label>
							<div class="flex gap-2">
								<input
									id="wizard-scope-name-input"
									type="text"
									bind:value={scopeName}
									placeholder="VD: Claude-Code-Agent"
									class="px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm flex-1 font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500"
								/>
								<button
									type="button"
									onclick={handleCreateQuickScope}
									disabled={creatingKey}
									class="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs transition-all shadow-md cursor-pointer disabled:opacity-50"
								>
									{#if creatingKey}
										<Loading class="size-4" />
									{:else}
										Tạo Scope Nhanh
									{/if}
								</button>
							</div>
							<p class="text-[11px] text-slate-600 dark:text-slate-400">Scope này tự động cấp quyền truy cập các MCP tool và LLM proxy cần thiết.</p>
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
							<p class="text-[11px] text-slate-600 dark:text-slate-400">Vui lòng sao chép API Key này để dán vào cấu hình Agent của bạn.</p>
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
						<p class="text-xs text-slate-600 dark:text-slate-400 mt-1">
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
								type="button"
								onclick={() => toggleTool(tool.key as keyof typeof selectedTools)}
								class={twMerge(
									'p-3.5 rounded-2xl border text-left flex items-start gap-3 transition-all cursor-pointer bg-white dark:bg-slate-900',
									isSelected
										? 'border-indigo-600 bg-indigo-50/60 dark:bg-indigo-950/40'
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
									<div class="text-xs font-bold text-slate-900 dark:text-slate-100">{tool.name}</div>
									<div class="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5 line-clamp-1 font-medium">{tool.desc}</div>
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
					<p class="text-xs text-slate-600 dark:text-slate-300 max-w-lg leading-relaxed font-medium">
						Hệ thống Mã hóa Master Vault (AES-256 GCM) đã kích hoạt. Mọi OAuth credentials, API keys và thông tin truy cập đều được lưu giữ bảo mật tuyệt đối tại máy của bạn.
					</p>

					<div class="flex items-center gap-3 p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-xs text-slate-800 dark:text-slate-200">
						<Sparkles class="size-4 text-amber-500 shrink-0" />
						<span>Bạn có thể tùy chỉnh lại cài đặt bất kỳ lúc nào từ thanh điều hướng <strong>Domain & Cài đặt</strong>.</span>
					</div>
				</div>
			{/if}

			<!-- Bottom Footer Navigation -->
			<div class="flex items-center justify-between border-t border-slate-200 dark:border-slate-800 pt-4 mt-4">
				<button
					type="button"
					onclick={() => (currentStep = Math.max(1, currentStep - 1))}
					disabled={currentStep === 1}
					class="px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
				>
					<ChevronLeft class="size-4" /> Quay lại
				</button>

				{#if currentStep < 4}
					<button
						type="button"
						onclick={() => (currentStep = Math.min(4, currentStep + 1))}
						class="px-5 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-500/20 active:scale-95 cursor-pointer"
					>
						Tiếp theo <ChevronRight class="size-4" />
					</button>
				{:else}
					<button
						type="button"
						onclick={handleCompleteSetup}
						class="px-6 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white shadow-md shadow-emerald-500/20 active:scale-95 cursor-pointer"
					>
						🚀 Hoàn tất Setup & Bắt đầu
					</button>
				{/if}
			</div>
		</div>
	</div>
</ResponsiveDialog>

