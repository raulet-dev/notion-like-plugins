const fs = require('fs');
const path = require('path');

// Custom esbuild plugin for virtual:modules
const virtualModulesPlugin = {
    name: 'virtual-modules',
    setup(build) {
        build.onResolve({ filter: /^virtual:modules$/ }, () => {
            return {
                path: 'virtual-modules',
                namespace: 'virtual-modules'
            };
        });

        build.onLoad({ filter: /.*/, namespace: 'virtual-modules' }, () => {
            const modulesDir = path.join(__dirname, 'src', 'modules');
            const modules = fs.readdirSync(modulesDir)
                .filter(f => f.endsWith('.ts') && f !== 'index.ts')
                .map(f => f.replace('.ts', ''));

            // Generate module metadata
            const imports = modules
                .map((mod, idx) => `import { ${getClassName(mod)}, ${getDefaultsName(mod)} } from './modules/${mod}';`)
                .join('\n');

            const autoModulesObj = modules
                .map(mod => {
                    const className = getClassName(mod);
                    const defaultsName = getDefaultsName(mod);
                    return `"${mod}": { classRef: ${className}, defaults: ${defaultsName} }`;
                })
                .join(',\n');

            const code = `
${imports}

export const autoModules = {
${autoModulesObj}
};
`;

            return {
                contents: code,
                loader: 'js'
            };
        });
    }
};

function getClassName(moduleName) {
    return moduleName
        .split('-')
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join('') + 'Module';
}

function getDefaultsName(moduleName) {
    return moduleName
        .toUpperCase()
        .split('-')
        .join('_') + '_DEFAULTS';
}

module.exports = {
    entryPoints: ['src/main.ts'],
    bundle: true,
    outfile: 'main.js',
    external: ['obsidian'],
    format: 'cjs',
    plugins: [virtualModulesPlugin]
};
