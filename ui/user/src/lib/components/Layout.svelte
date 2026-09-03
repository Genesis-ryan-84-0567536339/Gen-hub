<script lang="ts" module>
	import { type Component, type Snippet } from 'svelte';

	type NavLink = {
		id: string;
		href?: string;
		icon?: Component;
		label: string;
		disabled?: boolean;
		collapsible?: boolean;
		items?: NavLink[];
		noteIcon?: Component;
		note?: Snippet;
		beta?: boolean;
	};

	const NAV_COLLAPSED_KEY = '@gen-hub/layout/nav-collapsed';

	const defaultNavCollapsed: Record<string, boolean> = {
		'agent-management': true,
		'mcp-server-management': true,
		'skills-management': true,
		'hosted-agent-management': true,
		'device-management': true,
		'user-management': true,
		'llm-gateway': true,
		advanced: true
	};

	function readNavCollapsedFromStorage(): Record<string, boolean> {
		if (typeof localStorage === 'undefined') return { ...defaultNavCollapsed };
		try {
			const local = localStorage.getItem(NAV_COLLAPSED_KEY);
			if (local) return { ...defaultNavCollapsed, ...JSON.parse(local) };
		} catch {
			// ignore invalid storage
		}
		return { ...defaultNavCollapsed };
	}

	let navCollapsedCache = readNavCollapsedFromStorage();

	type SidebarPane = 'default' | 'advanced';
	const sidebarScrollTopCache: Record<SidebarPane, number | null> = {
		default: null,
		advanced: null
	};
</script>

