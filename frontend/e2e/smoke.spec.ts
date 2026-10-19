import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

// Test data in the backend's response shape (not a real place); the real data comes from OSM.
const cities = readFileSync(new URL('./fixtures/cities.json', import.meta.url), 'utf8');
const network = readFileSync(new URL('./fixtures/network.json', import.meta.url), 'utf8');

async function openTestNetwork(page: Page) {
  await page.route('**/api/v1/examples', (r) => r.fulfill({ contentType: 'application/json', body: cities }));
  await page.route('**/api/v1/examples/test/tram', (r) =>
    r.fulfill({ contentType: 'application/json', body: network }),
  );
  await page.getByRole('button', { name: 'Open a real network…' }).click();
  await expect(page.getByRole('heading', { name: 'Open a real network' })).toBeVisible();
  await page.getByRole('button', { name: 'Open network' }).click();
  await expect(page.getByRole('list', { name: 'Lines' }).getByRole('listitem')).toHaveCount(2);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId('map').locator('canvas').first()).toBeVisible();
});

test('starts with an empty project on the OSM map with visible attribution', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Start a network' })).toBeVisible();
  await expect(page.locator('.maplibregl-ctrl-attrib')).toContainText('OpenStreetMap contributors');
  await expect(page.getByText(/Fictional demonstration/)).toHaveCount(0);
});

test('opens a real network as existing infrastructure without synthetic figures', async ({ page }) => {
  await openTestNetwork(page);
  await page.getByRole('list', { name: 'Lines' }).getByRole('button').first().click();
  await expect(page.getByText('Existing (OpenStreetMap)')).toBeVisible();
  await expect(page.getByLabel('Alignment')).toHaveValue('spline');
  await page.getByRole('button', { name: 'Dashboard' }).click();
  await expect(page.getByText(/Input required: no figures are estimated/)).toBeVisible();
  await expect(page.getByText(/DEMONSTRATION DATA/)).toHaveCount(0);
});

test('draw a line, add terminal stations, share a station and validate', async ({ page }) => {
  await page.getByText('Map layers').click();
  await page.getByLabel('Basemap', { exact: true }).selectOption('plain');
  await page.waitForTimeout(500);
  const box = (await page.getByTestId('map').boundingBox())!;
  const at = (fx: number, fy: number) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy });

  await page.getByRole('button', { name: 'Draw line' }).first().click();
  for (const [fx, fy] of [
    [0.3, 0.75],
    [0.5, 0.7],
    [0.7, 0.75],
  ]) {
    const p = at(fx!, fy!);
    await page.mouse.click(p.x, p.y);
  }
  await page.keyboard.press('Enter');
  await expect(page.getByRole('list', { name: 'Lines' }).getByRole('listitem')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Line', exact: true })).toBeVisible();
  await expect(page.getByText(/blocking error\(s\)/)).toBeVisible();

  await page.getByRole('button', { name: 'Add station', exact: true }).click();
  for (const [fx, fy] of [
    [0.3, 0.75],
    [0.7, 0.75],
  ]) {
    const p = at(fx!, fy!);
    await page.mouse.click(p.x, p.y);
  }
  await page.keyboard.press('Escape');
  await expect(page.getByRole('list', { name: 'Stations' }).getByRole('listitem')).toHaveCount(2);

  // Both ends now have terminal stations, so the blocking error is gone.
  await page.getByRole('list', { name: 'Lines' }).getByRole('button').first().click();
  await expect(page.getByText(/No blocking errors/).first()).toBeVisible();

  // A second line created from typed coordinates (non-map editing) can share the first station.
  await page.getByRole('button', { name: /Table/ }).click();
  await page.getByLabel(/Coordinates, one/).fill('10.0, 50.0\n10.01, 50.01');
  await page.getByRole('button', { name: 'Create line' }).click();
  await page.getByRole('list', { name: 'Stations' }).getByRole('button').first().click();
  await page.getByLabel(/Make this station a stop of another line/).selectOption({ index: 1 });
  await expect(page.getByText(/Interchange \(2 lines\)/)).toBeVisible();
  await page.getByRole('button', { name: 'Map', exact: true }).click();
  await page.getByRole('list', { name: 'Lines' }).getByRole('button').first().click();

  // Crossover, direction and structure configuration.
  await page
    .getByRole('button', { name: /^Crossover after/ })
    .first()
    .click();
  await expect(page.getByRole('button', { name: /^Crossover after/ }).first()).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByLabel('One-way (drawn direction)').check();
  await page.getByRole('button', { name: 'Split in half' }).click();
  await page.getByLabel('Structure').nth(1).selectOption('tunnel');
  await expect(page.getByText(/Segment 2:/)).toBeVisible();

  // Undo returns to the previous structure.
  await page.getByRole('button', { name: /Undo/ }).click();
  await expect(page.getByLabel('Structure').nth(1)).toHaveValue('at_grade');
});

test('animation, closures, schematic and exports work', async ({ page }) => {
  await openTestNetwork(page);
  await page.getByRole('button', { name: 'Start animation' }).click();
  await expect(page.getByTestId('sim-time')).not.toHaveText(/00:00:00/, { timeout: 10_000 });
  await page.getByRole('button', { name: 'Pause animation' }).click();

  await page.getByRole('list', { name: 'Lines' }).getByRole('button').first().click();
  await page.getByText('Disruption (simulation)').click();
  await page.getByRole('button', { name: 'Close section' }).click();
  await expect(page.getByText(/No crossover/).first()).toBeVisible();
  await page.getByRole('button', { name: 'Reopen section' }).click();

  await page.getByRole('button', { name: 'Schematic' }).click();
  await expect(page.getByRole('img', { name: /Schematic network map/ })).toBeVisible();
  await expect(page.getByText(/Text alternative/i)).toBeVisible();

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'File' }).click();
  await page.getByRole('menuitem', { name: 'Export GeoJSON' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.geojson$/);

  const dl2 = page.waitForEvent('download');
  await page.getByRole('button', { name: 'File' }).click();
  await page.getByRole('menuitem', { name: /Save project/ }).click();
  expect((await dl2).suggestedFilename()).toMatch(/\.mobsim\.json$/);
});

test('project persists across reloads', async ({ page }) => {
  await page.getByText('Scenario', { exact: true }).click();
  await page.getByRole('button', { name: 'Duplicate' }).click();
  await page.waitForTimeout(800);
  await page.reload();
  await expect(page.getByLabel('Active scenario').locator('option')).toHaveCount(2);
});
