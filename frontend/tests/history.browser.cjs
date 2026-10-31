const fs = require('fs'), path = require('path'), os = require('os'), http = require('http'), assert = require('assert/strict'), { spawn } = require('child_process');
const dist = path.resolve(__dirname, '../dist'), profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bcc-history-qa-'));
const channel = { r: Array(32).fill(10), g: Array(32).fill(15), b: Array(32).fill(9) };
const row = { name: 'Test colour', hex: '#BB8763', rgb: [187, 135, 99], percent: 100, scale_match: 'Skin scale 6', de00: 7.1576 };
const analysis = { filename: 'synthetic.jpg', has_wound: true, calibration: { is_calibrated: true, status: 'Calibrated', loocv_median_de00: 0 }, color_profile: { mean_rgb: [187, 135, 99], mean_lightness: 60, dominant_colors: [{ name: 'Scale', hex: '#BB8763', percent: 100 }] }, measured_colours: { skin: [row], wound: [row] }, wound_size: { status: 'Measured', width_cm: 4.75, length_cm: 6.04, area_cm2: 11.9 }, age_estimate: { range: null, confidence: 'Limited', confidence_score: 0, reason: 'Fixture' }, histograms: { skin: { bins: Array.from({ length: 32 }, (_, i) => i * 8), raw: channel, cal: channel }, wound: { bins: Array.from({ length: 32 }, (_, i) => i * 8), raw: channel, cal: channel } } };

analysis.calibration.table=Array.from({length:16},(_,i)=>({
    kind:i<10?'skin':'bruise',
    name:i===15?'Final patch':i<10?'\u0e2a\u0e35\u0e40\u0e19\u0e37\u0e49\u0e2d\u0e0a\u0e48\u0e2d\u0e07 '+(i+1):'\u0e40\u0e02\u0e35\u0e22\u0e27\u0e2d\u0e21\u0e40\u0e2b\u0e25\u0e37\u0e2d\u0e07',
    rgb_captured:[254,254,242],rgb_corrected:[246,238,227],rgb_reference:[244,233,223],
    de00_before:15.88,de00_after:1.91,loocv_de00:i===15?9.8765:5.29
}));