<script lang="ts">
	import { afterNavigate } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { columnResize } from '$lib/actions/resize';
	import Navbar from '$lib/components/Navbar.svelte';
	import GenHubLogo from '$lib/components/gen-hub/GenHubLogo.svelte';
	import {
		ADMIN_AGENT_DISABLED_MESSAGE,
		COMMUNITY_ENTITLEMENT,
		ENTERPRISE_ENTITLEMENT,
		USER_AGENT_DISABLED_MESSAGE
	} from '$lib/constants';
	import {
		initLayout as defaultInitLayout,
		getLayout as defaultGetLayout,
		type Layout as LayoutState
	} from '$lib/context/layout.svelte';
	import Bots from '$lib/icons/Bots.svelte';
	import { localState } from '$lib/runes/localState.svelte';
	import { Group } from '$lib/services';
	import {
		accessibleModels,
		defaultModelAliases,
		license as licenseStore,
		profile,
		responsive,
		version,
		appNotification as appNotificationStore
	} from '$lib/stores';
	import { adminConfigStore } from '$lib/stores/adminConfig.svelte';
	import { isAgentEnabled, validateVersionUserLimit } from '$lib/utils';
	import AppNotificationBanner from './AppNotificationBanner.svelte';
	import InfoTooltip from './InfoTooltip.svelte';
	import SetupSplashDialog from './admin/SetupSplashDialog.svelte';
	import CommunitySignupBanner from './admin/license/CommunitySignupBanner.svelte';
	import LicenseViolationBanner from './admin/license/LicenseViolationBanner.svelte';
	import GuidePanel from './guides/GuidePanel.svelte';
	import Guide from './guides/Guides.svelte';
	import Profile from './navbar/Profile.svelte';
	import IconButton from './primitives/IconButton.svelte';
	import { Render } from './ui/render';
	import {
		BrainCog,
		ChevronDown,
		ChevronLeft,
		ChevronUp,
		RadioTower,
		Users,
		BotMessageSquare,
		PencilRuler,
		LockOpen,
		Bot,
		LayoutDashboard,
		Notebook,
		Laptop,
		PanelLeftOpen,
		Settings,
		PanelLeftClose,
		Brain,
		Container,
		LayoutGrid,
		KeyRound,
		Menu,
		X,
		Server,
		Shield,
		Activity,
		Globe,
		ScrollText
	} from '@lucide/svelte';
	import { tick, untrack } from 'svelte';
	import { fade, slide, type TransitionConfig } from 'svelte/transition';
	import { twMerge } from 'tailwind-merge';

	let navCollapsed = $state({ ...navCollapsedCache });
	let showAdvancedPane = $state(untrack(() => isAdvancedPaneRoute(page.url.pathname)));
	let animatingNavSectionId = $state<string | null>(null);

	function isAdvancedPaneRoute(route: string): boolean {
		return (
			route.includes('/admin/users') ||
			route.includes('/admin/groups') ||
			route.includes('/admin/user-roles') ||
			route.includes('/admin/auth-providers') ||
			route.includes('/admin/license') ||
			route.includes('/admin/branding') ||
			route.includes('/admin/token-usage') ||
			route.includes('/admin/model-providers') ||
			route.includes('/admin/model-access-policies') ||
			route.includes('/admin/skills') ||
			route.includes('/admin/devices') ||
			route.includes('/admin/filters')
		);
	}

	function isNavCollapsed(id: string): boolean {
		return navCollapsed[id] ?? false;
	}

	function toggleNavCollapsed(id: string) {
		animatingNavSectionId = id;
		navCollapsed = { ...navCollapsed, [id]: !navCollapsed[id] };
		navCollapsedCache = navCollapsed;
		localStorage.setItem(NAV_COLLAPSED_KEY, JSON.stringify(navCollapsed));
	}

	function navSectionSlide(
		node: Element,
		{ id, axis = 'y' }: { id: string; axis?: 'x' | 'y' }
	): TransitionConfig {
		if (animatingNavSectionId !== id) {
			return { duration: 0 };
		}
		return slide(node, { axis, duration: 200 });
	}

	function clearNavSectionAnimation(id: string) {
		if (animatingNavSectionId === id) {
			animatingNavSectionId = null;
		}
	}

	type LayoutContext = {
		initLayout: () => void;
		getLayout: () => LayoutState;
	};

	interface Props {
		classes?: {
			container?: string;
			childrenContainer?: string;
			navbar?: string;
			collapsedSidebarHeaderContent?: string;
			sidebar?: string;
			sidebarRoot?: string;
			noSidebarTitle?: string;
		};
		children: Snippet;
		onRenderSubContent?: Snippet<[string]>;
		hideSidebar?: boolean;
		whiteBackground?: boolean;
		main?: { component: Component; props?: Record<string, unknown> };
		navLinks?: NavLink[];
		rightNavActions?: Snippet;
		rightMenu?: Snippet;
		leftMenu?: Snippet;
		title?: string;
		titleContent?: Snippet;
		subtitle?: string;
		showBackButton?: boolean;
		onBackButtonClick?: () => void;
		leftSidebar?: Snippet;
		rightSidebar?: Snippet;
		mobileDock?: Snippet;
		banner?: Snippet;
		layoutContext?: LayoutContext;
		disableResize?: boolean;
		hideProfileButton?: boolean;
		alwaysShowHeaderTitle?: boolean;
	}

	const {
		classes,
		children,
		onRenderSubContent,
		hideSidebar,
		whiteBackground,
		main,
		rightNavActions,
		title,
		subtitle,
		showBackButton,
		onBackButtonClick,
		leftSidebar,
		leftMenu: overrideLeftMenu,
		rightSidebar,
		rightMenu: overrideRightMenu,
		mobileDock,
		banner,
		layoutContext,
		disableResize,
		hideProfileButton,
		alwaysShowHeaderTitle,
		titleContent
	}: Props = $props();
	let nav = $state<HTMLDivElement>();
	let sidebarScroll = $state<HTMLDivElement>();
	let pathname = $derived(page.url.pathname);

	function saveSidebarScroll() {
		if (!sidebarScroll) return;
		const pane: SidebarPane = showAdvancedPane ? 'advanced' : 'default';
		sidebarScrollTopCache[pane] = sidebarScroll.scrollTop;
	}

	async function restoreSidebarScroll() {
		await tick();
		if (!sidebarScroll) return;
		const pane: SidebarPane = showAdvancedPane ? 'advanced' : 'default';
		const scrollTop = sidebarScrollTopCache[pane];
		if (scrollTop !== null) {
			sidebarScroll.scrollTop = scrollTop;
		}
	}

	let hasLicenseEntitlementViolations = $derived(
		(version.current.licenseEntitlementViolations?.length ?? 0) > 0
	);
	const isNearUserLimit = $derived(validateVersionUserLimit(version.current));

	// Gen Hub Standard Navigation Hierarchy (Prototype v2 SSOT)
	let genHubPrimaryLinks = $derived<NavLink[]>([
		{
			id: 'genhub-dashboard',
			icon: LayoutDashboard,
			label: 'Tổng quan',
			href: '/admin/dashboard'
		},
		{
			id: 'genhub-mcp-catalog',
			icon: RadioTower,
			label: 'Kho MCP',
			href: '/mcp-catalog'
		},
		{
			id: 'genhub-agents',
			icon: Users,
			label: 'Agent kết nối',
			href: '/agent-auth-scopes'
		},
		{
			id: 'genhub-vault',
			icon: Shield,
			label: 'Két bảo mật',
			href: '/vault'
		},
		{
			id: 'genhub-audit',
			icon: ScrollText,
			label: 'Audit / Activity',
			href: '/admin/audit-logs'
		},
		{
			id: 'genhub-domain',
			icon: Globe,
			label: 'Domain & Endpoint',
			href: '/domain'
		}
	]);

	let advancedManagementLinks = $derived<NavLink[]>(
		profile.current.hasAdminAccess?.()
			? [
					{
						id: 'mcp-server-management',
						icon: RadioTower,
						label: 'MCP Servers & Tunnels',
						collapsible: true,
						items: [
							{
								id: 'mcp-servers',
								href: '/mcp-servers',
								label: 'MCP Servers',
								collapsible: false
							},
							{
								id: 'mcp-deployments',
								href: '/admin/mcp-deployments',
								label: 'Deployments',
								collapsible: false
							},
							{
								id: 'mcp-access-policies',
								href: '/admin/mcp-access-policies',
								label: 'Access Policies',
								collapsible: false
							},
							{
								id: 'filters',
								href: '/admin/filters',
								label: 'Filters',
								collapsible: false
							}
						]
					},
					{
						id: 'user-management',
						icon: Users,
						label: 'Auth & Người dùng',
						collapsible: true,
						items: [
							{
								id: 'users',
								href: '/admin/users',
								label: 'Người dùng',
								collapsible: false
							},
							{
								id: 'groups',
								href: '/admin/groups',
								label: 'Nhóm quyền',
								collapsible: false
							},
							{
								id: 'auth-providers',
								href: '/admin/auth-providers',
								label: 'Nhà cung cấp SSO',
								collapsible: false
							}
						]
					},
					{
						id: 'llm-gateway',
						icon: BrainCog,
						label: 'LLM Gateway',
						collapsible: true,
						items: [
							{
								id: 'tokens',
								href: '/admin/token-usage',
								label: 'Token Usage',
								collapsible: false
							},
							{
								id: 'model-providers',
								href: '/admin/model-providers',
								label: 'Model Providers',
								collapsible: false
							}
						]
					},
					{
						id: 'app-management',
						icon: LayoutGrid,
						label: 'Cấu hình nền tảng',
						collapsible: true,
						items: [
							{
								id: 'license',
								href: '/admin/license',
								label: 'License',
								collapsible: false
							},
							{
								id: 'branding',
								href: '/admin/branding',
								label: 'Branding',
								collapsible: false
							}
						]
					}
				]
			: []
	);

	$effect(() => {
		if (responsive.isMobile) {
			layout.sidebarOpen = false;
		}
	});

	afterNavigate(async ({ to }) => {
		if (to && advancedManagementLinks.length > 0) {
			if (!isAdvancedPaneRoute(to.url.pathname)) {
				showAdvancedPane = false;
			} else {
				showAdvancedPane = true;
			}
		}

		await restoreSidebarScroll();
	});

	const isAdminRoute = $derived(pathname.includes('/admin'));
	$effect(() => {
		const isAdminOrBootstrapUser =
			profile.current.loaded &&
			(profile.current.hasAdminAccess?.() || profile.current.isBootstrapUser?.());
		if (isAdminOrBootstrapUser && isAdminRoute) {
			adminConfigStore.initialize();
		}
	});

	untrack(() => (layoutContext?.initLayout ?? defaultInitLayout)());
	const layout = untrack(() => (layoutContext?.getLayout ?? defaultGetLayout)());

	let bannerDismissed = localState<{ dismissedAt?: string } | undefined>('@gen-hub/banner', undefined);
