export const DEFAULT_SETTINGS = Object.freeze({
  name: 'Gen-hub',
  retention: 30,
  onboarded: false,
  brainRepo: ''
});

export const VALID_RETENTIONS = Object.freeze([7, 30, 90]);

export function normalizeSettings(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const numRetention = Number(s.retention);
  const retention = VALID_RETENTIONS.includes(numRetention)
    ? numRetention
    : DEFAULT_SETTINGS.retention;
  const name =
    typeof s.name === 'string' && s.name.trim()
      ? s.name.trim()
      : DEFAULT_SETTINGS.name;
  const onboarded =
    typeof s.onboarded === 'boolean'
      ? s.onboarded
      : DEFAULT_SETTINGS.onboarded;
  const brainRepo = typeof s.brainRepo === 'string' ? s.brainRepo.trim() : DEFAULT_SETTINGS.brainRepo;

  return {
    ...s,
    name,
    retention,
    onboarded,
    brainRepo,
    effectiveRetentionDays: retention
  };
}
