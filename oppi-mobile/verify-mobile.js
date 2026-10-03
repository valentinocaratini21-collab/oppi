#!/usr/bin/env node
/**
 * verify-mobile.js — verificación estática de la app móvil Oppi.
 *
 * Corre en VERDE si todo pasa; exit code 1 y lista de errores si algo falla.
 *
 * Chequeos:
 *  1. Todos los archivos de src/ parsean con babel (babel-preset-expo,
 *     el mismo preset que usa Metro).
 *  2. 0 imports relativos rotos: el archivo destino existe y el nombre
 *     importado está entre sus exports.
 *  3. Todas las rutas usadas en navigation.navigate/push/replace están
 *     registradas en AppNavigator (incluidos los fragmentos clientRoutes,
 *     handymanRoutes y BUSINESS_ROUTES, supportRoutes, y las tabs anidadas).
 *  4. 0 botones (TouchableOpacity / Pressable / Button de react-native) sin
 *     onPress (se acepta `disabled` como alternativa).
 *
 * Uso: node verify-mobile.js   (desde ~/workspace/oppi/oppi-mobile)
 */
const fs = require('fs');
const path = require('path');
const babel = require('@babel/core');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

const ROOT = path.join(__dirname, 'src');
const errors = [];
let parsed = 0;

function fail(msg) {
  errors.push(msg);
}

// 1) Recolectar archivos .js de src/
function listFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) listFiles(p, out);
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}
const files = listFiles(ROOT);

// 2) Parsear con babel (mismo preset que Metro)
const asts = new Map();
for (const f of files) {
  const code = fs.readFileSync(f, 'utf8');
  try {
    babel.transformSync(code, {
      filename: f,
      presets: [require('babel-preset-expo')],
      configFile: false,
      babelrc: false,
    });
    parsed += 1;
    asts.set(f, parser.parse(code, {
      sourceType: 'module',
      plugins: ['jsx', 'classProperties', 'objectRestSpread', 'optionalChaining', 'nullishCoalescingOperator'],
    }));
  } catch (e) {
    fail(`PARSE ${rel(f)}: ${e.message.split('\n')[0]}`);
  }
}
function rel(p) {
  return path.relative(path.join(__dirname), p);
}

// 3) Exports por archivo (para validar imports nombrados)
function exportedNames(f, seen = new Set()) {
  const ast = asts.get(f);
  if (!ast || seen.has(f)) return new Set();
  seen.add(f);
  const names = new Set();
  let hasDefault = false;
  traverse(ast, {
    ExportNamedDeclaration(p) {
      const d = p.node.declaration;
      if (d) {
        if (d.declarations) d.declarations.forEach((x) => names.add(x.id.name));
        if (d.id) names.add(d.id.name);
      }
      (p.node.specifiers || []).forEach((s) => names.add(s.exported.name));
      if (p.node.source) {
        // export { X } from './otro'
        const target = resolveImport(f, p.node.source.value);
        if (target) exportedNames(target, seen).forEach((n) => names.add(n));
      }
    },
    ExportDefaultDeclaration() { hasDefault = true; },
    ExportAllDeclaration(p) {
      const target = resolveImport(f, p.node.source.value);
      if (target) exportedNames(target, seen).forEach((n) => names.add(n));
    },
  });
  if (hasDefault) names.add('__default__');
  return names;
}

function resolveImport(from, spec) {
  const base = path.resolve(path.dirname(from), spec);
  for (const cand of [base, `${base}.js`, path.join(base, 'index.js')]) {
    if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return cand;
  }
  return null;
}

// 4) Chequear imports relativos
for (const f of files) {
  const ast = asts.get(f);
  if (!ast) continue;
  traverse(ast, {
    ImportDeclaration(p) {
      const spec = p.node.source.value;
      if (!spec.startsWith('.')) return; // solo relativos
      const target = resolveImport(f, spec);
      if (!target) {
        fail(`IMPORT ${rel(f)}: no existe "${spec}"`);
        return;
      }
      const exports = exportedNames(target);
      for (const s of p.node.specifiers) {
        if (s.type === 'ImportSpecifier') {
          const want = s.imported.name;
          if (!exports.has(want)) {
            fail(`IMPORT ${rel(f)}: "${spec}" no exporta "${want}"`);
          }
        } else if (s.type === 'ImportDefaultSpecifier') {
          if (!exports.has('__default__')) {
            fail(`IMPORT ${rel(f)}: "${spec}" no tiene export default`);
          }
        }
        // ImportNamespaceSpecifier: basta con que el archivo exista
      }
    },
  });
}