</script>

<div class="flex min-h-dvh items-center bg-[#f5f7fb] text-slate-800 dark:bg-slate-950 dark:text-slate-100">
	<div class="relative flex min-w-0 grow">
		{#if leftSidebar}
			{@render leftSidebar()}
		{:else if layout.sidebarOpen && !hideSidebar}
			<aside
				class={twMerge(
					'bg-[#111827] text-slate-200 flex max-h-dvh w-full min-w-dvw shrink-0 flex-col md:w-[250px] md:max-w-[260px] md:min-w-[240px] border-r border-slate-800 shadow-xl z-30',
					classes?.sidebarRoot
				)}
				transition:slide={{ axis: 'x' }}
				bind:this={nav}
			>
				<!-- Brand Header -->
				<div class="flex h-[72px] shrink-0 items-center justify-between px-5 border-b border-slate-800/80">
					<GenHubLogo />
					{#if responsive.isMobile}
						<IconButton
							tooltip={{ text: 'Đóng Menu', placement: 'left' }}
							onclick={() => (layout.sidebarOpen = false)}
							class="text-slate-400 hover:text-white"
						>
							<X class="size-6" />
						</IconButton>
					{/if}
				</div>

				<!-- Navigation Links -->
				<div
					bind:this={sidebarScroll}
					class={twMerge(
						'scrollbar-default-thin flex max-h-[calc(100vh-72px)] grow flex-col gap-1 overflow-y-auto p-3 font-medium',
						classes?.sidebar
					)}
				>
					{#if showAdvancedPane}
						<div class="flex flex-col gap-1 h-full" in:slide={{ axis: 'x', duration: 100 }}>
							<button
								id="back-to-genhub-btn"
								class="flex items-center gap-2 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-indigo-400 hover:text-white hover:bg-slate-800/60 rounded-xl transition-colors"
								onclick={() => (showAdvancedPane = false)}
							>
								<ChevronLeft class="size-4" />
								<span>Quay lại Gen Hub</span>
							</button>

							<div class="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-3 pt-3 pb-1">
								Hạ tầng Obot
							</div>

							{#each advancedManagementLinks as link (link.id)}
								{@render navLink(link)}
							{/each}
						</div>
					{:else}
						<div class="flex flex-col gap-1 h-full">
							<div class="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-3 pt-2 pb-1.5">
								Điều phối Gateway
							</div>

							{#each genHubPrimaryLinks as link (link.id)}
								{@render navLink(link)}
							{/each}

							<div class="flex grow"></div>

							{#if advancedManagementLinks.length > 0}
								<div class="border-t border-slate-800/80 pt-2 mt-2">
									<button
										id="advanced-settings-btn"
										class="flex w-full items-center gap-2.5 px-3 py-2.5 text-xs text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 rounded-xl transition-colors"
										onclick={() => (showAdvancedPane = true)}
									>
										<Settings class="size-4 shrink-0" />
										<span class="truncate">Hạ tầng mở rộng (Obot)</span>
									</button>
								</div>
							{/if}
						</div>
					{/if}
				</div>

				{#if !responsive.isMobile}
					<div class="flex justify-end p-2 border-t border-slate-800/60">
						<IconButton
							tooltip={{ text: 'Thu gọn Sidebar' }}
							onclick={() => (layout.sidebarOpen = false)}
							class="text-slate-500 hover:text-slate-300"
						>
							<PanelLeftClose class="size-5" />
						</IconButton>
					</div>
				{/if}
			</aside>
			{#if !responsive.isMobile && !disableResize}
				<div
					role="none"
					class="h-inherit border-r-slate-800 relative -ml-1 w-2 cursor-col-resize border-r hover:border-indigo-500 transition-colors"
					use:columnResize={{ column: nav }}
				></div>
			{/if}
		{/if}

		<Render
			class={twMerge(
				'default-scrollbar-thin relative flex h-svh w-full min-w-0 grow flex-col overflow-y-auto bg-[#f5f7fb] dark:bg-slate-950',
				whiteBackground ? 'bg-white dark:bg-slate-900' : ''
			)}
			component={main?.component}
			as="main"
			{...main?.props}
		>
			<div class="sticky top-0 left-0 z-40 w-full">
				<header class="h-[72px] bg-white dark:bg-slate-900 border-b border-slate-200/80 dark:border-slate-800 px-6 flex items-center justify-between shadow-xs">
					<div class="flex items-center gap-3">
						{#if !layout.sidebarOpen || hideSidebar}
							<IconButton
								class="w-fit mr-2"
								tooltip={{ text: 'Mở Menu', placement: 'right' }}
								onclick={() => (layout.sidebarOpen = true)}
							>
								<Menu class="size-6 text-slate-700 dark:text-slate-300" />
							</IconButton>
							<GenHubLogo class="text-slate-900 dark:text-white" />
						{/if}
						{#if showBackButton}
							<IconButton
								class="btn btn-square btn-ghost btn-sm mr-1"
								onclick={() => {
									if (onBackButtonClick) {
										onBackButtonClick();
									} else {
										history.back();
									}
								}}
							>
								<ChevronLeft class="size-5" />
							</IconButton>
						{/if}
						<div class="flex flex-col">
							{#if subtitle}
								<span class="text-[11px] font-medium text-slate-400 dark:text-slate-500">{subtitle}</span>
							{/if}
							<h1 class="text-lg font-bold text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
								{#if titleContent}
									{@render titleContent()}
								{:else}
									{title || 'Gen Hub'}
								{/if}
							</h1>
						</div>
					</div>

					<div class="flex items-center gap-3">
						{#if rightNavActions}
							{@render rightNavActions()}
						{/if}
						{#if !hideProfileButton}
							<Profile />
						{/if}
					</div>
				</header>
			</div>

			<div
				class={twMerge(
					'flex flex-1 flex-col items-center justify-start p-6 md:p-8',
					classes?.container
				)}
			>
				<div
					class={twMerge(
						'flex h-full w-full max-w-7xl flex-col',
						classes?.childrenContainer ?? ''
					)}
				>
					{@render children()}
				</div>
			</div>

			{#if mobileDock}
				{@render mobileDock()}
			{/if}
		</Render>

		{#if rightSidebar}
			{@render rightSidebar()}
		{/if}
	</div>

	{#if !layout.sidebarOpen && !hideSidebar && !leftSidebar && !responsive.isMobile}
		<div class="fixed bottom-4 left-4 z-40" in:fade={{ delay: 200 }}>
			<IconButton
				onclick={() => (layout.sidebarOpen = true)}
				tooltip={{ text: 'Mở Menu Sidebar' }}
				class="bg-indigo-600 text-white shadow-lg hover:bg-indigo-700 size-10 rounded-full"
			>
				<PanelLeftOpen class="size-5" />
			</IconButton>
		</div>
	{/if}
</div>

{#if isAdminRoute}
	<SetupSplashDialog />
{/if}

{#snippet navLink(link: NavLink)}
	{@const isActive = link.href && (pathname === link.href || pathname.startsWith(`${link.href}/`))}
	<div class="flex flex-col">
		{#if link.collapsible && !link.href}
			<button
				class="flex w-full items-center justify-between px-3 py-2.5 rounded-xl text-xs font-semibold text-slate-300 hover:bg-slate-800/80 hover:text-white transition-colors"
				onclick={() => toggleNavCollapsed(link.id)}
				id={`sidebar-collapse-${link.id}`}
			>
				<div class="flex items-center gap-2.5">
					{#if link.icon}
						<link.icon class="size-4 text-slate-400" />
					{/if}
					<span>{link.label}</span>
				</div>
				<div>
					{#if isNavCollapsed(link.id)}
						<ChevronDown class="size-4 text-slate-500" />
					{:else}
						<ChevronUp class="size-4 text-slate-500" />
					{/if}
				</div>
			</button>
		{:else if link.href}
			<a
				id={`sidebar-link-${link.id}`}
				href={resolve(link.href as `/${string}`)}
				class={twMerge(
					'flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-medium transition-colors',
					isActive
						? 'bg-indigo-600 text-white font-semibold shadow-xs'
						: 'text-slate-300 hover:bg-slate-800/70 hover:text-white'
				)}
				onclick={saveSidebarScroll}
			>
				{#if link.icon}
					<link.icon class={twMerge('size-4', isActive ? 'text-white' : 'text-slate-400')} />
				{/if}
				<span class="truncate">{link.label}</span>
			</a>
		{:else}
			<div class="flex items-center gap-2.5 px-3 py-2.5 text-xs text-slate-500 cursor-not-allowed">
				{#if link.icon}
					<link.icon class="size-4" />
				{/if}
				<span>{link.label}</span>
			</div>
		{/if}

		{#if link.items && !isNavCollapsed(link.id)}
			<div class="flex flex-col pl-7 pr-2 py-1 gap-0.5">
				{#each link.items as item (item.href)}
					{@const isSubActive = item.href && (pathname === item.href || pathname.startsWith(`${item.href}/`))}
					<a
						id={`sidebar-sublink-${item.id}`}
						href={resolve(item.href as `/${string}`)}
						class={twMerge(
							'px-2.5 py-1.5 rounded-lg text-[11px] font-normal transition-colors truncate',
							isSubActive
								? 'text-indigo-400 font-semibold bg-slate-800/90'
								: 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
						)}
					>
						{item.label}
					</a>
				{/each}
			</div>
		{/if}
	</div>
{/snippet}
