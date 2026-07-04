import { Component, App, PluginManifest, Setting, TFile, TFolder } from 'obsidian';

export interface VaultSizeBarSettings {
    fontSize: number;
}

export const VAULT_SIZE_BAR_DEFAULTS: VaultSizeBarSettings = {
    fontSize: 11
};

export class VaultSizeBarModule extends Component {
    app: App;
    manifest: PluginManifest;
    pluginInstance: any;
    moduleId: string;
    
    private statusBarEl: HTMLDivElement | null = null;
    private leftSlot: HTMLSpanElement | null = null;
    private rightSlot: HTMLSpanElement | null = null;
    private lastClickedPath: string | null = null;

    constructor(app: App, manifest: PluginManifest, pluginInstance: any, moduleId: string) {
        super();
        this.app = app;
        this.manifest = manifest;
        this.pluginInstance = pluginInstance;
        this.moduleId = moduleId;
    }

    get settings(): VaultSizeBarSettings {
        return this.pluginInstance.settings.modulesData[this.moduleId];
    }

    async onload() {
        this.app.workspace.onLayoutReady(() => {
            this.createSizeBar();
            this.registerSizeEvents();
        });
    }

    onunload() {
        if (this.statusBarEl) {
            this.statusBarEl.remove();
        }
        const explorerLeaf = this.app.workspace.getLeavesOfType("file-explorer")[0];
        if (explorerLeaf?.view?.containerEl) {
            const filesContainer = explorerLeaf.view.containerEl.querySelector('.nav-files-container') as HTMLElement;
            if (filesContainer) filesContainer.style.paddingBottom = '';
        }
    }

    createSizeBar() {
        const fileExplorerView = this.app.workspace.getLeavesOfType("file-explorer")[0]?.view;
        if (!fileExplorerView) return;

        const container = fileExplorerView.containerEl;
        if (!container || container.querySelector('.obsidian-vault-size-bar')) return;

        container.style.position = 'relative';
        container.style.display = 'flex';
        container.style.flexDirection = 'column';

        this.statusBarEl = document.createElement('div');
        this.statusBarEl.addClass('obsidian-vault-size-bar');
        
        this.leftSlot = document.createElement('span');
        this.leftSlot.addClass('size-bar-left');
        
        this.rightSlot = document.createElement('span');
        this.rightSlot.addClass('size-bar-right');

        this.applyFontStyles();

        this.statusBarEl.appendChild(this.leftSlot);
        this.statusBarEl.appendChild(this.rightSlot);
        container.appendChild(this.statusBarEl);

        const filesContainer = container.querySelector('.nav-files-container') as HTMLElement;
        if (filesContainer) {
            filesContainer.style.paddingBottom = '30px';
        }

        this.updateBar();
    }

    applyFontStyles() {
        if (!this.leftSlot || !this.rightSlot) return;
        
        const size = this.settings.fontSize;
        const inlineFontStyles = `font-size: ${size}px !important; font-family: var(--font-interface) !important; color: var(--text-muted) !important; display: inline-block !important;`;
        
        this.leftSlot.style.cssText = inlineFontStyles + " float: left !important; text-align: left !important; max-width: 46%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;";
        this.rightSlot.style.cssText = inlineFontStyles + " float: right !important; text-align: right !important; max-width: 46%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;";
    }

    registerSizeEvents() {
        this.registerEvent(this.app.vault.on('modify', () => this.updateBar()));
        this.registerEvent(this.app.vault.on('create', () => this.updateBar()));
        this.registerEvent(this.app.vault.on('delete', () => this.updateBar()));

        this.registerDomEvent(document, 'click', (evt: MouseEvent) => {
            const target = evt.target as HTMLElement;
            const navItem = target.closest('.nav-file-title, .nav-folder-title');
            
            if (navItem) {
                const fileExplorer = this.app.workspace.getLeavesOfType("file-explorer")[0]?.view as any;
                if (!fileExplorer || !fileExplorer.fileItems) return;

                for (const [path, item] of Object.entries(fileExplorer.fileItems)) {
                    if ((item as any).titleEl === navItem || (item as any).el === navItem.parentElement) {
                        this.lastClickedPath = path;
                        this.updateBar();
                        break;
                    }
                }
            }
        });

        this.registerEvent(this.app.workspace.on('active-leaf-change', () => {
            const activeFile = this.app.workspace.getActiveFile();
            if (activeFile) {
                this.lastClickedPath = activeFile.path;
                this.updateBar();
            }
        }));
    }

