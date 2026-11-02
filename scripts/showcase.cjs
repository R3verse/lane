const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { _electron, chromium } = require('playwright');

// Optional: NODE_PATH must resolve Playwright; uses Edge mobile emulation.
// Captures the real application in an isolated profile with synthetic content.
async function main() {
  const root = path.resolve(__dirname, '..');
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'lane-showcase-'));
  const output = path.join(root, 'docs', 'screenshots');
  let app, browser;
  try {
    await fs.mkdir(output, { recursive: true });
    app = await _electron.launch({
      executablePath: require('electron'), args: [root],
      env: { ...process.env, LANE_TEST: '1', LANE_TEST_HTTPS: '1',
        LANE_DATA_DIR: path.join(temp, 'state'), LANE_TEST_FOLDER: path.join(temp, 'files'), LANE_PORT: '0' }
    });
    const desktop = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 1100));
    await desktop.getByRole('heading', { name: 'Transfers', exact: true }).waitFor();
    await desktop.evaluate(() => window.lane.settings({ computerName: 'Studio computer', nearbyDiscovery: false }));
    const state = await desktop.evaluate(() => window.lane.snapshot());
    const secure = state.addresses.find(a => a.secureUrl)?.secureUrl;
    assert.ok(secure, 'A local HTTPS address is required');
    const bundle = JSON.parse(JSON.parse(await fs.readFile(path.join(temp, 'state', 'tls', 'identity.json'), 'utf8')).local);
    const spki = crypto.createHash('sha256').update(new crypto.X509Certificate(bundle.leaf).publicKey.export({ type: 'spki', format: 'der' })).digest('base64');
    browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--ignore-certificate-errors-spki-list=' + spki] });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1' });
    const phone = await context.newPage();
    const pairing = await desktop.evaluate(() => window.lane.pair());
    await phone.goto(secure + '/#code=' + pairing.code);
    await phone.getByLabel('Your device name').fill('Studio phone');
    await phone.getByRole('button', { name: 'Connect device' }).click();
    await phone.locator('#sender-section').waitFor();
    await desktop.locator('.nav-item[data-view="messages"]').click();
    await desktop.getByLabel('Message', { exact: true }).fill('The photos are ready. Send your favourites here and I’ll keep them with the project. 📷');
    await desktop.getByRole('button', { name: /Send message/ }).click();
    await phone.getByRole('tab', { name: /Messages/ }).click();
    await phone.locator('.chat-message.theirs').filter({ hasText: 'The photos are ready' }).waitFor();
    await phone.waitForTimeout(6500);
    await phone.screenshot({ path: path.join(output, 'phone-messages.png'), fullPage: true });
    await phone.locator('.chat-input').fill('On their way! Files and notes, all on our own network. 🌿');
    await phone.getByRole('button', { name: /Send message/ }).click();
    await desktop.locator('.chat-message.theirs').filter({ hasText: 'On their way!' }).waitFor();
    // Let short-lived notices disappear before capturing the actual interface.
    await phone.waitForTimeout(6500);
    await desktop.screenshot({ path: path.join(output, 'desktop-messages.png') });
    await phone.getByRole('tab', { name: /Send files/ }).click();
    await phone.locator('#file-input').setInputFiles([
      { name: 'Lane icon.png', mimeType: 'image/png', buffer: await fs.readFile(path.join(root, 'assets', 'icon.png')) },
      { name: 'Project notes.txt', mimeType: 'text/plain', buffer: Buffer.from('Demo notes for the Lane showcase.\n') }
    ]);
    await phone.locator('#send-selected').waitFor();
    await phone.waitForTimeout(6500);
    await phone.screenshot({ path: path.join(output, 'phone-file-review.png'), fullPage: true });
    await phone.locator('#send-selected').click();
    await phone.locator('#upload-result').filter({ hasText: 'Sent — 2 files' }).waitFor();
    assert.equal(await fs.readFile(path.join(temp, 'files', 'Project notes.txt'), 'utf8'), 'Demo notes for the Lane showcase.\n');
    await desktop.locator('.nav-item[data-view="transfers"]').click();
    await desktop.getByText('Project notes.txt', { exact: true }).waitFor();
    await phone.waitForTimeout(6500);
    // Capture above the receiving-folder footer so the private temporary path is excluded.
    const footer = await desktop.locator('.bottom-note').boundingBox();
    const viewport = await desktop.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    await desktop.screenshot({ path: path.join(output, 'desktop-transfers.png'),
      clip: { x: 0, y: 0, width: viewport.width, height: Math.floor(footer.y - 8) } });
    await desktop.locator('.nav-item[data-view="messages"]').click();
    for (const page of [desktop, phone]) {
      const text = await page.locator('body').innerText();
      assert.ok(!/MAX-PC|192\.168\.|C:\\Users\\/i.test(text), 'Showcase must not expose machine data');
    }
    console.log('Captured four showcase screenshots with synthetic content.');
  } finally {
    await browser?.close();
    await app?.close();
    assert.ok(path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(temp).startsWith('lane-showcase-'));
    await fs.rm(temp, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
