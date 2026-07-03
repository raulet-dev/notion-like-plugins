const { Plugin, PluginSettingTab, Setting } = require('obsidian');

const DEFAULTS = {
    intervalSeconds: 60,
    // 'write'       -> overwrite the heartbeat file with fresh content each tick
    // 'write-delete'-> write it, then immediately delete it (create+delete cycle)
    mode: 'write',
    // If left empty, uses a hidden heartbeat file inside this module's own
    // plugin folder (so it never shows up in the note explorer or sync diffs
    // as a "note").
    filePath: ''
};

module.exports = class CryptomatorKeepAlivePlugin extends Plugin {
    async onload() {
        this.settings = Object.assign({}, DEFAULTS, await this.loadData());

        this.intervalHandle = null;
        this.startTicking();

        this.addCommand({
            id: 'cryptomator-keepalive-read-now',
            name: 'Cryptomator Keep-Alive: trigger now',
            callback: () => this.tick()
        });

        this.addSettingTab(new CryptomatorKeepAliveSettingTab(this.app, this));
    }

    onunload() {
        if (this.intervalHandle) {
            window.clearInterval(this.intervalHandle);
            this.intervalHandle = null;
        }
    }

    startTicking() {
        if (this.intervalHandle) {
            window.clearInterval(this.intervalHandle);
        }
        const seconds = Math.max(5, Number(this.settings.intervalSeconds) || 60);
        this.intervalHandle = this.registerInterval(
            window.setInterval(() => this.tick(), seconds * 1000)
        );
    }

    getTargetPath() {
        const custom = (this.settings.filePath || '').trim();
        if (custom.length > 0) return custom;
        // return `${this.manifest.dir}/cryptomator-keepalive-heartbeat.tmp`;
        return `cryptomator-keepalive-heartbeat.tmp`;
    }

    async tick() {
        const path = this.getTargetPath();
        try {
            // Write fresh content every time -- a write always has to reach
            // the underlying encrypted volume, unlike a read, which can be
            // served from cache (and won't touch atime on filesystems
            // mounted with noatime, which is common).
            await this.app.vault.adapter.write(path, `keepalive:${Date.now()}`);

            if (this.settings.mode === 'write-delete') {
                await this.app.vault.adapter.remove(path);
            }
        } catch (err) {
            console.warn(`[cryptomator-keepalive] tick failed for "${path}":`, err);
        }
    }

    async persistSettings() {
        await this.saveData(this.settings);
    }
};

class CryptomatorKeepAliveSettingTab extends PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display() {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl('h2', { text: 'Cryptomator Keep-Alive' });

        new Setting(containerEl)
            .setName('Interval (seconds)')
            .setDesc('How often to touch the vault. Keep this comfortably below your Cryptomator idle-lock timeout (e.g. 60s for a 3-minute timeout).')
            .addText((text) =>
                text
                    .setPlaceholder('60')
                    .setValue(String(this.plugin.settings.intervalSeconds))
                    .onChange(async (value) => {
                        const parsed = Number(value);
                        this.plugin.settings.intervalSeconds = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULTS.intervalSeconds;
                        await this.plugin.persistSettings();
                        this.plugin.startTicking();
                    })
            );

        new Setting(containerEl)
            .setName('Mode')
            .setDesc('"Write" overwrites a small heartbeat file each tick. "Write + delete" also removes it right after, if your setup needs a full create/delete cycle to register as activity.')
            .addDropdown((drop) =>
                drop
                    .addOption('write', 'Write')
                    .addOption('write-delete', 'Write + delete')
                    .setValue(this.plugin.settings.mode)
                    .onChange(async (value) => {
                        this.plugin.settings.mode = value;
                        await this.plugin.persistSettings();
                    })
            );

        new Setting(containerEl)
            .setName('Heartbeat file path (optional)')
            .setDesc('Vault-relative path, e.g. "Notes/keepalive.md". Leave blank to use a hidden file inside the plugin folder.')
            .addText((text) =>
                text
                    .setPlaceholder('(default: hidden heartbeat file)')
                    .setValue(this.plugin.settings.filePath)
                    .onChange(async (value) => {
                        this.plugin.settings.filePath = value;
                        await this.plugin.persistSettings();
                    })
            );
    }
}