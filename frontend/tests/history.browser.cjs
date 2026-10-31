const fs = require('fs'), path = require('path'), os = require('os'), http = require('http'), assert = require('assert/strict'), { spawn } = require('child_process');
const dist = path.resolve(__dirname, '../dist'), profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bcc-history-qa-'));
const channel = { r: Array(32).fill(10), g: Array(32).fill(15), b: Array(32).fill(9) };
const row = { name: 'Test colour', hex: '#BB8763', rgb: [187, 135, 99], percent: 100, scale_match: 'Skin scale 6', de00: 7.1576 };
const analysis = { filename: 'synthetic.jpg', has_wound: true, calibration: { is_calibrated: true, status: 'Calibrated', loocv_median_de00: 0 }, color_profile: { mean_rgb: [187, 135, 99], mean_lightness: 60, dominant_colors: [{ name: 'Scale', hex: '#BB8763', percent: 100 }] }, measured_colours: { skin: [row], wound: [row] }, wound_size: { status: 'Measured', width_cm: 4.75, length_cm: 6.04, area_cm2: 11.9 }, age_estimate: { range: null, confidence: 'Limited', confidence_score: 0, reason: 'Fixture' }, histograms: { skin: { bins: Array.from({ length: 32 }, (_, i) => i * 8), raw: channel, cal: channel }, wound: { bins: Array.from({ length: 32 }, (_, i) => i * 8), raw: channel, cal: channel } } };
let records = [{ id: '1', patientId: 'CASE-SAVED', createdAt: '2026-10-31T01:00:00Z', imageFilename: 'synthetic.jpg', woundLocation: 'Arm', deltaE00: 0, resultJson: analysis }], deleteFail = true, authExpired = false;
const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    res.setHeader('Cache-Control', 'no-store');
    if (pathname.startsWith('/api/')) {
        res.setHeader('Content-Type', 'application/json');
        if ((pathname === '/api/auth/me' || pathname.startsWith('/api/records')) && authExpired) {
            res.statusCode = 401;
            return res.end('{"detail":"Expired session"}');
        }
        if (pathname === '/api/auth/me')
            return res.end(JSON.stringify({ success: true, user: { sub: '7', email: 'qa@example.test', name: 'QA' } }));
        if (pathname === '/api/auth/login')
            return res.end(JSON.stringify({ success: true, access_token: 'qa-new-token', user: { id: 7, email: 'qa@example.test', name: 'QA' } }));
        if (pathname === '/api/health')
            return res.end(JSON.stringify({ database: 'connected' }));
        if (req.method === 'DELETE') {
            if (deleteFail) {
                res.statusCode = 500;
                return res.end('{}');
            }
            records = [];
            return res.end('{"success":true}');
        }
        if (pathname === '/api/records')
            return res.end(JSON.stringify({ total: records.length, records }));
        res.statusCode = 404;
        return res.end('{}');
    }
    const file = path.resolve(dist, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(path.resolve(dist) + path.sep) || !fs.existsSync(file)) {
        res.statusCode = 404;
        return res.end();
    }
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(fs.readFileSync(file));
});
const delay = ms => new Promise(r => setTimeout(r, ms));
(async () => {
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const browser = spawn(process.env.BCC_TEST_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-extensions', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore', windowsHide: true });
    let ws, send;
    try {
        const pf = path.join(profile, 'DevToolsActivePort');
        for (let i = 0; i < 200 && !fs.existsSync(pf); i++)
            await delay(100);
        assert.ok(fs.existsSync(pf), 'Browser launch');
        const port = fs.readFileSync(pf, 'utf8').split('\n')[0].trim(), targets = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
        ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
        await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
        let id = 0;
        const pending = new Map();
        ws.onmessage = e => { const r = JSON.parse(e.data); if (r.id && pending.has(r.id)) {
            const p = pending.get(r.id);
            pending.delete(r.id);
            clearTimeout(p.timer);
            r.error ? p.reject(new Error(JSON.stringify(r.error))) : p.resolve(r.result);
        } };
        send = (method, params = {}) => new Promise((resolve, reject) => { const key = ++id, timer = setTimeout(() => { pending.delete(key); reject(new Error('Timeout ' + method)); }, 15000); pending.set(key, { resolve, reject, timer }); ws.send(JSON.stringify({ id: key, method, params })); });
        const ev = async (expression) => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails)
            throw new Error(JSON.stringify(r.exceptionDetails)); return r.result.value; };
        const wait = async (expression, label) => { for (let i = 0; i < 150; i++) {
            if (await ev(expression))
                return;
            await delay(100);
        } throw new Error('Timed out ' + label); };
        await send('Page.enable');
        await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
        const local = { id: 'local-qa', clientId: 'qa', syncStatus: 'pending', date: '2026-10-31T02:00:00Z', caseId: 'CASE-PENDING', file: 'synthetic.jpg', bodySite: 'Arm', age: 'N/A', calibrated: true, colors: ['#BB8763'], resultJson: analysis };
        const initial = { 'bcc_session_v1': '1', 'bcc_token_v1': 'qa-test-token', 'bcc_profile_v1': JSON.stringify({ name: 'QA', email: 'qa@example.test', note: '' }), 'bcc_history_qa@example.test': JSON.stringify([local]) };
        await send('Page.addScriptToEvaluateOnNewDocument', { source: "window.confirm=()=>true;if(!localStorage.getItem('bcc_qa_init')){localStorage.setItem('bcc_qa_init','1');for(const [k,v] of Object.entries(" + JSON.stringify(initial) + "))localStorage.setItem(k,v);}" });
        await send('Page.navigate', { url: 'http://127.0.0.1:' + server.address().port + '/' });
        const openHistory = "[...document.querySelectorAll('.navitem')].find(e=>e.textContent.includes('Analysis History')).click()";
        await wait("!!document.querySelector('.navitems')", 'mount');
        await ev(openHistory);
        await wait("document.body.innerText.includes('CASE-SAVED')&&document.body.innerText.includes('CASE-PENDING')", 'records');
        await wait("localStorage.getItem('bcc_history_qa@example.test')===null", 'IndexedDB migration');
        await send('Page.reload');
        await wait("!!document.querySelector('.navitems')", 'reload');
        await ev(openHistory);
        await wait("document.body.innerText.includes('CASE-SAVED')&&document.body.innerText.includes('CASE-PENDING')", 'reload pending');
        const savedRow = "[...document.querySelectorAll('section')].find(s=>s.style.display==='block'&&s.innerText.includes('Analysis History')).querySelectorAll('tbody tr')";
        await ev(savedRow + ".forEach(tr=>{if(tr.innerText.includes('CASE-SAVED'))[...tr.querySelectorAll('button')].find(b=>b.textContent.includes('View Detail')).click()})");
        await wait("!!document.querySelector('.case-report')", 'report');
        assert.equal(await ev("document.querySelectorAll('.case-report figure').length"), 6);
        assert.ok(await ev("document.querySelector('.case-report').textContent.includes('7.1576')"));
        await send('Emulation.setEmulatedMedia', { media: 'print' });
        await ev("window.dispatchEvent(new Event('beforeprint'))");
        assert.ok(await ev("document.querySelector('.case-report').getBoundingClientRect().height>500&&getComputedStyle(document.querySelector('.app-view')).display!=='none'"), 'Print visible');
        assert.ok(await ev("getComputedStyle(document.querySelector('.sidebar')).display==='none'"), 'Print hides menu');
        assert.ok(await ev("[...document.querySelectorAll('.case-report details')].every(d=>d.open)"), 'Print expands tables');
        const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }), screenshot = path.join(profile, 'print-preview.png');
        fs.writeFileSync(screenshot, Buffer.from(shot.data, 'base64'));
        await ev("window.dispatchEvent(new Event('afterprint'))");
        await send('Emulation.setEmulatedMedia', { media: '' });
        await ev("[...document.querySelectorAll('.case-report .modal-footer button')].find(b=>b.textContent.includes('Close')).click()");
        const del = savedRow + ".forEach(tr=>{if(tr.innerText.includes('CASE-SAVED'))[...tr.querySelectorAll('button')].find(b=>b.textContent.trim()==='Delete').click()})";
        await ev(del);
        await wait("!!document.querySelector('[role=alert]')", 'delete error');
        assert.ok(await ev("document.body.innerText.includes('CASE-SAVED')"));
        deleteFail = false;
        await ev(del);
        await wait("!document.querySelector('main').innerText.includes('CASE-SAVED')", 'delete success');
        assert.ok(await ev("document.body.innerText.includes('CASE-PENDING')"));
        // Reject an expired session even though a complete offline cache exists.
        const cachedPending = "new Promise((resolve,reject)=>{const r=indexedDB.open('bcc_history_v2',1);r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result;const q=db.transaction('accounts').objectStore('accounts').get('bcc_history_qa@example.test');q.onsuccess=()=>{resolve(q.result?.some(x=>x.id==='local-qa'));db.close();};};})";
        await wait(cachedPending, 'Pending cache committed');
        authExpired = true;
        await ev("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Auto 20s')).click()");
        await wait("!!document.querySelector('.login-view')", '401 returns to sign in');
        assert.ok(await ev("!document.body.textContent.includes('CASE-PENDING') && !document.querySelector('.case-report')"), 'Expired session hides saved and cached data');
        assert.equal(await ev("localStorage.getItem('bcc_token_v1')"), null);
        assert.ok(await ev(cachedPending), 'Pending cache is retained after expiry');
        authExpired = false;
        await ev("document.querySelector('input[type=password]').focus()");
        await send('Input.insertText', { text: 'qa-password' });
        await ev("document.querySelector('form').requestSubmit()");
        await wait("!!document.querySelector('.navitems')", 'Sign in again');
        await ev(openHistory);
        await wait("document.body.innerText.includes('CASE-PENDING')", 'Pending cache recovered after sign in');
        authExpired = true;
        await ev("localStorage.setItem('bcc_token_v1','expired-on-startup');localStorage.setItem('bcc_session_v1','1')");
        await send('Page.reload');
        await wait("!!document.querySelector('.login-view')", 'Expired startup session rejected');
        assert.ok(await ev("!document.body.textContent.includes('CASE-PENDING') && !document.querySelector('.navitems')"));
        assert.ok(await ev(cachedPending), 'Startup validation retains pending cache');
        console.log('PASS: session validation, expiry hides cached history, sign-in recovers pending rows, and expired startup stays signed out');
        console.log('PASS: browser IndexedDB migration/reload, full report, six charts, print layout, and failed/successful delete');
        console.log('Screenshot: ' + screenshot);
    }
    finally {
        if (ws && ws.readyState === 1) {
            try {
                await send('Browser.close');
            }
            catch { }
            ws.close();
        }
        browser.kill();
        server.closeAllConnections();
        await new Promise(r => server.close(r));
    }
})().catch(e => { console.error(e); process.exitCode = 1; });
