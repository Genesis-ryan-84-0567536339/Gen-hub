export interface APIKey {
	id: number;
	userId: number;
	name: string;
	description?: string;
	canAccessAPI: boolean;
	canAccessLLMProxy: boolean;
	canAccessSkills: boolean;
	canAccessDeviceScans: boolean;
	createdAt: string;
	lastUsedAt?: string;
	expiresAt?: string;
	mcpServerIds?: string[];
}

export type APIKeyCapabilityKey =
	| 'canAccessAPI'
	| 'canAccessLLMProxy'
	| 'canAccessSkills'
	| 'canAccessDeviceScans';
export type APIKeyCreatableCapabilityKey = Exclude<APIKeyCapabilityKey, 'canAccessAPI'>;

export const API_KEY_CAPABILITIES = [
	{
		key: 'canAccessAPI',
		label: 'Quyền truy cập API',
		shortLabel: 'API',
		description: 'Cấp quyền truy cập vào Gen Hub API dựa trên vai trò của bạn.'
	},
	{
		key: 'canAccessLLMProxy',
		label: 'Quyền truy cập LLM Proxy',
		shortLabel: 'LLM',
		description: 'Cấp quyền truy cập trực tiếp vào các cổng mô hình LLM.'
	},
	{
		key: 'canAccessSkills',
		label: 'Quyền truy cập Skill',
		shortLabel: 'Skills',
		description: 'Cấp quyền chỉ đọc để tìm kiếm và tải xuống các Skill.'
	},
	{
		key: 'canAccessDeviceScans',
		label: 'Quyền truy cập Quét thiết bị',
		shortLabel: 'Scans',
		description: 'Cấp quyền gửi và đọc kết quả quét thiết bị.'
	}
] as const satisfies ReadonlyArray<{
	key: APIKeyCapabilityKey;
	label: string;
	shortLabel: string;
	description: string;
}>;

export const API_KEY_CREATABLE_CAPABILITIES = API_KEY_CAPABILITIES.filter(
	(
		capability
	): capability is Extract<
		(typeof API_KEY_CAPABILITIES)[number],
		{ key: APIKeyCreatableCapabilityKey }
	> => capability.key !== 'canAccessAPI'
);

export function getAPIKeyCapabilityLabels(apiKey: Pick<APIKey, APIKeyCapabilityKey>): string[] {
	return API_KEY_CAPABILITIES.filter((capability) => apiKey[capability.key]).map(
		(capability) => capability.shortLabel
	);
}

export interface APIKeyCreateRequest {
	name: string;
	description?: string;
	expiresAt?: string;
	mcpServerIds: string[];
	canAccessAPI?: boolean;
	canAccessLLMProxy?: boolean;
	canAccessSkills?: boolean;
	canAccessDeviceScans?: boolean;
}

export interface APIKeyCreateResponse extends APIKey {
	key: string; // Only shown once on creation
}
