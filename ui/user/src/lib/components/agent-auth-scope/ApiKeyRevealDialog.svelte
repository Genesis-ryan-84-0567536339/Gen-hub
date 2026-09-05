<script lang="ts">
	import { resolve } from '$app/paths';
	import CopyField from '$lib/components/CopyField.svelte';
	import ResponsiveDialog from '$lib/components/ResponsiveDialog.svelte';
	import { TriangleAlert, KeyRound, ExternalLink } from '@lucide/svelte';

	interface Props {
		keyValue?: string;
		onClose: () => void;
	}

	let { keyValue, onClose }: Props = $props();

	let dialog = $state<ReturnType<typeof ResponsiveDialog>>();

	$effect(() => {
		if (keyValue) {
			dialog?.open();
		}
	});

	function handleClose() {
		onClose();
		dialog?.close();
	}
</script>

{#if keyValue}
	<ResponsiveDialog
		bind:this={dialog}
		onClose={handleClose}
		title="Đã khởi tạo API Key thành công"
		class="w-full max-w-lg"
		disableClickOutside
	>
		<div class="flex flex-col gap-6">
			<div class="notification-alert">
				<div class="flex items-start gap-3">
					<TriangleAlert class="size-5 shrink-0" />
					<div class="flex flex-col gap-1">
						<p class="text-sm font-medium">Lưu ngay API Key này</p>
						<p class="text-xs">
							Đây là lần duy nhất bạn có thể nhìn thấy API key này. Vui lòng sao chép và lưu trữ ở
							nơi an toàn. Bạn sẽ không thể xem lại khóa này về sau.
						</p>
					</div>
				</div>
			</div>

			<div class="flex flex-col gap-2">
				<p class="text-sm font-medium">Khóa API Key của bạn</p>
				<CopyField value={keyValue} id="agent-auth-scope-key">
					{#snippet preContent()}
						<KeyRound class="text-muted-content size-4 shrink-0" />
					{/snippet}
				</CopyField>
			</div>

			<p class="text-muted text-sm">
				Xem hướng dẫn tích hợp API Key trong
				<a href={resolve('/domain')} class="text-link inline-flex items-center gap-1">
					tài liệu Gen Hub
					<ExternalLink class="size-3" />
				</a>
			</p>
		</div>

		<div class="mt-6 flex justify-end">
			<button class="btn btn-primary" onclick={handleClose}> Tôi đã sao chép và lưu Key </button>
		</div>
	</ResponsiveDialog>
{/if}
