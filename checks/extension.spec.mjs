import { test, expect, chromium } from '@playwright/test';
import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test.use({actionTimeout:20000, screenshot:'only-on-failure',trace:'retain-on-failure'});

test('Chrome extension supplies timed context, PR diffs and guarded JS to the app', async () => {
  test.setTimeout((process.env.RUN_EXTENSION_MODEL || process.env.RUN_PR_MODEL) ? 300000 : 120000);
  const directory = await mkdtemp(join(tmpdir(),'alongside-extension-'));
  const extension = join(directory,'extension');
  await cp(resolve('extension'),extension,{recursive:true});
  // Fixtures grant hosts explicitly because automated toolbar activeTab grants
  // are not exercised here. The shipped manifest retains user-gesture activeTab.
  const manifest = JSON.parse(await readFile(join(extension,'manifest.json'),'utf8'));
  manifest.host_permissions.push('https://www.youtube.com/*','https://github.com/*');
  await writeFile(join(extension,'manifest.json'),JSON.stringify(manifest));
  const context = await chromium.launchPersistentContext(join(directory,'profile'),{channel:'chromium',headless:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const extensionId = new URL(worker.url()).host;
    const source = await context.newPage();
    await source.route('https://www.youtube.com/**',route=>route.fulfill({contentType:'text/html',body:'<title>Cache lecture</title><main><video></video><ytd-transcript-segment-renderer><span class="segment-timestamp">1:00</span><span class="segment-text">A cache miss reads the origin.</span></ytd-transcript-segment-renderer><ytd-transcript-segment-renderer><span class="segment-timestamp">1:20</span><span class="segment-text">Save the result for later.</span></ytd-transcript-segment-renderer><h2>Learning caches</h2></main>'}));
    await source.goto('https://www.youtube.com/watch?v=fixture');
    await source.evaluate(()=>Object.defineProperty(document.querySelector('video'),'currentTime',{value:75}));
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/panel.html`);
    const selectSource = async () => {
      await panel.evaluate(async url => {
        const [tab] = await chrome.tabs.query({url});
        const selection = await chrome.runtime.sendMessage({type:'bind',tabId:tab.id,origin:'http://127.0.0.1:5176'});
        const window = await chrome.windows.getCurrent();
        await chrome.storage.session.set({[`selection:${window.id}`]:{...selection,openId:crypto.randomUUID()}});
      },source.url());
    };
    await expect(panel.getByRole('button',{name:'Use this page',exact:true})).toHaveCount(0);
    await panel.getByRole('button',{name:'Zoom panel out',exact:true}).evaluate(button=>button.click());
    await expect(panel.getByRole('button',{name:'Reset panel zoom',exact:true})).toHaveText('90%');
    await panel.reload();
    await expect(panel.getByRole('button',{name:'Reset panel zoom',exact:true})).toHaveText('90%');
    const panelBounds=await panel.locator('body').boundingBox();
    expect(Math.abs(panelBounds.height-panel.viewportSize().height)).toBeLessThan(2);
    await panel.getByRole('button',{name:'Reset panel zoom',exact:true}).evaluate(button=>button.click());
    await selectSource();
    await expect(panel.locator('#status')).toContainText('Connected: Cache lecture');
    const frame = panel.frameLocator('#board');
    await expect(frame.getByText('Agent activity',{exact:true})).toBeVisible();
    await expect(frame.getByLabel('Source page')).toContainText('Cache lecture');
    await expect(frame.getByLabel('Source page')).toContainText('75s');
    const app = panel.frames().find(frame=>frame.url().startsWith('http://127.0.0.1:5176/'));
    const read = async operation=>app.evaluate(async operation=>{
      const {readPage}=await import('/src/page/bridge.ts');
      return readPage(new URL(location.href).searchParams.get('source'),operation);
    },operation);
    const snapshot = await read({type:'snapshot'});
    expect(snapshot.video.nearby).toHaveLength(2);
    expect(snapshot.video.transcriptSource).toBe('transcript-panel');
    const lessonUrl = app.url();
    await frame.getByRole('button',{name:'Close activity',exact:true}).click();
    await expect(frame.getByText('Agent activity',{exact:true})).toHaveCount(0);
    await selectSource();
    await expect(frame.getByText('Agent activity',{exact:true})).toBeVisible();
    expect(app.url()).toBe(lessonUrl);
    if (process.env.RUN_EXTENSION_MODEL) {
      await panel.bringToFront();
      await frame.getByLabel('Question',{exact:true}).fill('At this video moment, explain what the narrator means using a small diagram. Use the supplied transcript and keep the explanation short.');
      const request = context.waitForEvent('request', {timeout:20000,predicate:request=>request.url().endsWith('/api/partner')&&request.method()==='POST'});
      await frame.getByRole('button',{name:'Ask',exact:true}).evaluate(button=>button.click());
      const sent = (await request).postDataJSON();
      expect(sent.pageContext.video.currentTime).toBe(75);
      expect(sent.pageContext.video.nearby[0].text).toContain('cache miss');
      await expect(frame.getByRole('button',{name:'Ask',exact:true})).toBeVisible({timeout:180000});
      const saved = await app.evaluate(async()=> (await fetch('/api/lessons/'+new URL(location.href).searchParams.get('lesson'))).json());
      expect(saved.interrupted).toBe(false);
      expect(saved.document.snapshot.scene.length).toBeGreaterThan(0);
      expect(saved.answer.toLowerCase()).toContain('cache');
      await panel.screenshot({path:resolve('output/extension-e2e.png')});
    }
    expect(await read({type:'evaluate',code:'document.querySelector("h2").textContent'})).toBe('Learning caches');
    await expect(read({type:'evaluate',code:'document.body.innerHTML = "changed"'})).rejects.toThrow();
    expect(await source.locator('h2').innerText()).toBe('Learning caches');
    await source.route('https://github.com/**',route=>route.fulfill({contentType:'text/html',body:'<title>Fix cache expiry · Pull request #42</title><main><h1 class="js-issue-title">Fix cache expiry</h1><div class="comment-body">Expire stale cache entries.</div><div class="file"><div class="file-header" data-path="cache.ts">cache.ts</div><table><tr><td class="blob-code">+ cache.expire(key, 60)</td></tr></table></div></main>'}));
    await source.goto('https://github.com/acme/app/pull/42/files');
    await expect(read({type:'snapshot'})).rejects.toThrow(/navigated/);
    await selectSource();
    await expect(frame.getByLabel('Source page')).toContainText('Fix cache expiry');
    const prApp=panel.frames().find(frame=>frame.url().startsWith('http://127.0.0.1:5176/'));
    const pr=await prApp.evaluate(async()=>{const {readPage}=await import('/src/page/bridge.ts');return readPage(new URL(location.href).searchParams.get('source'),{type:'snapshot'});});
    expect(pr.pullRequest.repository).toBe('acme/app');
    expect(pr.pullRequest.files[0].diff).toContain('cache.expire');
    if (process.env.RUN_PR_MODEL) {
      await source.unroute('https://github.com/**');
      await source.goto('https://github.com/openai/codex/pull/31471/files',{waitUntil:'domcontentloaded'});
      await source.locator('.file-header[data-path]').first().waitFor();
      await selectSource();
      await expect(frame.getByLabel('Source page')).toContainText('31471');
      await panel.bringToFront();
      await frame.getByLabel('Question',{exact:true}).fill('Explain this PR and how the code changes work.');
      await expect(frame.getByRole('button',{name:'Ask',exact:true})).toBeEnabled();
      await frame.getByRole('button',{name:'Ask',exact:true}).evaluate(button=>button.click());
      const actual=panel.frames().find(frame=>frame.url().startsWith('http://127.0.0.1:5176/'));
      const record=()=>actual.evaluate(async()=> (await fetch('/api/lessons/'+new URL(location.href).searchParams.get('lesson'))).json());
      await expect.poll(async()=> (await record()).document.snapshot.scene.length,{timeout:180000}).toBeGreaterThan(0);
      // A visible object must arrive before the entire explanation completes.
      await expect(frame.getByRole('button',{name:'Stop',exact:true})).toBeVisible();
      await expect(frame.getByRole('button',{name:'Ask',exact:true})).toBeVisible({timeout:240000});
      const lesson=await record();
      expect(lesson.document.snapshot.scene.length).toBeGreaterThan(2);
      expect(lesson.answer.length).toBeGreaterThan(0);
      await panel.screenshot({path:resolve('output/pr-live-example.png')});
      console.log('PR lesson',lesson.id,'objects',lesson.document.snapshot.scene.length);
    }

  } finally { await context.close(); await rm(directory,{recursive:true,force:true}); }
});
