const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const modules = new Map();

function loadSource(name) {
  const filename = path.isAbsolute(name) ? name : path.resolve(__dirname, '../src', name);
  if (modules.has(filename)) return modules.get(filename).exports;
  const module = { exports: {} };
  modules.set(filename, module);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const localRequire = request => {
    if (!request.startsWith('.')) return require(request);
    const target = path.resolve(path.dirname(filename), request);
    if (target.endsWith('.css')) return {};
    if (target.endsWith('.json')) return JSON.parse(fs.readFileSync(target, 'utf8'));
    const source = [target, target+'.ts', target+'.tsx'].find(file => fs.existsSync(file) && fs.statSync(file).isFile());
    if (!source) throw new Error('Missing test module: '+request);
    return loadSource(source);
  };
  new Function('require', 'module', 'exports', code)(localRequire, module, module.exports);
  return module.exports;
}
module.exports = { loadSource };
