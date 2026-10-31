const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../src/ui.ts'), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const compiled = { exports: {} };
new Function('require','module','exports',code)(require,compiled,compiled.exports);
const { validatePhotoFile, MAX_PHOTO_BYTES, formatAgeEstimate, isLegacyDemo } = compiled.exports;

test('upload validation accepts supported formats and rejects empty, oversized, and unsupported files', () => {
  for (const name of ['photo.jpg','PHOTO.PNG','phone.heic','phone.heif','photo.avif','scan.tiff']) {
    assert.equal(validatePhotoFile({ name, type: '', size: 1024 }), null);
  }
  assert.equal(validatePhotoFile({ name:'photo', type:'image/jpeg', size:MAX_PHOTO_BYTES }),null);
  assert.ok(validatePhotoFile({ name:'empty.png',type:'image/png',size:0 }));
  assert.ok(validatePhotoFile({ name:'huge.png',type:'image/png',size:MAX_PHOTO_BYTES+1 }));
  assert.ok(validatePhotoFile({ name:'notes.txt',type:'text/plain',size:100 }));
  assert.ok(validatePhotoFile({ name:'drawing.svg',type:'image/svg+xml',size:100 }));
});

test('a detected wound without a day estimate is not labelled no bruise', () => {
  const text = formatAgeEstimate({ has_wound:true, age_estimate:{range:null} });
  assert.ok(text.length>0);
  assert.ok(!text.includes('No bruise'));
  assert.notEqual(text,formatAgeEstimate({has_wound:false,age_estimate:{range:null}}));
  assert.equal(formatAgeEstimate({has_wound:true,age_estimate:{range:'10\u201314 \u0e27\u0e31\u0e19'}}),'10\u201314 \u0e27\u0e31\u0e19');
});

test('legacy demo results are identified without reclassifying backend results', () => {
  assert.equal(isLegacyDemo({ detection_note:'In-browser client estimate (Backend service offline)' }),true);
  assert.equal(isLegacyDemo({ detection_note:'Reference card detected' }),false);
  assert.equal(isLegacyDemo(null),false);
});

test('analysis accepts real JSON booleans and legacy 0/1 without changing measurements', () => {
  const { parseAnalysisResponse } = compiled.exports;
  const response = { has_wound:true, calibration:{is_calibrated:false}, color_profile:{mean_rgb:[187,135,99],dominant_colors:[]}, age_estimate:{range:null} };
  for (const [input,expected] of [[true,true],[false,false],[1,true],[0,false]]) {
    const data = {...response,has_wound:input,calibration:{is_calibrated:input}};
    const parsed = parseAnalysisResponse(data);
    assert.equal(parsed.has_wound,expected);
    assert.equal(parsed.calibration.is_calibrated,expected);
    assert.equal(parsed.color_profile,data.color_profile);
    assert.equal(parsed.age_estimate.range,null);
    assert.equal(data.has_wound,input);
  }
  for (const bad of [null,{}, {...response,has_wound:2},{...response,has_wound:'false'},{...response,color_profile:{}},{...response,age_estimate:null}]) {
    assert.throws(()=>parseAnalysisResponse(bad));
  }
});
