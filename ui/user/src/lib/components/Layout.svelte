<script lang="ts" module>
	import { type Component, type Snippet } from 'svelte';

	type NavLink = {
		id: string;
		href?: string;
		iconSymbol?: string;
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
		'app-management': true,
		'user-resources': true,
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
			route.includes('/admin/app-notification') ||
			route.includes('/admin/app-scheduling') ||
			route.includes('/admin/token-usage') ||
			route.includes('/admin/llm-audit-logs') ||
			route.includes('/admin/model-providers') ||
			route.includes('/admin/model-access-policies') ||
			route.includes('/admin/message-policies') ||
			route.includes('/admin/policy-violations') ||
			route.includes('/admin/skills') ||
			route.includes('/admin/skill-access-policies') ||
			route.includes('/admin/hosted-agents') ||
			route.includes('/admin/hosted-agent-access-policies') ||
			route.includes('/admin/devices') ||
			route.includes('/admin/enforcement-decisions') ||
			route.includes('/admin/filters') ||
			route.includes('/admin/mcp-deployments') ||
			route.includes('/admin/mcp-access-policies') ||
			route.includes('/admin/mcp-tunnels') ||
			route.includes('/admin/server-scheduling') ||
			route.includes('/admin/image-pull-secrets') ||
			route.includes('/admin/agents') ||
			route.includes('/mcp-servers') ||
			route.includes('/skills') ||
			route.includes('/llm-gateway/models') ||
			route.includes('/hosted-agents') ||
			route.includes('/agent')
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

	let agentsFeatureEnabled = $derived(version.current.agentsEnabled !== false);
	let hostedAgentsFeatureEnabled = $derived(version.current.hostedAgentsEnabled === true);
	let agentLinkEnabled = $derived(
		isAgentEnabled(defaultModelAliases.current) && agentsFeatureEnabled
	);

	let isBootStrapUser = $derived(profile.current.isBootstrapUser?.() ?? false);
	let hasAccessibleModels = $derived(accessibleModels.current.length > 0);
	let hasLicenseEntitlementViolations = $derived(
		(version.current.licenseEntitlementViolations?.length ?? 0) > 0
	);
	const isNearUserLimit = $derived(validateVersionUserLimit(version.current));

	// Prototype HTML SSOT Navigation Hierarchy (6 items exact)
	let genHubPrimaryLinks = $derived<NavLink[]>([
		{
			id: 'dashboard',
			iconSymbol: '⌂',
			label: 'Tổng quan',
			href: '/admin/dashboard'
		},
		{
			id: 'mcp',
			iconSymbol: '◫',
			label: 'Kho MCP',
			href: '/mcp-catalog'
		},
		{
			id: 'agents',
			iconSymbol: '◎',
			label: 'Agent kết nối',
			href: '/agent-auth-scopes'
		},
		{
			id: 'vault',
			iconSymbol: '▣',
			label: 'Két bảo mật',
			href: '/vault'
		},
		{
			id: 'activity',
			iconSymbol: '≡',
			label: 'Lịch sử hoạt động',
			href: '/admin/audit-logs'
		},
		{
			id: 'settings',
			iconSymbol: '⚙',
			label: 'Domain & Cài đặt',
			href: '/domain'
		}
	]);

	// Upstream User & Native Surfaces (Preserved under secondary / advanced pane)
	let userResourceLinks = $derived<NavLink[]>([
		{
			id: 'user-resources',
			icon: Server,
			label: 'Tài nguyên người dùng',
			collapsible: true,
			items: [
				{
					id: 'mcp-servers-user',
					href: '/mcp-servers',
					label: 'MCP Servers cá nhân',
					collapsible: false
				},
				{
					id: 'skills-user',
					href: '/skills',
					label: 'Skills cá nhân',
					collapsible: false
				},
				...(hasAccessibleModels
					? [
							{
								id: 'models-user',
								href: '/llm-gateway/models',
								label: 'Mô hình AI',
								collapsible: false
							}
						]
					: []),
				...(hostedAgentsFeatureEnabled
					? [
							{
								id: 'hosted-agents-user',
								href: '/hosted-agents',
								label: 'Hosted Agents',
								collapsible: false
							}
						]
					: []),
				...(agentsFeatureEnabled
					? [
							{
								id: 'agent-run',
								href: '/agent',
								label: 'Khởi chạy Agent (Obot)',
								collapsible: false,
								disabled: isBootStrapUser || !agentLinkEnabled
							}
						]
					: [])
			].filter(Boolean) as NavLink[]
		}
	]);

	let agentManagementLinks = $derived<NavLink[]>(
		agentsFeatureEnabled
			? [
					{
						id: 'agent-management',
						icon: Bot,
						label: 'Obot Agent Management',
						collapsible: true,
						items: [
							{
								id: 'admin-agents',
								href: '/admin/agents',
								icon: Bots,
								label: 'Agents',
								collapsible: false,
								disabled: isBootStrapUser || !agentLinkEnabled
							}
						]
					}
				]
			: []
	);

	let advancedManagementLinks = $derived<NavLink[]>(
		profile.current.hasAdminAccess?.()
			? [
					...userResourceLinks,
					{
						id: 'mcp-server-management',
						icon: RadioTower,
						label: 'MCP Management',
						collapsible: true,
						items: [
							{
								id: 'mcp-catalog',
								href: '/admin/mcp-catalog',
								label: 'MCP Catalog',
								disabled: isBootStrapUser,
								collapsible: false
							},
							{
								id: 'mcp-access-policies',
								href: '/admin/mcp-access-policies',
								label: 'MCP Access Policies',
								disabled: isBootStrapUser,
								collapsible: false
							},
							{
								id: 'mcp-deployments',
								href: '/admin/mcp-deployments',
								label: 'MCP Deployments',
								collapsible: false
							},
							{
								id: 'filters',
								href: '/admin/filters',
								label: 'Filters',
								disabled: isBootStrapUser
							},
							version.current.engine === 'kubernetes' && !version.current.hideK8sDetails
								? {
										id: 'server-scheduling',
										href: '/admin/server-scheduling',
										label: 'Server Scheduling',
										collapsible: false
									}
								: undefined,
							version.current.engine === 'kubernetes'
								? {
										id: 'image-pull-secrets',
										href: '/admin/image-pull-secrets',
										label: 'Image Pull Secrets',
										disabled: isBootStrapUser,
										collapsible: false
									}
								: undefined,
							...(profile.current.isAdmin?.()
								? [
										{
											id: 'mcp-tunnels',
											href: '/admin/mcp-tunnels',
											label: 'MCP Tunnels',
											disabled: isBootStrapUser,
											collapsible: false
										}
									]
								: [])
						].filter(Boolean) as NavLink[]
					},
					{
						id: 'skills-management',
						icon: Notebook,
						label: 'Skills Management',
						collapsible: true,
						items: [
							{
								id: 'skills',
								href: '/admin/skills',
								label: 'Skill Sources',
								collapsible: false
							},
							{
								id: 'skill-access-policies',
								href: '/admin/skill-access-policies',
								label: 'Skill Access Policies',
								collapsible: false
							}
						]
					},
					...(hostedAgentsFeatureEnabled
						? [
								{
									id: 'hosted-agent-management',
									icon: Container,
									label: 'Hosted Agents',
									collapsible: true,
									items: [
										{
											id: 'hosted-agents',
											href: '/admin/hosted-agents',
											label: 'Templates',
											collapsible: false
										},
										{
											id: 'hosted-agent-access-policies',
											href: '/admin/hosted-agent-access-policies',
											label: 'Access Policies',
											collapsible: false
										}
									]
								}
							]
						: []),
					{
						id: 'device-management',
						icon: Laptop,
						label: 'Device Management',
						collapsible: true,
						items: [
							{
								id: 'devices',
								href: '/admin/devices',
								label: 'Devices',
								disabled: isBootStrapUser,
								collapsible: false,
								beta: true
							},
							{
								id: 'enforcement-decisions',
								href: '/admin/enforcement-decisions',
								label: 'Enforcement Decisions',
								disabled: isBootStrapUser,
								collapsible: false,
								beta: true
							}
						]
					},
					{
						id: 'user-management',
						icon: Users,
						label: 'Auth Management',
						disabled: !version.current.authEnabled,
						collapsible: true,
						noteIcon: !version.current.authEnabled ? LockOpen : undefined,
						note: !version.current.authEnabled ? renderAuthDisabledNote : undefined,
						items: [
							{
								id: 'users',
								href: '/admin/users',
								label: 'Users',
								collapsible: false,
								disabled: !version.current.authEnabled
							},
							{
								id: 'groups',
								href: '/admin/groups',
								label: 'Groups',
								collapsible: false,
								disabled: !version.current.authEnabled
							},
							{
								id: 'user-roles',
								href: '/admin/user-roles',
								label: 'User Roles',
								collapsible: false,
								disabled: !version.current.authEnabled
							},
							{
								id: 'auth-providers',
								href: '/admin/auth-providers',
								label: 'Auth Providers',
								disabled: !version.current.authEnabled,
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
								disabled: isBootStrapUser,
								collapsible: false
							},
							{
								id: 'llm-audit-logs',
								href: '/admin/llm-audit-logs',
								label: 'Audit Logs',
								disabled: isBootStrapUser,
								collapsible: false
							},
							{
								id: 'model-providers',
								href: '/admin/model-providers',
								label: 'Model Providers',
								collapsible: false
							},
							{
								id: 'model-access-policies',
								href: '/admin/model-access-policies',
								label: 'Model Access Policies',
								collapsible: false
							},
							...(version.current.messagePoliciesEnabled
								? [
										{
											id: 'message-policies',
											href: '/admin/message-policies',
											label: 'Message Policies',
											collapsible: false
										},
										{
											id: 'policy-violations',
											href: '/admin/policy-violations',
											label: 'Message Policy Violations',
											collapsible: false
										}
									]
								: [])
						]
					},
					...agentManagementLinks,
					{
						id: 'app-management',
						icon: LayoutGrid,
						label: 'App Management',
						collapsible: true,
						items: [
							{
								id: 'license',
								href: '/admin/license',
								label: 'License',
								disabled: false,
								collapsible: false
							},
							{
								id: 'branding',
								href: '/admin/branding',
								label: 'Branding',
								disabled: false,
								collapsible: false
							},
							{
								id: 'app-notification',
								href: '/admin/app-notification',
								label: 'App Notification',
								disabled: false,
								collapsible: false
							},
							...(version.current.engine === 'kubernetes' && !version.current.hideK8sDetails
								? [
										{
											id: 'app-scheduling',
											href: '/admin/app-scheduling',
											label: 'App Scheduling',
											disabled: false,
											collapsible: false
										}
									]
								: [])
						]
					}
				]
			: userResourceLinks
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
	const isAgentRoute = $derived(pathname === '/agent' || pathname.startsWith('/agent/'));
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

	type BannerDismissState = {
		dismissedAt?: string;
	};

	let bannerDismissed = localState<BannerDismissState | undefined>('@gen-hub/banner', undefined, {
		parse: (ls) => {
			if (!ls) return undefined;
			try {
				const parsed = JSON.parse(ls) as string | BannerDismissState;
				if (typeof parsed === 'string') {
					return { dismissedAt: parsed } satisfies BannerDismissState;
				} else if (parsed && typeof parsed === 'object') {
					return {
						dismissedAt: typeof parsed.dismissedAt === 'string' ? parsed.dismissedAt : undefined
					} satisfies BannerDismissState;
				} else return undefined;
			} catch (_err) {
				return undefined;
			}
		}
	});

	function handleDismissBanner() {
		bannerDismissed.current = {
			dismissedAt: new Date().toISOString()
		} satisfies BannerDismissState;
	}

	const COMMUNITY_SIGNUP_BANNER_KEY = '@gen-hub/dismiss-community-signup-banner';
	let communitySignupBannerDismissed = localState<BannerDismissState | undefined>(
		COMMUNITY_SIGNUP_BANNER_KEY,
		undefined,
		{
			parse: (value) => {
				if (!value) return undefined;
				try {
					const parsed = JSON.parse(value) as unknown;
					if (parsed && typeof parsed === 'object') {
						const dismissedAt = (parsed as BannerDismissState).dismissedAt;
						return {
							dismissedAt: typeof dismissedAt === 'string' ? dismissedAt : undefined
						} satisfies BannerDismissState;
					}
					return undefined;
				} catch {
					return undefined;
				}
			}
		}
	);

	function handleDismissCommunitySignupBanner() {
		communitySignupBannerDismissed.current = {
			dismissedAt: new Date().toISOString()
		} satisfies BannerDismissState;
	}

	function isCommunitySignupDismissedForCurrentProfile() {
		const dismissedAt = communitySignupBannerDismissed.current?.dismissedAt;
		const dismissedDate = dismissedAt ? new Date(dismissedAt) : undefined;
		const hasValidDismissedAt =
			dismissedDate !== undefined && !Number.isNaN(dismissedDate.getTime());
		if (!hasValidDismissedAt) return false;

		const profileCreatedMs = profile.current.created
			? new Date(profile.current.created).getTime()
			: undefined;
		if (
			profileCreatedMs === undefined ||
			Number.isNaN(profileCreatedMs) ||
			profileCreatedMs < dismissedDate.getTime()
		) {
			return true;
		}

		return false;
	}

	const hasCommunityOrEnterpriseLicense = $derived.by(() => {
		if (version.current.enterprise || licenseStore.current.enterprise) return true;
		const entitlements = [
			...(licenseStore.current.entitlements ?? []),
			...(version.current.licenseEntitlements ?? [])
		];
		return (
			entitlements.includes(COMMUNITY_ENTITLEMENT) || entitlements.includes(ENTERPRISE_ENTITLEMENT)
		);
	});

	const canShowCommunitySignup = $derived.by(() => {
		if (!(profile.current.hasAdminAccess?.() || profile.current.isBootstrapUser?.())) return false;
		if (hasCommunityOrEnterpriseLicense) return false;
		if (!communitySignupBannerDismissed.isReady) return false;
		return !isCommunitySignupDismissedForCurrentProfile();
	});

	let showAppNotificationBanner = $derived.by(() => {
		if (isAgentRoute) return false;

		const appNotification = appNotificationStore.current;
		if (!appNotification?.banner?.enabled) return false;
		if (!appNotification.banner.dismissible) return true;
		if (!bannerDismissed.isReady) return false;

		const dismissedAt = bannerDismissed.current?.dismissedAt;
		const dismissedDate = dismissedAt ? new Date(dismissedAt) : undefined;
		const hasValidDismissedAt =
			dismissedDate !== undefined && !Number.isNaN(dismissedDate.getTime());
		const wasBannerUpdatedAfterDismissal =
			appNotification?.updated &&
			hasValidDismissedAt &&
			dismissedDate <= new Date(appNotification.updated);
		return !!(
			!hasValidDismissedAt ||
			(wasBannerUpdatedAfterDismissal && appNotification.banner.resetDismissed)
		);
	});
</script>

<div class="flex min-h-screen bg-[#f5f7fb] text-[#172033] dark:bg-slate-950 dark:text-slate-100">
	<div class="relative flex min-w-0 grow">
		{#if leftSidebar}
			{@render leftSidebar()}
		{:else if layout.sidebarOpen && !hideSidebar}
			<aside
				class={twMerge(
					'bg-[#111827] text-[#e5e7eb] flex max-h-screen w-full min-w-full shrink-0 flex-col md:w-[248px] md:max-w-[248px] md:min-w-[248px] p-5 pt-5 pb-5 z-30 sticky top-0 h-screen',
					classes?.sidebarRoot
				)}
				transition:slide={{ axis: 'x' }}
				bind:this={nav}
			>
				<!-- Brand Header -->
				<div class="flex items-center justify-between pb-[22px] px-2.5">
					<GenHubLogo variant="dark" />
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
						'scrollbar-default-thin flex max-h-[calc(100vh-140px)] grow flex-col gap-1.5 overflow-y-auto font-medium',
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
							{#each genHubPrimaryLinks as link (link.id)}
								{@render navLink(link)}
							{/each}

							<div class="flex grow"></div>

							{#if advancedManagementLinks.length > 0}
								<div class="border-t border-[#293244] pt-2 mt-2">
									<button
										id="advanced-settings-btn"
										class="flex w-full items-center gap-2.5 px-3 py-2.5 text-xs text-slate-400 hover:text-slate-200 hover:bg-[#1f2937] rounded-[10px] transition-colors font-semibold"
										onclick={() => (showAdvancedPane = true)}
									>
										<span class="w-[22px] text-center text-sm font-normal">⚙</span>
										<span class="truncate">Hạ tầng mở rộng (Obot)</span>
									</button>
								</div>
							{/if}
						</div>
					{/if}
				</div>

				<!-- Aside Foot -->
				<div class="mt-auto pt-3 px-2.5 border-t border-[#293244] text-[#9ca3af] text-[12px] leading-relaxed">
					Gen Hub · Personal MCP Gateway<br />
					Nền tảng Obot Open Source
				</div>
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
				{#if banner}
					{@render banner()}
				{:else if hasLicenseEntitlementViolations || isNearUserLimit}
					<LicenseViolationBanner warnUserLimit={isNearUserLimit}>
						{#snippet fallback()}
							{#if showAppNotificationBanner}
								<AppNotificationBanner
									data={appNotificationStore.current?.banner}
									onDismiss={handleDismissBanner}
								/>
							{/if}
						{/snippet}
					</LicenseViolationBanner>
				{:else if showAppNotificationBanner}
					<AppNotificationBanner
						data={appNotificationStore.current?.banner}
						onDismiss={handleDismissBanner}
					/>
				{:else if canShowCommunitySignup}
					<CommunitySignupBanner onDismiss={handleDismissCommunitySignupBanner} />
				{/if}
				<header class="h-[72px] bg-white/88 backdrop-blur-md dark:bg-slate-900/90 border-b border-[#e6e9ef] dark:border-slate-800 px-7 flex items-center justify-between shadow-xs">
					<div class="flex items-center gap-2.5">
						{#if !layout.sidebarOpen || hideSidebar}
							<IconButton
								class="w-fit mr-2"
								tooltip={{ text: 'Mở Menu', placement: 'right' }}
								onclick={() => (layout.sidebarOpen = true)}
							>
								<Menu class="size-6 text-[#374151] dark:text-slate-300" />
							</IconButton>
							<GenHubLogo variant="auto" />
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
							<h1 class="text-[19px] font-bold text-[#172033] dark:text-white leading-tight flex items-center gap-2">
								{#if titleContent}
									{@render titleContent()}
								{:else}
									{title || 'Tổng quan'}
								{/if}
							</h1>
							<p class="text-xs text-[#6b7280] dark:text-slate-400 mt-[3px]">
								{subtitle || 'Một cổng MCP duy nhất cho toàn bộ agent của bạn'}
							</p>
						</div>
					</div>

					<div class="flex items-center gap-3">
						<!-- Prototype Top Actions: Neutral Gateway Chip & Avatar -->
						<div class="hidden sm:inline-flex items-center gap-1.5 py-1.5 px-2.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
							<span class="size-2 rounded-full bg-slate-400 dark:bg-slate-500"></span>
							<span>MCP Gateway</span>
						</div>

						{#if rightNavActions}
							{@render rightNavActions()}
						{/if}

						{#if !hideProfileButton}
							<Profile />
						{:else}
							<div class="size-9 rounded-full bg-[#e5e7eb] dark:bg-slate-800 flex items-center justify-center font-extrabold text-[#374151] dark:text-slate-200 text-sm">
								R
							</div>
						{/if}
					</div>
				</header>
			</div>

			<div
				class={twMerge(
					'flex flex-1 flex-col items-center justify-start p-6 md:p-[26px]',
					classes?.container
				)}
			>
				<div
					class={twMerge(
						'flex h-full w-full max-w-[1500px] flex-col',
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
				class="bg-[#4f46e5] text-white shadow-lg hover:bg-indigo-700 size-10 rounded-full"
			>
				<PanelLeftOpen class="size-5" />
			</IconButton>
		</div>
	{/if}

	{#if !isBootStrapUser && !responsive.isMobile}
		<GuidePanel />
		<Guide />
	{/if}
</div>

{#if isAdminRoute}
	<SetupSplashDialog />
{/if}

{#snippet renderAuthDisabledNote()}
	{#if !version.current.authEnabled}
		<p class="mt-1 text-sm">
			Obot is running with authentication disabled. Click <a
				href="https://docs.obot.ai/installation/enabling-authentication/"
				rel="external noopener noreferrer"
				target="_blank"
				class="text-link">here</a
			> for details.
		</p>
	{/if}
{/snippet}

{#snippet navLink(link: NavLink)}
	{@const isActive = link.href && (pathname === link.href || (link.href !== '/admin/dashboard' && pathname.startsWith(`${link.href}/`)))}
	<div class="flex flex-col">
		{#if link.collapsible && !link.href}
			<button
				class="flex w-full items-center justify-between px-3 py-2.5 rounded-[10px] text-xs font-semibold text-[#cbd5e1] hover:bg-[#1f2937] hover:text-white transition-colors"
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
					'flex items-center gap-2.5 px-3 py-[11px] rounded-[10px] text-[13px] font-[650] transition-colors',
					isActive
						? 'bg-[#292f43] text-white'
						: 'text-[#cbd5e1] hover:bg-[#1f2937] hover:text-white'
				)}
				onclick={saveSidebarScroll}
			>
				{#if link.iconSymbol}
					<span class="w-[22px] text-center text-[17px] font-normal leading-none shrink-0">{link.iconSymbol}</span>
				{:else if link.icon}
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