    async updateBar() {
        if (!this.statusBarEl || !this.leftSlot || !this.rightSlot) return;

        let selectedSizeText = "Selected: 0 B";
        if (this.lastClickedPath) {
            const targetItem = this.app.vault.getAbstractFileByPath(this.lastClickedPath);
            if (targetItem) {
                const sizeBytes = this.calculateItemSize(targetItem);
                selectedSizeText = `Selected: ${this.formatBytes(sizeBytes)}`;
            }
        } else {
            const activeFile = this.app.workspace.getActiveFile();
            if (activeFile) {
                const sizeBytes = this.calculateItemSize(activeFile);
                selectedSizeText = `Selected: ${this.formatBytes(sizeBytes)}`;
            }
        }
        this.leftSlot.innerHTML = `&nbsp;${selectedSizeText}`;

        const totalBytes = await this.calculateVaultTotalSize();
        let rightText = `Total: ${this.formatBytes(totalBytes)}`;

        const syncPlugin = (this.app as any).internalPlugins?.plugins?.['sync'];
        if (syncPlugin && syncPlugin.enabled) {
            const syncInstance = syncPlugin.instance;
            let limitBytes = null;

            if (syncInstance?.api?.limit) limitBytes = syncInstance.api.limit;
            
            const userPlan = syncInstance?.api?.user?.plan;
            if (userPlan) {
                if (userPlan.toLowerCase().includes('standard') || userPlan.toLowerCase().includes('basic')) {
                    limitBytes = 1 * 1024 * 1024 * 1024; 
                } else if (userPlan.toLowerCase().includes('plus')) {
                    limitBytes = 10 * 1024 * 1024 * 1024; 
                } else if (userPlan.toLowerCase().includes('pro')) {
                    limitBytes = 50 * 1024 * 1024 * 1024; 
                }
            }

            if (!limitBytes) {
                if (syncInstance?.api?.getLimit) {
                    limitBytes = typeof syncInstance.api.getLimit === 'function' ? await syncInstance.api.getLimit() : syncInstance.api.getLimit;
                } else if (syncInstance?.config?.maxVaultSize) {
                    limitBytes = syncInstance.config.maxVaultSize;
                }
            }

            if (!limitBytes) limitBytes = 1 * 1024 * 1024 * 1024; 
            rightText += ` / ${this.formatBytes(limitBytes)}`;
        }

        this.rightSlot.innerHTML = `${rightText}&nbsp;`;
    }

    calculateItemSize(item: any): number {
        if (item instanceof TFile) {
            return item.stat.size;
        } else if (item instanceof TFolder) {
            let total = 0;
            this.getFolderSizeRecursively(item, (file) => {
                total += file.stat.size;
            });
            return total;
        }
        return 0;
    }

    getFolderSizeRecursively(folder: TFolder, callback: (file: TFile) => void) {
        if (!folder.children) return;
        for (const child of folder.children) {
            if (child instanceof TFile) {
                callback(child);
            } else if (child instanceof TFolder) {
                this.getFolderSizeRecursively(child, callback);
            }
        }
    }

    async calculateVaultTotalSize(): Promise<number> {
        let total = 0;
        const files = this.app.vault.getFiles();
        for (const file of files) {
            total += file.stat.size;
        }
        return total;
    }

    formatBytes(bytes: number): string {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    renderSettings(containerEl: HTMLElement) {
        new Setting(containerEl)
            .setName('Font Size (px)')
            .setDesc('Adjust the text scale inside the file explorer size bar zone.')
            .addSlider((slider) => {
                slider
                    .setLimits(7, 16, 0.5)
                    .setValue(this.settings.fontSize)
                    .setDynamicTooltip();
                
                slider.sliderEl.addEventListener('input', (e: any) => {
                    this.settings.fontSize = parseFloat(e.target.value);
                    this.applyFontStyles();
                });

                slider.onChange(async (value) => {
                    this.settings.fontSize = value;
                    await this.pluginInstance.saveSettings();
                    this.applyFontStyles();
                });
            });
    }
}