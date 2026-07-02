const { Plugin, PluginSettingTab, Setting } = require('obsidian');
const fs = require('fs');
const path = require('path');
const Module = require('module');

const DEFAULT_SETTINGS = { enabledModules: {} };

module.exports = class MasterOrchestratorPlugin extends Plugin {
    async onload() {
        await this.loadSettings();
        this.addSettingTab(new OrchestratorSettingTab(this.app, this));
        
        this.activeInstances = {};
        this.discoveredPlugins = {};

        this.setupModuleInterceptor();

        const adapter = this.app.vault.adapter;
        const vaultPath = adapter.getBasePath();
        this.poolDir = path.join(vaultPath, this.manifest.dir, 'plugins-pool');

        this.discoverModules();
    }

    setupModuleInterceptor() {
        const originalResolveFilename = Module._resolveFilename;
        Module._resolveFilename = function (request, parent, isMain, options) {
            if (request === 'obsidian') {
                return __filename;
            }
            return originalResolveFilename.apply(this, arguments);
        };

        const originalLoad = Module._load;
        Module._load = function (request, parent, isMain) {
            if (request === 'obsidian' || (request === __filename && parent && parent.id.includes('plugins-pool'))) {
                return require('obsidian');
            }
            return originalLoad.apply(this, arguments);
        };
    }

    discoverModules() {
        if (!fs.existsSync(this.poolDir)) {
            try { fs.mkdirSync(this.poolDir, { recursive: true }); } catch (e) {}
            return;
        }

        const items = fs.readdirSync(this.poolDir);
        items.forEach(itemName => {
            const itemPath = path.join(this.poolDir, itemName);
            const stats = fs.statSync(itemPath);

            if (stats.isDirectory()) {
                const manifestPath = path.join(itemPath, 'manifest.json');
                let scriptPath = path.join(itemPath, 'main.js');
                if (!fs.existsSync(scriptPath)) {
                    scriptPath = path.join(itemPath, `${itemName}.js`);
                }

                if (fs.existsSync(manifestPath) && fs.existsSync(scriptPath)) {
                    try {
                        const manifestRaw = fs.readFileSync(manifestPath, 'utf8');
                        const subManifest = JSON.parse(manifestRaw);
                        const moduleId = subManifest.id || itemName;

                        this.discoveredPlugins[moduleId] = {
                            name: subManifest.name || moduleId,
                            desc: subManifest.description || "No description provided.",
                            scriptPath: scriptPath,
                            dirPath: itemPath,
                            manifest: subManifest
                        };

                        if (this.settings.enabledModules[moduleId]) {
                            this.loadSubPluginStyles(moduleId);
                            this.startModule(moduleId);
                        }
                    } catch (e) {
                        console.error(`Orchestrator failed to index folder [${itemName}]:`, e);
                    }
                }
            }
        });
    }

    async startModule(id) {
        if (this.activeInstances[id]) return;
        try {
            const targetData = this.discoveredPlugins[id];
            if (!targetData) return;

            const rawCode = fs.readFileSync(targetData.scriptPath, 'utf8');
            const wrapperCode = `(function(exports, require, module, __filename, __dirname) { ${rawCode} \n});`;
            const compiledFunction = window.eval(wrapperCode);
            const customModule = { exports: {} };
            
            compiledFunction(customModule.exports, require, customModule, targetData.scriptPath, targetData.dirPath);

            let StandalonePluginClass = null;
            if (typeof customModule.exports === 'function') {
                StandalonePluginClass = customModule.exports;
            } else if (customModule.exports && typeof customModule.exports.default === 'function') {
                StandalonePluginClass = customModule.exports.default;
            }

            if (!StandalonePluginClass) {
                throw new Error("No valid executable Plugin class found in module exports.");
            }
            
            const subManifestContext = Object.assign({}, targetData.manifest, {
                dir: this.manifest.dir + '/plugins-pool/' + id
            });

            const instance = new StandalonePluginClass(this.app, subManifestContext);
            instance.app = this.app;
            instance.manifest = subManifestContext;

            // FIX: addChild automatically calls instance.load() -> instance.onload() natively.
            // We do not call instance.onload() manually here to prevent double event binding.
            this.addChild(instance); 
            
            this.activeInstances[id] = instance;
            console.log(`[Master Orchestrator] Successfully executed module: ${id}`);
        } catch (e) {
            console.error(`Runtime boot failure for sub-plugin [${id}]:`, e);
            this.settings.enabledModules[id] = false;
            this.saveSettings();
        }
    }

    stopModule(id) {
        const instance = this.activeInstances[id];
        if (instance) {
            try {
                // removeChild automatically calls instance.unload() -> instance.onunload() internally
                this.removeChild(instance);
            } catch (e) {
                console.error(`Graceful unload failed for [${id}]:`, e);
            }
            delete this.activeInstances[id];
            console.log(`[Master Orchestrator] Successfully stopped module: ${id}`);
        }
    }

    loadSubPluginStyles(id) {
        const targetData = this.discoveredPlugins[id];
        if (!targetData) return;
        const cssPath = path.join(targetData.dirPath, 'styles.css');
        
        if (fs.existsSync(cssPath)) {
            try {
                const cssContent = fs.readFileSync(cssPath, 'utf8');
                let styleEl = document.getElementById(`master-toolkit-style-${id}`);
                if (!styleEl) {
                    styleEl = document.createElement('style');
                    styleEl.id = `master-toolkit-style-${id}`;
                    document.head.appendChild(styleEl);
                }
                styleEl.textContent = cssContent;
            } catch (e) {
                console.error(`Failed to inject styles for [${id}]:`, e);
            }
        }
    }

    unloadSubPluginStyles(id) {
        const styleEl = document.getElementById(`master-toolkit-style-${id}`);
        if (styleEl) styleEl.remove();
    }

    async loadSettings() { this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData()); }
    async saveSettings() { await this.saveData(this.settings); }
    
    onunload() { 
        Object.keys(this.activeInstances).forEach(id => this.stopModule(id)); 
        Object.keys(this.discoveredPlugins).forEach(id => this.unloadSubPluginStyles(id));
    }
}

class OrchestratorSettingTab extends PluginSettingTab {
    constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
    display() {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl('h2', { text: 'Plugin Sandbox Orchestrator' });
        
        const discoveredKeys = Object.keys(this.plugin.discoveredPlugins);
        if (discoveredKeys.length === 0) {
            containerEl.createEl('i', { text: 'No standalone plugin folders discovered yet.' });
            return;
        }

        discoveredKeys.forEach(id => {
            const config = this.plugin.discoveredPlugins[id];
            new Setting(containerEl)
                .setName(config.name)
                .setDesc(config.desc)
                .addToggle(toggle => toggle
                    .setValue(this.plugin.settings.enabledModules[id] || false)
                    .onChange(async (value) => {
                        this.plugin.settings.enabledModules[id] = value;
                        await this.plugin.saveSettings();
                        if (value) {
                            this.plugin.loadSubPluginStyles(id);
                            this.plugin.startModule(id);
                        } else {
                            this.plugin.stopModule(id);
                            this.plugin.unloadSubPluginStyles(id);
                            this.app.workspace.trigger('css-change'); 
                        }
                    }));
        });
    }
}