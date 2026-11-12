// Run with: playwright-cli -s=moonheap run-code --filename scripts/browser-smoke.js
async (page) => {
  const check = (ok, message) => { if (!ok) throw new Error(message); };
  const settle = async () => { await page.locator('#busy').waitFor({ state: 'hidden' }); check(await page.locator('#error').isHidden(), await page.locator('#error').textContent()); };
  await page.reload(); await page.locator('#demo-empty').click(); await settle();
  check(await page.locator('#stat-nodes').textContent() === '42', 'demo node count');
  await page.locator('[data-view="diff"]').click(); await settle();
  check((await page.locator('#table-body').textContent()).includes('+512.0 KiB'), 'growth delta');
  await page.locator('#identity').check(); await settle();
  check((await page.locator('#identity-result').textContent()).includes('新增 32'), 'identity growth count');
  await page.locator('#next').click(); await settle();
  check(await page.locator('#changes-body tr').count() === 11, 'identity changes second page');
  await page.locator('#prev').click(); await settle();
  await page.locator('#table-body').getByRole('button', { name: 'PhotoCache', exact: true }).click(); await settle();
  check(await page.locator('#table-body tr').count() === 1, 'drill down to exact type/name');
  await page.locator('#table-body').getByRole('button', { name: 'PhotoCache', exact: true }).click(); await settle();
  await page.locator('[data-detail="path"]').click(); await settle();
  check(await page.locator('#detail-content .edge-row').count() === 2, 'shortest root path');
  check((await page.locator('#detail-content').textContent()).includes('photoCache'), 'root ownership');
  await page.locator('[data-detail="incoming"]').click(); await settle();
  check((await page.locator('#detail-content').textContent()).includes('Window'), 'incoming owner');
  await page.locator('[data-detail="outgoing"]').click(); await settle();
  check((await page.locator('#detail-content').textContent()).includes('entries'), 'outgoing reference');
  await page.locator('[data-detail="dominated"]').click(); await settle();
  check((await page.locator('#detail-content').textContent()).includes('Array'), 'dominator children');
  await page.locator('#file0').setInputFiles('examples/shared.heapsnapshot'); await settle();
  check(!await page.locator('#identity').isChecked(), 'replacement invalidates provenance assertion');
  await page.locator('#search').fill('9007199254740993'); await page.locator('#search-form').evaluate(form => form.requestSubmit()); await settle();
  check((await page.locator('#table-body').textContent()).includes('@9007199254740993'), 'exact 64-bit ID');
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#export').click();
  const download = await downloadPromise;
  check(download.suggestedFilename() === 'moonheap-nodes-report.json', 'export filename');
  await download.saveAs('work/browser-report.json');
  const raw = await (await page.request.get(new URL('/examples/shared.heapsnapshot', page.url()).href)).text();
  const unsafeName = '<img src=x onerror=alert(1)>';
  await page.locator('#file0').setInputFiles({ name: 'untrusted.heapsnapshot', mimeType: 'application/json', buffer: Buffer.from(raw.replace('"A"', JSON.stringify(unsafeName))) }); await settle();
  check((await page.locator('#table-body').textContent()).includes(unsafeName), 'snapshot name rendered as text');
  check(await page.locator('#table-body img').count() === 0, 'snapshot text must not become HTML');
  await page.locator('#file0').setInputFiles({ name: 'bad.heapsnapshot', mimeType: 'application/json', buffer: Buffer.from('{}') });
  await page.locator('#error').waitFor({ state: 'visible' });
  check((await page.locator('#error').textContent()).includes('missing field'), 'malformed file error');
  // Cancellation while a real 60k+ object snapshot is being parsed must leave
  // no stale continuation, stale handle or dead controls in the new worker.
  await page.locator('#file0').setInputFiles('work/real/growth.heapsnapshot');
  await page.locator('#cancel').click();
  await page.locator('#demo-empty').waitFor({ state: 'visible' });
  check(await page.locator('#stat-nodes').textContent() === '—', 'cancel clears sessions');
  await page.locator('#demo-empty').click(); await settle();
  await page.locator('[data-view="diff"]').click(); await settle();
  await page.setViewportSize({ width: 390, height: 844 });
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'mobile page overflows');
  await page.screenshot({ path: 'work/browser-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1040 });
  await page.screenshot({ path: 'work/browser-desktop.png', fullPage: true });
  console.log('PASS: demo, compare, identity pagination, object drilldown, reference directions, root path, dominators, precise IDs, export, malformed input, cancellation/recovery, mobile layout.');
}

