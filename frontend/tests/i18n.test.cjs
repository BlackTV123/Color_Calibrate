const {test,afterEach}=require('node:test');
const assert=require('node:assert/strict');
const React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const {loadSource}=require('./load-source.cjs');
const {t,setLanguage,LANGUAGE_KEY}=loadSource('i18n.ts');
const Details=loadSource('AnalysisDetails.tsx').default;
afterEach(()=>{setLanguage('th');delete global.localStorage;delete global.document;});

test('language choice is persisted and updates document language without touching other storage',()=>{
 const data=new Map([['bcc_session_marker_v2','existing-session']]);
 global.localStorage={getItem:key=>data.get(key),setItem:(key,value)=>data.set(key,value)};
 global.document={documentElement:{lang:'th'}};
 setLanguage('en');
 assert.equal(data.get(LANGUAGE_KEY),'en');
 assert.equal(data.get('bcc_session_marker_v2'),'existing-session');
 assert.equal(document.documentElement.lang,'en');
 assert.equal(t('ยังไม่สามารถระบุได้'),'Not yet available');
 setLanguage('th');
 assert.equal(t('Not yet available'),'ยังไม่สามารถระบุได้');
});

test('language switching still works when storage is unavailable',()=>{
 global.localStorage={setItem(){throw new Error('Storage unavailable');}};
 assert.doesNotThrow(()=>setLanguage('en'));
 assert.equal(t('กว้าง'),'Width');
});

test('both report languages preserve numeric measurements and colour values',()=>{
 const row={name:'น้ำตาลเข้ม',hex:'#652C0B',rgb:[101,44,11],percent:33.8341,scale_match:'สีเนื้อช่อง 8',de00:15.1246};
 const result={has_wound:true,measured_colours:{skin:[row],wound:[row]},
   wound_size:{status:'Measured',width_cm:3.69,length_cm:5.75,area_cm2:16.73}};
 for(const language of ['th','en']){
  setLanguage(language);
  const html=renderToStaticMarkup(React.createElement(Details,{result}));
  for(const value of ['#652C0B','101, 44, 11','33.8%','15.1246','3.69','5.75','16.73']) assert.ok(html.includes(value));
  assert.ok(html.includes(language==='en'?'Detected skin colours':'สีเนื้อที่ตรวจพบ'));
  assert.ok(html.includes(language==='en'?'Dark brown':'น้ำตาลเข้ม'));
  assert.ok(!html.includes('???'));
  assert.ok(!html.includes('?E00'));
 }
});

test('unknown text is preserved and the policy keeps its printable-ASCII requirement in both languages',()=>{
 for(const language of ['th','en']){
  setLanguage(language);
  assert.equal(t('Case001 / user-entered note'),'Case001 / user-entered note');
  const copy=t('Use only English letters (A-Z, a-z), numbers, symbols, and spaces.');
  assert.ok(copy.includes('A-Z, a-z'));
  assert.ok(!copy.includes('Unicode'));
 }
});