// 5) Rutas registradas
const registered = new Set();
const navFile = path.join(ROOT, 'navigation', 'AppNavigator.js');
const navCode = fs.readFileSync(navFile, 'utf8');
for (const m of navCode.matchAll(/<(?:Stack|Tab)\.Screen\s+name="([^"]+)"/g)) {
  registered.add(m[1]);
}
// Fragmentos dinámicos: clientRoutes / handymanRoutes / BUSINESS_ROUTES / supportRoutes
for (const frag of ['clientRoutes.js', 'handymanRoutes.js', 'businessRoutes.js', 'supportRoutes.js']) {
  const fp = path.join(ROOT, 'navigation', frag);
  const code = fs.readFileSync(fp, 'utf8');
  for (const m of code.matchAll(/name:\s*['"]([^'"]+)['"]/g)) {
    registered.add(m[1]);
  }
}
// Tabs anidadas (navigate('MainTabs', { screen: 'X' }))
const tabNames = new Set();
for (const m of navCode.matchAll(/<Tab\.Screen\s+name="([^"]+)"/g)) tabNames.add(m[1]);

// 6) Rutas usadas en navegación (solo el objeto `navigation`, no String.replace)
const used = new Map(); // ruta -> [archivos]
const NAV_RE = /(?:^|[^\w$.])navigation\.(?:navigate|push|replace)\(\s*['"]([^'"]+)['"]/gm;
const NESTED_RE = /(?:^|[^\w$.])navigation\.(?:navigate|push)\(\s*['"]([^'"]+)['"]\s*,\s*\{\s*screen:\s*['"]([^'"]+)['"]/gm;
for (const f of files) {
  const code = fs.readFileSync(f, 'utf8');
  for (const m of code.matchAll(NAV_RE)) {
    if (!used.has(m[1])) used.set(m[1], []);
    used.get(m[1]).push(rel(f));
  }
  // pantalla anidada: navigate('X', { screen: 'Y' })
  for (const m of code.matchAll(NESTED_RE)) {
    const nested = m[2];
    if (!registered.has(nested) && !tabNames.has(nested)) {
      fail(`RUTA ${rel(f)}: pantalla anidada "${nested}" no registrada`);
    }
  }
}
for (const [route, where] of used) {
  if (!registered.has(route)) {
    fail(`RUTA "${route}" usada en ${where.join(', ')} pero NO registrada en AppNavigator`);
  }
}

// 7) Botones sin onPress
const BUTTONS = new Set(['TouchableOpacity', 'Pressable', 'Button']);
for (const f of files) {
  const ast = asts.get(f);
  if (!ast) continue;
  traverse(ast, {
    JSXOpeningElement(p) {
      const name = p.node.name;
      if (name.type !== 'JSXIdentifier' || !BUTTONS.has(name.name)) return;
      const attrs = p.node.attributes.map((a) =>
        a.type === 'JSXAttribute' ? a.name.name : ''
      );
      if (!attrs.includes('onPress') && !attrs.includes('disabled')) {
        const line = p.node.loc ? p.node.loc.start.line : '?';
        fail(`BOTON ${rel(f)}:${line}: <${name.name}> sin onPress`);
      }
    },
  });
}

// Reporte
console.log(`Archivos parseados: ${parsed}/${files.length}`);
console.log(`Rutas registradas: ${registered.size} · rutas usadas: ${used.size}`);
if (errors.length) {
  console.log(`\n❌ ${errors.length} problema(s):`);
  errors.forEach((e) => console.log(`  - ${e}`));
  process.exit(1);
} else {
  console.log('✅ verde: 0 imports rotos · 0 rutas sin registrar · 0 botones sin onPress');
}
