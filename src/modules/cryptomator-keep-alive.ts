import { Component, App, PluginManifest, Setting } from 'obsidian';

export interface CryptomatorKeepAliveSettings {
    intervalSeconds: number;
    mode: 'write' | 'write-delete';
    filePath: string;
}

export const CRYPTOMATOR_KEEP_ALIVE_DEFAULTS: CryptomatorKeepAliveSettings = {
    intervalSeconds: 28,
    mode: 'write-delete',
    filePath: 'ZZ - Dependencies/notion-like-plugins/keep-alive.tmp'
};

export class CryptomatorKeepAliveModule extends Component {
    app: App;
    manifest: PluginManifest;
    pluginInstance: any;
    moduleId: string;
    private intervalHandle: number | null = null;

    constructor(app: App, manifest: PluginManifest, pluginInstance: any, moduleId: string) {
        super();
        this.app = app;
        this.manifest = manifest;
        this.pluginInstance = pluginInstance;
        this.moduleId = moduleId;
    }

    get settings(): CryptomatorKeepAliveSettings {
        return this.pluginInstance.settings.modulesData[this.moduleId];
    }

    async onload() {
        this.startTicking();

        this.pluginInstance.addCommand({
            id: 'cryptomator-keepalive-read-now',
            name: 'Cryptomator Keep-Alive: trigger now',
            callback: () => this.tick()
        });
    }

    onunload() {
        this.stopTicking();
    }

    startTicking() {
        this.stopTicking();
        const seconds = Math.max(5, Number(this.settings.intervalSeconds) || 60);
        this.intervalHandle = window.setInterval(() => this.tick(), seconds * 1000);
    }

    stopTicking() {
        if (this.intervalHandle) {
            window.clearInterval(this.intervalHandle);
            this.intervalHandle = null;
        }
    }

    getTargetPath() {
        const custom = (this.settings.filePath || '').trim();
        return custom.length > 0 ? custom : `cryptomator-keepalive-heartbeat.tmp`;
    }

    async tick() {
        const path = this.getTargetPath();
        try {
            // Ensure parent directory exists
            const lastSlash = path.lastIndexOf('/');
            if (lastSlash > 0) {
                const dir = path.substring(0, lastSlash);
                if (!(await this.app.vault.adapter.exists(dir))) {
                    await this.app.vault.adapter.mkdir(dir);
                }
            }
            
            await this.app.vault.adapter.write(path, `keepalive:${Date.now()}`);
            if (this.settings.mode === 'write-delete') {
                await this.app.vault.adapter.remove(path);
            }
        } catch (err) {
            console.warn(`[cryptomator-keepalive] tick failed for "${path}":`, err);
        }
    }

    renderSettings(containerEl: HTMLElement) {
        new Setting(containerEl)
            .setName('Interval (seconds)')
            .setDesc('How often to touch the vault.')
            .addText((text) => text
                .setValue(String(this.settings.intervalSeconds))
                .onChange(async (value) => {
                    const parsed = Number(value);
                    this.settings.intervalSeconds = Number.isFinite(parsed) && parsed > 0 ? parsed : CRYPTOMATOR_KEEP_ALIVE_DEFAULTS.intervalSeconds;
                    await this.pluginInstance.saveSettings();
                    this.startTicking();
                })
            );

        new Setting(containerEl)
            .setName('Mode')
            .addDropdown((drop) => drop
                .addOption('write', 'Write')
                .addOption('write-delete', 'Write + delete')
                .setValue(this.settings.mode)
                .onChange(async (value: string) => {
                    this.settings.mode = value as 'write' | 'write-delete';
                    await this.pluginInstance.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName('Heartbeat file path (optional)')
            .setDesc('Vault-relative path, e.g. ".obsidian/keep-alive.tmp". Leave blank to use a default file name at your vault root.')
            .addText((text) => text
                .setPlaceholder('.obsidian/keep-alive.tmp')
                .setValue(this.settings.filePath || '')
                .onChange(async (value) => {
                    this.settings.filePath = value.trim();
                    await this.pluginInstance.saveSettings();
                })
            );
    }
}