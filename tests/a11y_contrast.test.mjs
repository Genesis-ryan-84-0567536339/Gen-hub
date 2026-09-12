import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  CHART_PALETTE,
  chartColor,
  chartCssBackground,
  chartSvgPatternDefs,
  chartFill
} from '../public/audit-stats.js';

// WCAG 2.1 relative luminance and contrast ratio standard formulas
export function sRGBtoLin(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function hexToRgb(hex) {
  hex = hex.replace(/^#/, '');
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  const num = parseInt(hex, 16);
  return [num >> 16, (num >> 8) & 255, num & 255];
}

export function luminance(hex) {
  const [r, g, b] = hexToRgb(hex);
  const [R, G, B] = [r, g, b].map(c => sRGBtoLin(c / 255));
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

export function contrastRatio(h1, h2) {
  const l1 = luminance(h1);
  const l2 = luminance(h2);
  const brightest = Math.max(l1, l2);
  const darkest = Math.min(l1, l2);
  return (brightest + 0.05) / (darkest + 0.05);
}

test('Part 3.1: Text contrast in styles.css meets WCAG AA (>= 4.5:1 for normal text)', () => {
  const cssPath = path.resolve(process.cwd(), 'public/styles.css');
  const css = fs.readFileSync(cssPath, 'utf8');

  // Extract --muted from :root
  const mutedMatch = css.match(/--muted:\s*(#[0-9a-fA-F]{3,6})/);
  assert.ok(mutedMatch, 'Must define --muted in styles.css');
  const mutedHex = mutedMatch[1];

  // Test backgrounds where --muted is rendered
  const bgs = [
    { name: 'white card / surface (#ffffff)', bg: '#ffffff' },
    { name: 'main body background (#f7f9f8)', bg: '#f7f9f8' },
    { name: 'table header background (#fafcfb)', bg: '#fafcfb' },
    { name: 'pie-mini background (#f8faf8)', bg: '#f8faf8' },
    { name: 'endpoint bar background (#f1f6ed)', bg: '#f1f6ed' }
  ];

  for (const { name, bg } of bgs) {
    const ratio = contrastRatio(mutedHex, bg);
    assert.ok(
      ratio >= 4.5,
      `--muted (${mutedHex}) on ${name} must be >= 4.5:1 for WCAG AA normal text, got ${ratio.toFixed(2)}:1`
    );
  }

  // Verify secondary text classes use var(--muted) or achieve >= 4.5:1
  const secondaryClasses = [
    '.sub',
    '.footnote',
    '.statlabel',
    '.statnote',
    '.legend',
    '.settingsrow p',
    '.crumb',
    '.demo',
    '.bottomcaption',
    '.tab',
    '.modalhead p',
    '.detailgrid dt',
    '.catalogrow p',
    '.activitysummary',
    '.mcpdetailtop p',
    '.sectioncaption',
    '.tablefooter',
    '.endpointlabel',
    '.endpointfoot',
    '.empty',
    '.step p',
    '.axis',
    '.charttimes',
    '.charttop small',
    '.togglelabel',
    '.checkboxline'
  ];

  for (const cls of secondaryClasses) {
    const escaped = cls.replace('.', '\\.');
    const regex = new RegExp(`(?:^|[,}\\s])${escaped}\\{([^}]*)\\}`);
    const match = css.match(regex);
    assert.ok(match, `Class ${cls} must exist in styles.css`);
    const ruleContent = match[1];
    const hasMutedVar = ruleContent.includes('var(--muted)');
    const explicitHexMatch = ruleContent.match(/color:\s*(#[0-9a-fA-F]{3,6})/);
    if (explicitHexMatch) {
      const explicitHex = explicitHexMatch[1];
      const ratio = contrastRatio(explicitHex, '#ffffff');
      assert.ok(
        ratio >= 4.5,
        `Explicit color in ${cls} (${explicitHex}) must achieve >= 4.5:1 on white, got ${ratio.toFixed(2)}:1`
      );
    } else {
      assert.ok(hasMutedVar, `${cls} should inherit var(--muted) for standardized contrast`);
    }
  }

  // Verify badges meet WCAG AA
  const badges = [
    { name: '.badge (default green)', fg: '#235f3b', bg: '#eaf3ed' },
    { name: '.badge.warn', fg: '#855314', bg: '#fff3db' },
    { name: '.badge.red', fg: '#9c3c3c', bg: '#fbebeb' },
    { name: '.badge.gray', fg: '#49574d', bg: '#eef1ef' },
    { name: '.badge.blue', fg: '#2d6394', bg: '#eaf1f8' }
  ];

  for (const b of badges) {
    const ratio = contrastRatio(b.fg, b.bg);
    assert.ok(
      ratio >= 4.5,
      `${b.name} (${b.fg} on ${b.bg}) must be >= 4.5:1, got ${ratio.toFixed(2)}:1`
    );
  }

  // Info and Pending text
  const infoRatio = contrastRatio('#3d5241', '#f2f6f2');
  assert.ok(infoRatio >= 4.5, `.info text contrast must be >= 4.5:1, got ${infoRatio.toFixed(2)}:1`);

  const pendingRatio = contrastRatio('#685d45', '#fffbf3');
  assert.ok(
    pendingRatio >= 4.5,
    `.pending p contrast must be >= 4.5:1, got ${pendingRatio.toFixed(2)}:1`
  );
});

test('Part 3.2: Chart palette expansion for >8 series', () => {
  // 1. Palette has at least 16 colors
  assert.ok(CHART_PALETTE.length >= 16, `Palette must have at least 16 colors, got ${CHART_PALETTE.length}`);

  // 2. All colors in the palette are distinct
  const unique = new Set(CHART_PALETTE.map(c => c.toLowerCase()));
  assert.equal(unique.size, CHART_PALETTE.length, 'All palette colors must be unique');

  // 3. First 8 colors preserve original base brand colors for backward compatibility
  const original8 = [
    '#28754f',
    '#467fba',
    '#b87324',
    '#9164b0',
    '#bd5266',
    '#27878b',
    '#6d7333',
    '#77614c'
  ];
  for (let i = 0; i < 8; i++) {
    assert.equal(CHART_PALETTE[i], original8[i], `Color at index ${i} should match original base`);
  }

  // 4. chartColor wraps around cleanly
  assert.equal(chartColor(0), CHART_PALETTE[0]);
  assert.equal(chartColor(16), CHART_PALETTE[0]);
  assert.equal(chartColor(17), CHART_PALETTE[1]);

  // 5. Texture patterns for >8 series
  // For series 0..7, chartCssBackground returns solid hex
  for (let i = 0; i < 8; i++) {
    assert.equal(chartCssBackground(i), CHART_PALETTE[i]);
    assert.equal(chartFill('chart', i), CHART_PALETTE[i]);
  }

  // For series >= 8, chartCssBackground returns gradient texture and chartFill returns pattern URL
  for (let i = 8; i < 16; i++) {
    const bg = chartCssBackground(i);
    assert.ok(
      bg.includes('gradient'),
      `Series ${i} must have gradient texture background, got: ${bg}`
    );
    assert.equal(chartFill('chart', i), `url(#chart-pat-${i})`);
  }

  // SVG Pattern defs generation
  assert.equal(chartSvgPatternDefs('chart', 5), '', 'Defs should be empty for <= 8 series');
  assert.equal(chartSvgPatternDefs('chart', 8), '', 'Defs should be empty for <= 8 series');

  const defs12 = chartSvgPatternDefs('chart', 12);
  assert.ok(defs12.includes('<defs>'), 'Defs must contain <defs> for >8 series');
  assert.ok(defs12.includes('id="chart-pat-8"'), 'Defs must include pattern for series 8');
  assert.ok(defs12.includes('id="chart-pat-11"'), 'Defs must include pattern for series 11');
  assert.ok(!defs12.includes('id="chart-pat-12"'), 'Defs must not include pattern for series 12 when count is 12');
});
