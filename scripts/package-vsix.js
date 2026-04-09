const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const pkg = require(path.join(projectRoot, 'package.json'));

const vsixDir = path.join(projectRoot, 'artifacts', 'vsix');
const vsixPath = path.join(vsixDir, `${pkg.name}-${pkg.version}.vsix`);

fs.mkdirSync(vsixDir, { recursive: true });

const run = (command, args) => {
  let executable = command;
  let finalArgs = args;

  if (process.platform === 'win32' && command === 'npx') {
    executable = 'cmd';
    finalArgs = ['/c', 'npx', ...args];
  }

  const result = spawnSync(executable, finalArgs, {
    cwd: projectRoot,
    stdio: 'inherit'
  });

  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

run('node', ['esbuild.js', '--production']);
run('npx', ['vsce', 'package', '--out', vsixPath]);

