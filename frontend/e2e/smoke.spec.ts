import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId('map').locator('canvas').first()).toBeVisible();
});

test('demo loads with fictional labelling and visible attribution', async ({ page }) => {
  await expect(page.getByText(/Fictional demonstration project/)).toBeVisible();
  await expect(page.locator('.maplibregl-ctrl-attrib')).toContainText('OpenStreetMap contributors');
  await expect(page.getByRole('list', { name: 'Lines' }).getByRole('listitem')).toHaveCount(3);
});

test('draw a line, add terminal stations, share a station and validate', async ({ page }) => {
  await page.getByRole('button', { name: 'File' }).click();
  await page.getByRole('menuitem', { name: 'New project' }).click();
  await page.getByText('Map layers').click();
  await page.getByLabel('Basemap', { exact: true }).selectOption('plain');
  await page.waitForTimeout(500);
  const box = (await page.getByTestId('map').boundingBox())!;
  const at = (fx: number, fy: number) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy });

  await page.getByRole('button', { name: 'Draw line' }).click();
  for (const [fx, fy] of [
    [0.3, 0.5],
    [0.5, 0.45],
    [0.7, 0.5],
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
    [0.3, 0.5],
    [0.7, 0.5],
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

  // Direction and structure configuration.
  await page.getByLabel('One-way (drawn direction)').check();
  await page.getByRole('button', { name: 'Split in half' }).click();
  await page.getByLabel('Structure').nth(1).selectOption('tunnel');
  await expect(page.getByText(/Segment 2:/)).toBeVisible();

  // Undo returns to the previous structure.
  await page.getByRole('button', { name: /Undo/ }).click();
  await expect(page.getByLabel('Structure').nth(1)).toHaveValue('at_grade');
});

test('animation, schematic, dashboard and exports work', async ({ page }) => {
  await page.getByRole('button', { name: 'Start animation' }).click();
  await expect(page.getByTestId('sim-time')).not.toHaveText(/00:00:00/, { timeout: 10_000 });
  await page.getByRole('button', { name: 'Pause animation' }).click();

  await page.getByRole('button', { name: 'Schematic' }).click();
  await expect(page.getByRole('img', { name: /Schematic network map/ })).toBeVisible();
  await expect(page.getByText(/Text alternative/i)).toBeVisible();

  await page.getByRole('button', { name: 'Dashboard' }).click();
  await expect(page.getByText(/DEMONSTRATION DATA/)).toBeVisible();

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