let records = [{ id: '1', patientId: 'CASE-SAVED', createdAt: '2026-10-31T01:00:00Z', imageFilename: 'synthetic.jpg', woundLocation: 'Arm', deltaE00: 0, resultJson: analysis }], deleteFail = true, authExpired = false, analysisFail = false, profileFail = false;
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
        if (pathname === '/api/analyze') {
            req.resume();
            if (analysisFail) { res.statusCode = 500; return res.end('{"detail":"Analysis service unavailable"}'); }
            return res.end(JSON.stringify(analysis));
        }
        if (pathname === '/api/profile') {
            req.resume();
            if (profileFail) { res.statusCode = 500; return res.end('{}'); }
            return res.end('{"success":true}');
        }
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
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.webp') ? 'image/webp' : 'text/html');
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
        await ev("document.querySelector('#navigation-toggle').click()");
        await wait("document.querySelector('#primary-navigation')?.open", 'Open navigation');
        await ev(openHistory);
        await wait("document.body.innerText.includes('CASE-SAVED')&&document.body.innerText.includes('CASE-PENDING')", 'records');
        await wait("localStorage.getItem('bcc_history_qa@example.test')===null", 'IndexedDB migration');
        await send('Page.reload');
        await wait("!!document.querySelector('.navitems')", 'reload');
        await ev("document.querySelector('#navigation-toggle').click()");
        await wait("document.querySelector('#primary-navigation')?.open", 'Open navigation');
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
        assert.ok(await ev("getComputedStyle(document.querySelector('.topbar')).display==='none'"), 'Print hides menu');
        assert.ok(await ev("[...document.querySelectorAll('.case-report details')].every(d=>d.open)"), 'Print expands tables');

        const printMetrics=await ev("(()=>{const table=document.querySelector('.calibration-table'),last=table.querySelector('tbody tr:last-child td:last-child');return {fits:table.scrollWidth<=table.clientWidth+1,lastInside:last.getBoundingClientRect().right<=table.closest('.card').getBoundingClientRect().right+1,rows:table.tBodies[0].rows.length,font:getComputedStyle(table).fontSize}})()");
        assert.ok(printMetrics.fits&&printMetrics.lastInside,'All calibration columns fit the print card');
        assert.equal(printMetrics.rows,16);
        const pdf=await send('Page.printToPDF',{preferCSSPageSize:true,printBackground:true,scale:1});
        fs.writeFileSync(path.join(profile,'report-a4.pdf'),Buffer.from(pdf.data,'base64'));

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
        // Audit regression: responsive controls, labelled forms, keyboard dialog and truthful failures.
        const nav = async label => { await ev("document.querySelector('#navigation-toggle').click()"); await wait("document.querySelector('#primary-navigation')?.open", 'Open navigation'); return ev("[...document.querySelectorAll('.navitem')].find(e=>e.textContent.includes("+JSON.stringify(label)+")).click()"); };
        const labelled = "[...document.querySelectorAll('input,select,textarea')].filter(e=>e.getClientRects().length).every(e=>e.labels?.length||e.getAttribute('aria-label')||e.getAttribute('aria-labelledby'))";
        for (const width of [320,390,768,1024,1440]) {
            await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<600});
            for (const label of ['Dashboard','New Analysis','Analysis History']) {
                await nav(label);
                assert.ok(await ev("document.documentElement.scrollWidth<=innerWidth+1"),label+' overflow at '+width);
                assert.ok(await ev(labelled),label+' labels');
            }
            await ev("document.querySelector('.profile-trigger').click()");
            assert.ok(await ev("document.documentElement.scrollWidth<=innerWidth+1"),'Profile overflow at '+width);
            assert.ok(await ev(labelled),'Profile labels');
        }
        await nav('Analysis History');
        const opener = "[...document.querySelectorAll('section')].find(s=>s.style.display==='block'&&s.innerText.includes('Analysis History')).querySelector('tbody button[title=\"View full clinical case details\"]')";
        await ev(opener+".focus();"+opener+".click()");
        await wait("!!document.querySelector('.case-report')",'Keyboard report');
        assert.ok(await ev("document.activeElement.hasAttribute('data-close-report')&&document.querySelector('.main').inert"),'Dialog receives focus and background is inert');
        for(let i=0;i<12;i++){
            await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
            await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
            assert.ok(await ev("document.querySelector('.case-report').contains(document.activeElement)"),'Tab remains in report');
        }
        await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
        await wait("!document.querySelector('.case-report')",'Escape closes report');
        assert.ok(await ev("document.activeElement.textContent.includes('View Detail')&&!document.querySelector('.main').inert"),'Dialog restores focus and background');
        await nav('New Analysis');
        await ev("(()=>{const dt=new DataTransfer();dt.items.add(new File(['text'],'notes.txt',{type:'text/plain'}));const i=document.querySelector('#imageFileInput');i.files=dt.files;i.dispatchEvent(new Event('change',{bubbles:true}));})()");
        await wait("!!document.querySelector('#analysis-error')",'Unsupported file feedback');
        await ev("(()=>{const c=document.createElement('canvas');c.width=200;c.height=150;c.getContext('2d').fillRect(0,0,200,150);const bytes=Uint8Array.from(atob(c.toDataURL('image/png').split(',')[1]),v=>v.charCodeAt(0));const dt=new DataTransfer();dt.items.add(new File([bytes],'audit.png',{type:'image/png'}));const i=document.querySelector('#imageFileInput');i.files=dt.files;i.dispatchEvent(new Event('change',{bubbles:true}));})()");
        await wait("getComputedStyle(document.querySelector('#imageCanvas')).display!=='none'",'Preview loaded');
        await ev("document.querySelector('#imageCanvas').focus()");
        await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r',unmodifiedText:'\r'});
        await wait("!!document.querySelector('.ref-pill')",'Keyboard RGB reading');
        await send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});
        analysisFail=true;
        await ev("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Analyze Photo & Bruise')).click()");
        await wait("!!document.querySelector('#analysis-error')",'Analysis failure visible');
        assert.equal(await ev("document.querySelectorAll('.histogram-plot').length"),0,'Failure must not manufacture results');
        assert.ok(await ev("document.querySelector('#imageFileInput').files[0].name==='audit.png'"),'Failure preserves input');
        analysisFail=false;
        await ev("document.querySelector('#analysis-error button').click()");
        await wait("document.querySelectorAll('.histogram-plot').length===6",'Retry produces backend result');
        assert.ok(!await ev("document.querySelector('main').innerText.includes('N/A (No bruise)')"),'No false no-bruise label');
        await ev("document.querySelector('.profile-trigger').click()");
        profileFail=true;
        await ev("document.querySelector('#profile-name').focus();document.querySelector('#profile-name').select()");
        await send('Input.insertText',{text:'QA updated name'});
        await ev("document.querySelector('form[aria-busy]').requestSubmit()");
        await wait("document.querySelector('#profile-feedback')?.getAttribute('role')==='alert'",'Profile failure announced');
        assert.equal(await ev("document.querySelector('#profile-name').value"),'QA updated name');
        profileFail=false;
        await ev("document.querySelector('form[aria-busy]').requestSubmit()");
        await wait("document.querySelector('#profile-feedback')?.getAttribute('role')==='status'",'Profile success announced');
        await nav('Analysis History');
        console.log('PASS: UI audit keyboard, form labels, five viewport widths, dialog trap/Escape/focus restoration, validated upload, API error/retry, and profile failure/success');
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
        await ev("document.querySelector('#navigation-toggle').click()");
        await wait("document.querySelector('#primary-navigation')?.open", 'Open navigation');
        await ev(openHistory);
        await wait("document.body.innerText.includes('CASE-PENDING')", 'Pending cache recovered after sign in');
        authExpired = true;
        await ev("localStorage.setItem('bcc_token_v1','expired-on-startup');localStorage.setItem('bcc_session_v1','1')");
        await send('Page.reload');
        await wait("!!document.querySelector('.login-view')", 'Expired startup session rejected');
        assert.ok(await ev("!document.body.textContent.includes('CASE-PENDING') && !document.querySelector('.navitems')"));
        assert.ok(await ev(cachedPending), 'Startup validation retains pending cache');

        // Public Home, separate auth pages, and native on-demand navigation.
        authExpired = false;
        await ev("document.querySelector('.auth-header .btn').click()");
        await wait("!!document.querySelector('.home-hero')",'Public Home');
        assert.ok(await ev("!document.querySelector('.login-view')&&!document.querySelector('#profile-email')&&!document.body.textContent.includes('CASE-PENDING')"),'Home exposes no private workspace');


        await wait("document.querySelector('.capture-illustration')?.dataset.ready==='true'",'Clay assets loaded');
        await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:8,y:100});
        await delay(300);
        assert.equal(await ev("document.querySelector('.capture-illustration').dataset.phase"),'ready','No autoplay without hover');
        assert.ok(await ev("!document.querySelector('.capture-replay')&&getComputedStyle(document.querySelector('.capture-stage')).borderTopWidth==='0px'"),'No frame or replay button');
        assert.ok(await ev("getComputedStyle(document.querySelector('.capture-backdrop')).filter.includes('blur')"),'Soft blurred backdrop');
        const hoverPoint=await ev("(()=>{const r=document.querySelector('.capture-stage').getBoundingClientRect();return {x:r.x+r.width*.6,y:r.y+r.height*.6}})()");
        await send('Input.dispatchMouseEvent',{type:'mouseMoved',...hoverPoint});
        const captureMotion = await ev("new Promise(resolve=>{const start=performance.now();let first=null,last=null,peak=0;const transforms=new Set();function sample(){const now=performance.now();const opacity=Number(getComputedStyle(document.querySelector('.capture-light')).opacity);transforms.add(getComputedStyle(document.querySelector('.capture-camera')).transform);peak=Math.max(peak,opacity);if(opacity>.001){if(first===null)first=now;last=now;}if(first!==null&&document.querySelector('.capture-illustration').dataset.phase==='captured'){resolve({duration:last-first,peak,transforms:transforms.size});return;}if(now-start>5000){resolve({timeout:true});return;}requestAnimationFrame(sample);}requestAnimationFrame(sample);})");

        assert.ok(!captureMotion.timeout,'Hover capture completes');
        assert.ok(captureMotion.duration>850&&captureMotion.duration<1150,'Flash lasts one second: '+captureMotion.duration);
        assert.ok(captureMotion.peak>.4&&captureMotion.peak<=.56,'Flash remains local and bounded');
        assert.ok(captureMotion.transforms>5,'Camera moves on hover');
        await delay(300);
        assert.equal(await ev("document.querySelector('.capture-illustration').dataset.phase"),'captured','One shot per pointer entry');
        await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:8,y:100});
        await wait("document.querySelector('.capture-illustration').dataset.phase==='ready'",'Pointer exit resets capture');
        assert.equal(await ev("getComputedStyle(document.querySelector('.capture-light')).opacity"),'0');
        await send('Input.dispatchMouseEvent',{type:'mouseMoved',...hoverPoint});
        await wait("document.querySelector('.capture-illustration').dataset.phase==='flash'&&Number(getComputedStyle(document.querySelector('.capture-light')).opacity)>.2",'Second hover flashes');
        await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:8,y:100});
        await wait("document.querySelector('.capture-illustration').dataset.phase==='ready'",'Interrupted hover cancels');
        assert.equal(await ev("getComputedStyle(document.querySelector('.capture-light')).opacity"),'0','Exit cancels active flash');
        await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
        await wait("document.querySelector('.capture-illustration')?.dataset.reduced==='true'",'Reduced motion');
        const staticCamera=await ev("getComputedStyle(document.querySelector('.capture-camera')).transform");
        await send('Input.dispatchMouseEvent',{type:'mouseMoved',...hoverPoint});
        await delay(180);
        assert.equal(await ev("getComputedStyle(document.querySelector('.capture-camera')).transform"),staticCamera);
        assert.equal(await ev("getComputedStyle(document.querySelector('.capture-light')).opacity"),'0','No reduced-motion flash');
        assert.equal(await ev("document.querySelector('.capture-illustration').dataset.phase"),'captured','Static feedback still confirms interaction');
        await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:8,y:100});
        await send('Emulation.setEmulatedMedia',{features:[]});
        await wait("document.querySelector('.capture-illustration')?.dataset.reduced==='false'",'Normal motion');
        await ev("document.querySelector('.capture-stage').focus()");
        await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r',unmodifiedText:'\r'});
        await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
        await wait("document.querySelector('.capture-illustration').dataset.phase==='captured'",'Keyboard capture');
        await ev("document.querySelector('.capture-stage').blur()");
        console.log('PASS: clay assets, hover-only capture, one-second flash, leave/cancel/reentry, no frame/replay, keyboard and reduced-motion');

        for(const width of [320,390,768,1440]){
            await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<600});
            assert.ok(await ev("document.documentElement.scrollWidth<=innerWidth+1"),'Home fits '+width);
            assert.equal(await ev("getComputedStyle(document.querySelector('.main')).marginLeft"),'0px');
            assert.ok(await ev("!document.querySelector('#primary-navigation').open"),'Drawer initially closed');
            const homeImage=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});
            fs.writeFileSync(path.join(profile,'home-'+width+'.png'),Buffer.from(homeImage.data,'base64'));
            await ev("document.querySelector('#navigation-toggle').focus();document.querySelector('#navigation-toggle').click()");
            await wait("document.querySelector('#primary-navigation').open",'Drawer open');
            await delay(220);
            assert.deepEqual(await ev("[...document.querySelectorAll('#primary-navigation .navitem')].map(e=>e.textContent.trim())"),['Home','Dashboard','New Analysis','Analysis History']);
            assert.ok(await ev("document.querySelector('#primary-navigation').contains(document.activeElement)"),'Focus inside menu');
            for(let i=0;i<7;i++){
                await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
                assert.ok(await ev("document.querySelector('#primary-navigation').contains(document.activeElement)"),'Menu contains Tab focus');
            }
            const drawerImage=await send('Page.captureScreenshot',{format:'png'});
            fs.writeFileSync(path.join(profile,'menu-'+width+'.png'),Buffer.from(drawerImage.data,'base64'));
            await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
            await wait("!document.querySelector('#primary-navigation').open",'Escape closes menu');
            assert.ok(await ev("document.activeElement.id==='navigation-toggle'&&document.querySelector('#navigation-toggle').getAttribute('aria-expanded')==='false'"),'Menu restores opener focus');
        }
        await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
        await send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
        await ev("document.querySelector('.capture-stage').scrollIntoView({block:'center'})");
        const capturePoint=await ev("(()=>{const r=document.querySelector('.capture-stage').getBoundingClientRect();return {x:r.x+r.width*.6,y:r.y+r.height*.6}})()");
        await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[capturePoint]});
        await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
        await wait("['aiming','flash'].includes(document.querySelector('.capture-illustration').dataset.phase)",'Touch starts capture');
        await wait("document.querySelector('.capture-illustration').dataset.phase==='captured'",'Touch captures clay scene');
        await ev("window.scrollTo(0,0)");

        const menuPoint=await ev("(()=>{const r=document.querySelector('#navigation-toggle').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()");
        await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[menuPoint]});
        await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
        await wait("document.querySelector('#primary-navigation').open",'Touch opens menu');
        await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:380,y:240}]});
        await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
        await wait("!document.querySelector('#primary-navigation').open",'Touch backdrop closes menu');
        await send('Emulation.setTouchEmulationEnabled',{enabled:false});
        await ev("document.querySelector('.guest-actions .primary').click()");
        await wait("!!document.querySelector('#page-title-register')",'Separate register');
        assert.ok(await ev("location.hash==='#register'&&!document.querySelector('.home-hero')"),'Register is separate from Home');
        const registerImage=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});
        fs.writeFileSync(path.join(profile,'register-390.png'),Buffer.from(registerImage.data,'base64'));
        await ev("history.back()");
        await wait("!!document.querySelector('.home-hero')",'Browser back to Home');
        await ev("document.querySelector('#navigation-toggle').click()");
        await wait("document.querySelector('#primary-navigation').open",'Guest menu');
        await ev("[...document.querySelectorAll('.navitem')].find(e=>e.textContent.includes('New Analysis')).click()");
        await wait("!!document.querySelector('#page-title-login')",'Protected route requires login');
        assert.ok(await ev("location.hash==='#login'&&!document.querySelector('#caseId')"),'Guest cannot open workspace');
        const loginImage=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});
        fs.writeFileSync(path.join(profile,'login-390.png'),Buffer.from(loginImage.data,'base64'));
        await ev("document.querySelector('#login-email').focus();document.querySelector('#login-email').select()");
        await send('Input.insertText',{text:'qa@example.test'});
        await ev("document.querySelector('#login-password').focus()");
        await send('Input.insertText',{text:'qa-password'});
        await ev("document.querySelector('form').requestSubmit()");
        await wait("location.hash==='#analysis'&&!!document.querySelector('#caseId')",'Return to intended page after login');
        await ev("[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Logout').click()");
        await wait("!!document.querySelector('.home-hero')&&!document.querySelector('#caseId')",'Logout returns public Home');
        console.log('PASS: public Home, separate login/register routes, auth redirect/recovery, browser Back, four menu items, focus trap/Escape, and synthesized touch open/backdrop close');
        console.log('UI screenshots: '+profile);

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
