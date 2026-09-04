import { preparePageData } from '../../tests/helpers/pageData';
import { worker } from '../../tests/mocks/worker';
import DomainPage from './+page.svelte';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';

const configuredStatus = {
	domain: 'hub.example.com',
	serverURL: 'https://hub.example.com',
	mcpEndpoint: 'https://hub.example.com/mcp',
	tlsActive: true,
	tlsConfigured: true,
	tlsMode: 'letsencrypt',
	dnsStatus: 'resolved',
	resolvedIPs: ['203.0.113.10'],
	state: 'tls_pending',
	configComplete: true,
	bootstrapComplete: false
};

async function renderDomainPage() {
	await preparePageData();
	return render(DomainPage);
}

describe('Domain page', () => {
	it('shows persisted API status instead of deriving the browser host', async () => {
		worker.use(http.get('/api/domain/status', () => HttpResponse.json(configuredStatus)));

		await renderDomainPage();

		await expect.element(page.getByLabelText('Domain')).toHaveValue('hub.example.com');
		await expect
			.element(page.getByLabelText('MCP Endpoint'))
			.toHaveValue('https://hub.example.com/mcp');
		await expect.element(page.getByText('HTTPS đang hoạt động', { exact: true })).toBeVisible();
		await expect.element(page.getByRole('button', { name: 'Kiểm tra DNS' })).toBeEnabled();
	});

	it('does not manufacture a domain before first-run configuration', async () => {
		worker.use(
			http.get('/api/domain/status', () =>
				HttpResponse.json({
					domain: '',
					serverURL: 'http://localhost:8080',
					mcpEndpoint: 'http://localhost:8080/mcp',
					tlsActive: false,
					tlsConfigured: false,
					tlsMode: '',
					dnsStatus: 'unchecked',
					state: 'unconfigured',
					configComplete: false,
					bootstrapComplete: false
				})
			)
		);

		await renderDomainPage();

		await expect.element(page.getByLabelText('Domain')).toHaveValue('Chưa cấu hình');
		await expect.element(page.getByText('Chưa cấu hình', { exact: true }).first()).toBeVisible();
		await expect.element(page.getByRole('button', { name: 'Kiểm tra DNS' })).toBeDisabled();
	});

	it('runs a live DNS check without changing configuration', async () => {
		const checkDNS = vi.fn();
		worker.use(
			http.get('/api/domain/status', () => HttpResponse.json(configuredStatus)),
			http.post('/api/domain/check-dns', async ({ request }) => {
				checkDNS(await request.json());
				return HttpResponse.json({
					domain: 'hub.example.com',
					valid: true,
					resolvedIPs: ['203.0.113.10']
				});
			})
		);

		await renderDomainPage();
		await page.getByRole('button', { name: 'Kiểm tra DNS' }).click();

		await vi.waitFor(() => expect(checkDNS).toHaveBeenCalledWith({ domain: 'hub.example.com' }));
		await expect
			.element(page.getByText('DNS đã sẵn sàng: 203.0.113.10', { exact: true }))
			.toBeVisible();
	});
});
