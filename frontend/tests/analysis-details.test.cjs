const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const source = fs.readFileSync(path.join(__dirname, '../src/AnalysisDetails.tsx'), 'utf8')
  .replace("import './analysis-details.css';", '');
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const compiled = { exports: {} };
new Function('require', 'module', 'exports', code)(require, compiled, compiled.exports);
const Details = compiled.exports.default;

test('UTF-8 headings and colour values render from API data', () => {
  const row = { name: '\u0e19\u0e49\u0e33\u0e15\u0e32\u0e25\u0e40\u0e02\u0e49\u0e21', hex: '#652C0B', rgb: [101, 44, 11],
    percent: 33.8341, scale_match: '\u0e44\u0e21\u0e48\u0e15\u0e23\u0e07\u0e2a\u0e40\u0e01\u0e25 (\u0e43\u0e01\u0e25\u0e49 \u0e2a\u0e35\u0e40\u0e19\u0e37\u0e49\u0e2d\u0e0a\u0e48\u0e2d\u0e07 8)', de00: 15.1246 };
  const html = renderToStaticMarkup(React.createElement(Details, { result: {
    has_wound: true, measured_colours: { skin: [row], wound: [row] },
    wound_size: { status: 'Measured', width_cm: 3.69, length_cm: 5.75, area_cm2: 16.73 },
  }}));
  for (const value of ['\u0e2a\u0e35\u0e40\u0e19\u0e37\u0e49\u0e2d\u0e17\u0e35\u0e48\u0e15\u0e23\u0e27\u0e08\u0e1e\u0e1a', '\u0e2a\u0e35\u0e41\u0e1c\u0e25\u0e17\u0e35\u0e48\u0e15\u0e23\u0e27\u0e08\u0e1e\u0e1a', '\u0e02\u0e19\u0e32\u0e14\u0e41\u0e1c\u0e25\u0e42\u0e14\u0e22\u0e1b\u0e23\u0e30\u0e21\u0e32\u0e13',
    '\u0e14\u0e39\u0e15\u0e32\u0e23\u0e32\u0e07\u0e2a\u0e35\u0e17\u0e31\u0e49\u0e07\u0e2b\u0e21\u0e14', '\u0e0a\u0e37\u0e48\u0e2d\u0e2a\u0e35\u0e17\u0e35\u0e48\u0e1e\u0e1a', '\u0e40\u0e1b\u0e2d\u0e23\u0e4c\u0e40\u0e0b\u0e47\u0e19\u0e15\u0e4c', '\u0e1c\u0e25\u0e40\u0e17\u0e35\u0e22\u0e1a\u0e2a\u0e40\u0e01\u0e25', '\u0394E00 \u0e16\u0e36\u0e07\u0e2a\u0e40\u0e01\u0e25',
    '\u0e19\u0e49\u0e33\u0e15\u0e32\u0e25\u0e40\u0e02\u0e49\u0e21', 'RGB (101, 44, 11)', '33.8%', '15.1246', '3.69', '5.75', '16.73', 'cm\u00b2',
    '\u0e01\u0e48\u0e2d\u0e19\u0e1b\u0e23\u0e31\u0e1a\u0e2a\u0e35', '\u0e2b\u0e25\u0e31\u0e07\u0e1b\u0e23\u0e31\u0e1a\u0e2a\u0e35', '\u0e08\u0e33\u0e19\u0e27\u0e19\u0e1e\u0e34\u0e01\u0e40\u0e0b\u0e25']) {
    assert.ok(html.includes(value), 'Missing ' + value);
  }
  assert.ok(!html.includes('???'));
  assert.ok(!html.includes('RGB ()'));
  assert.equal((html.match(/<details/g) || []).length, 2);
  assert.equal((html.match(/<figure/g) || []).length, 6);
});

test('missing data renders readable Thai status without fabricated values', () => {
  const html = renderToStaticMarkup(React.createElement(Details, { result: { has_wound: false } }));
  assert.ok(html.includes('\u0e44\u0e21\u0e48\u0e1e\u0e1a\u0e23\u0e2d\u0e22\u0e2a\u0e35\u0e41\u0e1c\u0e25\u0e17\u0e35\u0e48\u0e40\u0e1e\u0e35\u0e22\u0e07\u0e1e\u0e2d\u0e2a\u0e33\u0e2b\u0e23\u0e31\u0e1a\u0e27\u0e34\u0e40\u0e04\u0e23\u0e32\u0e30\u0e2b\u0e4c'));
  assert.ok(html.includes('\u0e44\u0e21\u0e48\u0e21\u0e35\u0e02\u0e49\u0e2d\u0e21\u0e39\u0e25\u0e1e\u0e34\u0e01\u0e40\u0e0b\u0e25'));
  assert.ok(!html.includes('???'));
  assert.ok(!html.includes('NaN'));
});

test('incomplete legacy colour groups show a status instead of zero percentages', () => {
  const html = renderToStaticMarkup(React.createElement(Details, { result: {
    has_wound: true,
    measured_colours: { skin: [{ name: '', hex: '#CFA380', rgb: [], percent: 0, scale_match: '', de00: null }], wound: [] },
  }}));
  assert.ok(!html.includes('RGB ()'));
  assert.ok(!html.includes('0.0%'));
  assert.ok(html.includes('\u0e01\u0e23\u0e38\u0e13\u0e32\u0e27\u0e34\u0e40\u0e04\u0e23\u0e32\u0e30\u0e2b\u0e4c\u0e20\u0e32\u0e1e\u0e43\u0e2b\u0e21\u0e48'));
});
