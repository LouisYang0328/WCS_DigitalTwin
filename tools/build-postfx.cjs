/* Rebuild the checked-in, offline Three r149 postprocessing bundle.
 * Downloads/build dependencies live only in ignored tests/artifacts/vendor-build.
 * Run: node tools/build-postfx.cjs
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const childProcess = require('node:child_process');

const root = path.resolve(__dirname, '..');
const scratch = path.join(root, 'tests/artifacts/vendor-build');
const sourceDirectory = path.join(scratch, 'source');
const vendorDirectory = path.join(root, 'assets/vendor');
const threeVersion = '0.149.0';
const esbuildVersion = '0.25.12';
const expectedIntegrity = 'sha512-tohpUxPDht0qExRLDTM8sjRLc5d9STURNrdnK3w9A+V4pxaTBfKWWT/IqtiLfg23Vfc3Z+ImNfvRw1/0CtxrkQ==';
const sourceFiles = [
  ['EffectComposer', 'postprocessing/EffectComposer.js'],
  ['SSAOPass', 'postprocessing/SSAOPass.js'],
  ['ShaderPass', 'postprocessing/ShaderPass.js'],
  ['GammaCorrectionShader', 'shaders/GammaCorrectionShader.js'],
  ['FXAAShader', 'shaders/FXAAShader.js']
];

function npm(args) {
  const npmCli = [process.env.npm_execpath,
    path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')]
    .find(candidate => candidate && fs.existsSync(candidate));
  if (process.platform === 'win32' && !npmCli)
    throw new Error('Cannot locate npm-cli.js beside Node; run this build with a standard Node/npm installation.');
  return childProcess.execFileSync(npmCli ? process.execPath : 'npm', npmCli ? [npmCli, ...args] : args,
    { cwd: scratch, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

async function main() {
  fs.mkdirSync(scratch, { recursive: true });
  fs.mkdirSync(sourceDirectory, { recursive: true });
  fs.mkdirSync(vendorDirectory, { recursive: true });
  const pack = JSON.parse(npm(['pack', 'three@' + threeVersion, '--json', '--silent']))[0];
  if (pack.version !== threeVersion || pack.integrity !== expectedIntegrity)
    throw new Error('Unexpected three package version/integrity; refusing to vendor a different source.');
  const archive = path.join(scratch, pack.filename);
  const archiveIntegrity = 'sha512-' + crypto.createHash('sha512').update(fs.readFileSync(archive)).digest('base64');
  if (archiveIntegrity !== expectedIntegrity) throw new Error('Three package archive integrity mismatch.');
  childProcess.execFileSync('tar', ['-xf', archive, '-C', sourceDirectory], { stdio: 'pipe' });
  const packageDirectory = path.join(sourceDirectory, 'package');
  const packageJson = JSON.parse(fs.readFileSync(path.join(packageDirectory, 'package.json'), 'utf8'));
  if (packageJson.version !== threeVersion) throw new Error('Extracted source has the wrong version.');

  fs.writeFileSync(path.join(scratch, 'package.json'), JSON.stringify({ private: true, name: 'wcs-postfx-vendor-build', version: '1.0.0' }, null, 2) + '\n');
  npm(['install', '--ignore-scripts', '--no-audit', '--no-fund', '--save-exact', 'esbuild@' + esbuildVersion]);
  const esbuild = require(path.join(scratch, 'node_modules/esbuild'));
  if (esbuild.version !== esbuildVersion) throw new Error('Unexpected esbuild version.');
  // Export references to the application's existing engine; never bundle the
  // package's own three.module.js or create another copy of core classes.
  const runtimeThree = require(path.join(root, 'assets/three.min.js'));
  if (runtimeThree.REVISION !== '149') throw new Error('The application engine must also be r149.');
  const exports = Object.keys(runtimeThree).filter(name => /^[A-Za-z_$][\w$]*$/.test(name));
  const shim = exports.map(name => `export const ${name} = window.THREE.${name};`).join('\n');
  const entry = path.join(scratch, 'postfx-entry.mjs');
  fs.writeFileSync(entry, sourceFiles.map(([name, file]) =>
    `export { ${name} } from ${JSON.stringify(path.join(packageDirectory, 'examples/jsm', file).replaceAll('\\', '/'))};`).join('\n') +
    '\nexport const THREE_REVISION = "149";\n');
  const destination = path.join(vendorDirectory, 'three-postfx.min.js');
  const result = await esbuild.build({
    entryPoints: [entry], outfile: destination, bundle: true, minify: true, platform: 'browser',
    target: ['es2020'], format: 'iife', globalName: 'WcsPostFXComponents', legalComments: 'inline', metafile: true,
    banner: { js: '/*! Three.js r149 official postprocessing modules. MIT; FXAA includes NVIDIA terms. See three-postfx.LICENSE.txt. */' },
    footer: { js: 'window.WcsPostFXComponents = WcsPostFXComponents;' },
    plugins: [{ name: 'existing-three-runtime', setup(build) {
      build.onResolve({ filter: /^three$/ }, () => ({ path: 'existing-three', namespace: 'wcs-window-three' }));
      build.onLoad({ filter: /.*/, namespace: 'wcs-window-three' }, () => ({ contents: shim, loader: 'js' }));
    } }]
  });
  const inputs = Object.keys(result.metafile.inputs);
  if (inputs.some(file => /[/\\](?:build|src)[/\\]three/i.test(file)))
    throw new Error('Unexpected bundled Three core; inspect the shim before distributing.');
  const fxaa = fs.readFileSync(path.join(packageDirectory, 'examples/jsm/shaders/FXAAShader.js'), 'utf8');
  const nvidia = fxaa.slice(fxaa.indexOf('// Copyright (c) 2014-2015, NVIDIA'), fxaa.indexOf('//----------------------------------------------------------------------------------', fxaa.indexOf('// Copyright (c) 2014-2015, NVIDIA')))
    .split('\n').map(line => line.replace(/^\s*\/\/ ?/, '')).join('\n').trim();
  const license = fs.readFileSync(path.join(packageDirectory, 'LICENSE'), 'utf8');
  fs.writeFileSync(path.join(vendorDirectory, 'three-postfx.LICENSE.txt'),
    'THREE.JS r149 (' + threeVersion + ')\nhttps://github.com/mrdoob/three.js/tree/r149\n\n' + license +
    '\n\nNVIDIA FXAA TERMS (retained verbatim in the bundled shader)\n\n' + nvidia +
    '\n\nSimplexNoise port attribution: Stefan Gustavson; Sean McCullough <banksean@gmail.com>.\n');
  const bundle = fs.readFileSync(destination);
  const manifest = {
    package: 'three', version: threeVersion, revision: runtimeThree.REVISION, packageIntegrity: expectedIntegrity,
    builder: 'esbuild@' + esbuildVersion, runtime: 'window.THREE (existing assets/three.min.js; no bundled core)',
    sourceModules: sourceFiles.map(([, file]) => 'https://github.com/mrdoob/three.js/blob/r149/examples/jsm/' + file),
    includedSourceFiles: inputs.filter(file => !file.includes('wcs-window-three') && !file.includes('postfx-entry'))
      .map(file => file.replaceAll('\\', '/').split('/examples/jsm/')[1]).filter(Boolean),
    output: 'three-postfx.min.js', bytes: bundle.length,
    sha256: crypto.createHash('sha256').update(bundle).digest('hex')
  };
  fs.writeFileSync(path.join(vendorDirectory, 'three-postfx.sources.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Built Three r149 postprocessing: ${bundle.length} bytes, ${manifest.includedSourceFiles.length} official source modules, no engine duplication.`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
