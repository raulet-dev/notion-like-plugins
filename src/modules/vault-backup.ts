import { App, Component, Modal, Notice, Platform, PluginManifest, Setting } from 'obsidian';

declare const require: any;

export interface VaultBackupSettings {
    backupPath: string;
    cronExpression: string;
    automaticBackupsToKeep: number;
    compressionMethod: BackupCompressionMethod;
    encryptionEnabled: boolean;
}

export type BackupCompressionMethod = 'none' | 'fast' | 'balanced' | 'maximum';

export const VAULT_BACKUP_DEFAULTS: VaultBackupSettings = {
    backupPath: '',
    cronExpression: '0 */6 * * *',
    automaticBackupsToKeep: 10,
    compressionMethod: 'fast',
    encryptionEnabled: false
};

const ARCHIVE_MAGIC = 'NLVBK001';
const ARCHIVE_HEADER_SIZE = 8 + 1 + 16 + 12;
const AUTH_TAG_SIZE = 16;
const CREDENTIAL_SERVICE = 'notion-like-plugins/vault-backup';

interface BackupFileInfo {
    name: string;
    absolutePath: string;
    size: number;
    modifiedMs: number;
    encrypted: boolean;
    automatic: boolean;
    format: '7z' | 'legacy';
}

interface CronField {
    values: Set<number>;
    wildcard: boolean;
}

interface ParsedCron {
    minute: CronField;
    hour: CronField;
    day: CronField;
    month: CronField;
    weekday: CronField;
}

function getNodeRequire(): any {
    const globalRequire = (globalThis as any).require;
    if (typeof globalRequire === 'function') return globalRequire;
    if (typeof require === 'function') return require;
    throw new Error('Desktop filesystem APIs are unavailable in this runtime.');
}

function parseCronField(source: string, min: number, max: number, allowSundaySeven = false): CronField {
    const values = new Set<number>();
    const wildcard = source === '*' || source.startsWith('*/');

    for (const part of source.split(',')) {
        if (!part) throw new Error('Cron fields cannot contain empty list items.');
        const [rangeText, stepText] = part.split('/');
        if (part.split('/').length > 2) throw new Error(`Invalid cron token: ${part}`);

        const step = stepText === undefined ? 1 : Number(stepText);
        if (!Number.isInteger(step) || step < 1) throw new Error(`Invalid cron step: ${part}`);

        let start: number;
        let end: number;
        if (rangeText === '*') {
            start = min;
            end = max;
        } else if (rangeText.includes('-')) {
            const pieces = rangeText.split('-');
            if (pieces.length !== 2) throw new Error(`Invalid cron range: ${part}`);
            start = Number(pieces[0]);
            end = Number(pieces[1]);
        } else {
            start = Number(rangeText);
            end = start;
        }

        const acceptedMax = allowSundaySeven ? 7 : max;
        if (!Number.isInteger(start) || !Number.isInteger(end) || start < min || end > acceptedMax || start > end) {
            throw new Error(`Cron value is outside ${min}-${acceptedMax}: ${part}`);
        }

        for (let value = start; value <= end; value += step) {
            values.add(allowSundaySeven && value === 7 ? 0 : value);
        }
    }

    if (values.size === 0) throw new Error('Cron field has no matching values.');
    return { values, wildcard };
}

function parseCronExpression(expression: string): ParsedCron {
    const fields = expression.trim().split(/\s+/);
    if (fields.length !== 5) {
        throw new Error('Use five cron fields: minute hour day month weekday.');
    }

    return {
        minute: parseCronField(fields[0], 0, 59),
        hour: parseCronField(fields[1], 0, 23),
        day: parseCronField(fields[2], 1, 31),
        month: parseCronField(fields[3], 1, 12),
        weekday: parseCronField(fields[4], 0, 6, true)
    };
}

function cronDateMatches(schedule: ParsedCron, date: Date): boolean {
    if (!schedule.month.values.has(date.getMonth() + 1)) return false;

    const dayMatches = schedule.day.values.has(date.getDate());
    const weekdayMatches = schedule.weekday.values.has(date.getDay());

    if (!schedule.day.wildcard && !schedule.weekday.wildcard) {
        return dayMatches || weekdayMatches;
    }

    return dayMatches && weekdayMatches;
}

function latestCronOccurrenceBetween(
    schedule: ParsedCron,
    afterExclusive: Date,
    throughInclusive: Date
): Date | null {
    const afterMs = afterExclusive.getTime();
    const throughMs = throughInclusive.getTime();
    if (afterMs >= throughMs) return null;

    const hours = [...schedule.hour.values].sort((left, right) => left - right);
    const minutes = [...schedule.minute.values].sort((left, right) => left - right);

    const day = new Date(
        afterExclusive.getFullYear(),
        afterExclusive.getMonth(),
        afterExclusive.getDate()
    );
    const finalDay = new Date(
        throughInclusive.getFullYear(),
        throughInclusive.getMonth(),
        throughInclusive.getDate()
    );
    let latest: Date | null = null;

    while (day.getTime() <= finalDay.getTime()) {
        if (cronDateMatches(schedule, day)) {
            for (const hour of hours) {
                for (const minute of minutes) {
                    const occurrence = new Date(
                        day.getFullYear(),
                        day.getMonth(),
                        day.getDate(),
                        hour,
                        minute,
                        0,
                        0
                    );

                    if (
                        occurrence.getFullYear() !== day.getFullYear() ||
                        occurrence.getMonth() !== day.getMonth() ||
                        occurrence.getDate() !== day.getDate() ||
                        occurrence.getHours() !== hour ||
                        occurrence.getMinutes() !== minute
                    ) {
                        continue;
                    }

                    const occurrenceMs = occurrence.getTime();
                    if (occurrenceMs > afterMs && occurrenceMs <= throughMs) {
                        latest = occurrence;
                    }
                }
            }
        }

        day.setDate(day.getDate() + 1);
        day.setHours(0, 0, 0, 0);
    }

    return latest;
}

function cronMinuteKey(date: Date): string {
    return [date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), date.getMinutes()].join('-');
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let value = bytes / 1024;
    let unit = units[0];
    for (let index = 1; index < units.length && value >= 1024; index += 1) {
        value /= 1024;
        unit = units[index];
    }
    return `${value.toFixed(value >= 10 ? 1 : 2)} ${unit}`;
}

function normalizedCompressionMethod(value: unknown): BackupCompressionMethod {
    return value === 'none' || value === 'fast' || value === 'balanced' || value === 'maximum'
        ? value
        : VAULT_BACKUP_DEFAULTS.compressionMethod;
}

function compressionPreset(method: BackupCompressionMethod): string {
    if (method === 'none') return '0';
    if (method === 'fast') return '1';
    if (method === 'balanced') return '5';
    return '9';
}

class ConfirmActionModal extends Modal {
    private settled = false;
    private readonly titleText: string;
    private readonly messageText: string;
    private readonly confirmText: string;
    private readonly destructive: boolean;
    private readonly resolveResult: (value: boolean) => void;

    constructor(app: App, title: string, message: string, confirmText: string, destructive: boolean, resolve: (value: boolean) => void) {
        super(app);
        this.titleText = title;
        this.messageText = message;
        this.confirmText = confirmText;
        this.destructive = destructive;
        this.resolveResult = resolve;
    }

    onOpen() {
        this.contentEl.createEl('h2', { text: this.titleText });
        this.contentEl.createEl('p', { text: this.messageText });
        new Setting(this.contentEl)
            .addButton(button => button
                .setButtonText('Cancel')
                .onClick(() => this.finish(false)))
            .addButton(button => {
                button.setButtonText(this.confirmText);
                if (this.destructive) button.setWarning();
                else button.setCta();
                button.onClick(() => this.finish(true));
            });
    }

    onClose() {
        this.contentEl.empty();
        if (!this.settled) this.finish(false, false);
    }

    private finish(value: boolean, close = true) {
        if (this.settled) return;
        this.settled = true;
        this.resolveResult(value);
        if (close) this.close();
    }
}

class PasswordPromptModal extends Modal {
    private settled = false;
    private passwordInput: HTMLInputElement | null = null;
    private confirmationInput: HTMLInputElement | null = null;

    constructor(
        app: App,
        private readonly titleText: string,
        private readonly messageText: string,
        private readonly confirmText: string,
        private readonly requireConfirmation: boolean,
        private readonly resolveResult: (value: string | null) => void
    ) {
        super(app);
    }

    onOpen() {
        this.contentEl.createEl('h2', { text: this.titleText });
        this.contentEl.createEl('p', { text: this.messageText });

        new Setting(this.contentEl)
            .setName('Password')
            .addText(text => {
                this.passwordInput = text.inputEl;
                text.inputEl.type = 'password';
                text.setPlaceholder('Archive password');
            });

        if (this.requireConfirmation) {
            new Setting(this.contentEl)
                .setName('Confirm password')
                .addText(text => {
                    this.confirmationInput = text.inputEl;
                    text.inputEl.type = 'password';
                    text.setPlaceholder('Repeat archive password');
                });
        }

        const submit = () => this.submit();
        this.contentEl.addEventListener('keydown', event => {
            if (event.key === 'Enter') {
                event.preventDefault();
                submit();
            }
        });

        new Setting(this.contentEl)
            .addButton(button => button
                .setButtonText('Cancel')
                .onClick(() => this.finish(null)))
            .addButton(button => button
                .setButtonText(this.confirmText)
                .setCta()
                .onClick(submit));

        window.setTimeout(() => this.passwordInput?.focus(), 0);
    }

    onClose() {
        this.contentEl.empty();
        if (!this.settled) this.finish(null, false);
    }

    private submit() {
        const password = this.passwordInput?.value ?? '';
        if (!password) {
            new Notice('Enter an archive password.');
            return;
        }
        if (/[\x00-\x1f\x7f]/.test(password)) {
            new Notice('The password cannot contain control characters.');
            return;
        }
        if (this.requireConfirmation && password !== (this.confirmationInput?.value ?? '')) {
            new Notice('The passwords do not match.');
            this.confirmationInput?.focus();
            return;
        }
        this.finish(password);
    }

    private finish(value: string | null, close = true) {
        if (this.settled) return;
        this.settled = true;
        this.resolveResult(value);
        if (close) this.close();
    }
}

class ManualBackupPasswordModal extends Modal {
    private settled = false;
    private useDefault = false;
    private passwordInput: HTMLInputElement | null = null;
    private confirmationInput: HTMLInputElement | null = null;

    constructor(
        app: App,
        private readonly defaultAvailable: boolean,
        private readonly resolveResult: (value: { useDefault: boolean; password: string | null } | null) => void
    ) {
        super(app);
    }

    onOpen() {
        this.contentEl.createEl('h2', { text: 'Create encrypted backup' });
        this.contentEl.createEl('p', {
            text: 'Enter a password for this backup, or choose the default password saved in this device’s credential store.'
        });

        if (this.defaultAvailable) {
            new Setting(this.contentEl)
                .setName('Use default password')
                .setDesc('Use the password saved in this device’s credential store for this backup.')
                .addToggle(toggle => toggle
                    .setValue(false)
                    .onChange(value => {
                        this.useDefault = value;
                        if (this.passwordInput) this.passwordInput.disabled = value;
                        if (this.confirmationInput) this.confirmationInput.disabled = value;
                    }));
        }

        new Setting(this.contentEl)
            .setName('Password')
            .addText(text => {
                this.passwordInput = text.inputEl;
                text.inputEl.type = 'password';
                text.setPlaceholder('Archive password');
            });
        new Setting(this.contentEl)
            .setName('Confirm password')
            .addText(text => {
                this.confirmationInput = text.inputEl;
                text.inputEl.type = 'password';
                text.setPlaceholder('Repeat archive password');
            });

        new Setting(this.contentEl)
            .addButton(button => button.setButtonText('Cancel').onClick(() => this.finish(null)))
            .addButton(button => button.setButtonText('Create backup').setCta().onClick(() => this.submit()));
        window.setTimeout(() => this.passwordInput?.focus(), 0);
    }

    onClose() {
        this.contentEl.empty();
        if (!this.settled) this.finish(null, false);
    }

    private submit() {
        if (this.useDefault && this.defaultAvailable) {
            this.finish({ useDefault: true, password: null });
            return;
        }
        const password = this.passwordInput?.value ?? '';
        if (!password || /[\x00-\x1f\x7f]/.test(password)) {
            new Notice('Enter a password without control characters.');
            return;
        }
        if (password !== (this.confirmationInput?.value ?? '')) {
            new Notice('The passwords do not match.');
            this.confirmationInput?.focus();
            return;
        }
        this.finish({ useDefault: false, password });
    }

    private finish(value: { useDefault: boolean; password: string | null } | null, close = true) {
        if (this.settled) return;
        this.settled = true;
        this.resolveResult(value);
        if (close) this.close();
    }
}

class RecoveryPasswordModal extends Modal {
    private settled = false;
    private useDefault = false;
    private passwordInput: HTMLInputElement | null = null;

    constructor(
        app: App,
        private readonly defaultAvailable: boolean,
        private readonly resolveResult: (value: { useDefault: boolean; password: string | null } | null) => void
    ) {
        super(app);
    }

    onOpen() {
        this.contentEl.createEl('h2', { text: 'Unlock encrypted backup' });
        this.contentEl.createEl('p', { text: 'Enter this archive’s password to verify and restore it.' });
        if (this.defaultAvailable) {
            new Setting(this.contentEl)
                .setName('Use default password')
                .setDesc('Use the password saved in this device’s credential store.')
                .addToggle(toggle => toggle.setValue(false).onChange(value => {
                    this.useDefault = value;
                    if (this.passwordInput) this.passwordInput.disabled = value;
                }));
        }
        new Setting(this.contentEl)
            .setName('Password')
            .addText(text => {
                this.passwordInput = text.inputEl;
                text.inputEl.type = 'password';
                text.setPlaceholder('Archive password');
            });
        new Setting(this.contentEl)
            .addButton(button => button.setButtonText('Cancel').onClick(() => this.finish(null)))
            .addButton(button => button.setButtonText('Unlock and restore').setCta().onClick(() => this.submit()));
        window.setTimeout(() => this.passwordInput?.focus(), 0);
    }

    onClose() {
        this.contentEl.empty();
        if (!this.settled) this.finish(null, false);
    }

    private submit() {
        if (this.useDefault && this.defaultAvailable) {
            this.finish({ useDefault: true, password: null });
            return;
        }
        const password = this.passwordInput?.value ?? '';
        if (!password || /[\x00-\x1f\x7f]/.test(password)) {
            new Notice('Enter a password without control characters.');
            return;
        }
        this.finish({ useDefault: false, password });
    }

    private finish(value: { useDefault: boolean; password: string | null } | null, close = true) {
        if (this.settled) return;
        this.settled = true;
        this.resolveResult(value);
        if (close) this.close();
    }
}

class BufferedStreamReader {
    private readonly iterator: AsyncIterator<any>;
    private buffered: any;
    private ended = false;

    constructor(stream: any, private readonly BufferClass: any) {
        this.iterator = stream[Symbol.asyncIterator]();
        this.buffered = BufferClass.alloc(0);
    }

    private async fill(): Promise<boolean> {
        if (this.buffered.length > 0) return true;
        if (this.ended) return false;
        const next = await this.iterator.next();
        if (next.done) {
            this.ended = true;
            return false;
        }
        this.buffered = this.BufferClass.from(next.value);
        return true;
    }

    async readExactly(length: number): Promise<any> {
        const pieces: any[] = [];
        let remaining = length;
        while (remaining > 0) {
            if (!(await this.fill())) throw new Error('Backup archive ended unexpectedly.');
            const take = Math.min(remaining, this.buffered.length);
            pieces.push(this.buffered.subarray(0, take));
            this.buffered = this.buffered.subarray(take);
            remaining -= take;
        }
        return this.BufferClass.concat(pieces, length);
    }

    async pipeExactly(length: number, target: any): Promise<void> {
        let remaining = length;
        while (remaining > 0) {
            if (!(await this.fill())) throw new Error('Backup file data ended unexpectedly.');
            const take = Math.min(remaining, this.buffered.length);
            await writeChunk(target, this.buffered.subarray(0, take));
            this.buffered = this.buffered.subarray(take);
            remaining -= take;
        }
    }

    async expectEnd(): Promise<void> {
        if (this.buffered.length > 0) throw new Error('Backup archive has unexpected trailing data.');
        const next = await this.iterator.next();
        if (!next.done) throw new Error('Backup archive has unexpected trailing data.');
        this.ended = true;
    }
}

function writeChunk(stream: any, chunk: any): Promise<void> {
    return new Promise((resolve, reject) => {
        stream.write(chunk, (error: Error | null | undefined) => error ? reject(error) : resolve());
    });
}

function closeWritable(stream: any): Promise<void> {
    return new Promise((resolve, reject) => {
        stream.once('error', reject);
        stream.end(() => resolve());
    });
}

export class VaultBackupModule extends Component {
    app: App;
    manifest: PluginManifest;
    pluginInstance: any;
    moduleId: string;
    private operationRunning = false;
    private lastCronMinute = '';
    private lastHandledAutomaticOccurrenceMs: number | null = null;
    private sevenZipExecutable: string | null = null;
    private sevenZipPasswordPipeChecked = false;
    private sevenZipReadPasswordModes: { t: boolean; x: boolean } | null = null;
    private sessionEncryptionPassword: string | null = null;
    private backupListContainer: HTMLElement | null = null;

    constructor(app: App, manifest: PluginManifest, pluginInstance: any, moduleId: string) {
        super();
        this.app = app;
        this.manifest = manifest;
        this.pluginInstance = pluginInstance;
        this.moduleId = moduleId;
    }

    get settings(): VaultBackupSettings {
        return this.pluginInstance.settings.modulesData[this.moduleId];
    }

    onload() {
        const storedSettings = this.settings as VaultBackupSettings & { encryptionKey?: string };
        if (Object.prototype.hasOwnProperty.call(storedSettings, 'encryptionKey')) {
            delete storedSettings.encryptionKey;
            void this.pluginInstance.saveSettings();
        }
        if (!Platform.isDesktopApp) return;

        this.lastCronMinute = '';
        void this.runScheduledBackupIfDue();

        this.registerInterval(window.setInterval(() => void this.runScheduledBackupIfDue(), 20_000));
    }

    onunload() {
        this.sessionEncryptionPassword = null;
        this.sevenZipExecutable = null;
        this.sevenZipPasswordPipeChecked = false;
        this.sevenZipReadPasswordModes = null;
    }

    private async runScheduledBackupIfDue() {
        const now = new Date();
        const minuteKey = cronMinuteKey(now);
        if (minuteKey === this.lastCronMinute) return;
        this.lastCronMinute = minuteKey;

        try {
            if (!this.settings.backupPath.trim()) return;

            const schedule = parseCronExpression(this.settings.cronExpression);
            const backups = await this.listBackups();
            const latestBackup = backups[0];
            const dueOccurrence = latestBackup
                ? latestCronOccurrenceBetween(schedule, new Date(latestBackup.modifiedMs), now)
                : new Date(0);

            if (!dueOccurrence || dueOccurrence.getTime() === this.lastHandledAutomaticOccurrenceMs) return;
            this.lastHandledAutomaticOccurrenceMs = dueOccurrence.getTime();
            await this.createBackup('automatic');
        } catch (error) {
            console.warn('[vault-backup] Automatic backup check failed.', error);
        }
    }

    private nodeModules() {
        const requireNode = getNodeRequire();
        return {
            fs: requireNode('fs'),
            path: requireNode('path'),
            crypto: requireNode('crypto'),
            zlib: requireNode('zlib'),
            os: requireNode('os'),
            stream: requireNode('stream'),
            pipeline: requireNode('stream/promises').pipeline,
            BufferClass: requireNode('buffer').Buffer,
            childProcess: requireNode('child_process'),
            process: requireNode('process')
        };
    }

    private vaultRoot(): string {
        const adapter = this.app.vault.adapter as any;
        if (typeof adapter.getBasePath !== 'function') throw new Error('The active vault does not expose a desktop filesystem path.');
        return adapter.getBasePath();
    }

    private async chooseBackupDirectory(): Promise<string | null> {
        const requireNode = getNodeRequire();
        const electron = requireNode('electron');
        const dialog = electron?.remote?.dialog;
        if (!dialog?.showOpenDialog) throw new Error('The desktop folder picker is unavailable.');

        const { path } = this.nodeModules();
        const configured = this.settings.backupPath.trim();
        const defaultPath = configured ? path.resolve(this.vaultRoot(), configured) : this.vaultRoot();
        const result = await dialog.showOpenDialog({
            title: 'Choose backup folder',
            buttonLabel: 'Choose folder',
            defaultPath,
            properties: ['openDirectory', 'createDirectory']
        });
        if (result.canceled || !result.filePaths?.[0]) return null;
        return result.filePaths[0];
    }

    private resolvedBackupDirectory(): string {
        const configured = this.settings.backupPath.trim();
        if (!configured) throw new Error('Choose a backup folder first.');
        const { path } = this.nodeModules();
        const resolved = path.resolve(this.vaultRoot(), configured);
        if (resolved === path.resolve(this.vaultRoot())) throw new Error('The backup folder cannot be the vault root.');
        return resolved;
    }

    private archiveName(kind: 'manual' | 'automatic', encrypted: boolean): string {
        const { path } = this.nodeModules();
        const vaultName = path.basename(this.vaultRoot()).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'vault';
        const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').replace(/\.(\d{3})Z$/, '-$1Z');
        const base = `${vaultName}-${kind === 'automatic' ? 'auto' : 'manual'}-${stamp}`;
        return `${base}${encrypted ? '.encrypted' : ''}.7z`;
    }

    private async *walkFiles(root: string, excludedDirectory: string | null): AsyncGenerator<{ absolutePath: string; relativePath: string; stat: any }> {
        const { fs, path } = this.nodeModules();
        const entries = await fs.promises.readdir(root, { withFileTypes: true });
        entries.sort((left: any, right: any) => left.name.localeCompare(right.name));

        for (const entry of entries) {
            const absolutePath = path.join(root, entry.name);
            const resolvedPath = path.resolve(absolutePath);
            if (excludedDirectory && (resolvedPath === excludedDirectory || resolvedPath.startsWith(excludedDirectory + path.sep))) continue;
            if (entry.isSymbolicLink()) {
                console.warn(`[vault-backup] Skipping symbolic link: ${absolutePath}`);
                continue;
            }
            if (entry.isDirectory()) {
                yield* this.walkFiles(absolutePath, excludedDirectory);
                continue;
            }
            if (!entry.isFile()) continue;
            const stat = await fs.promises.stat(absolutePath);
            const relativePath = path.relative(this.vaultRoot(), absolutePath).split(path.sep).join('/');
            yield { absolutePath, relativePath, stat };
        }
    }

    private backupDirectoryInsideVault(backupDirectory: string): string | null {
        const { path } = this.nodeModules();
        const vaultRoot = path.resolve(this.vaultRoot());
        const relative = path.relative(vaultRoot, backupDirectory);
        if (relative && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)) {
            return path.resolve(backupDirectory);
        }
        return null;
    }

    private runExecutable(executable: string, args: string[], cwd?: string): Promise<string> {
        const { childProcess } = this.nodeModules();
        return new Promise((resolve, reject) => {
            const child = childProcess.spawn(executable, args, {
                cwd,
                windowsHide: true,
                shell: false,
                stdio: ['ignore', 'pipe', 'pipe']
            });
            let stdout = '';
            let stderr = '';
            const append = (current: string, chunk: any) => `${current}${String(chunk)}`.slice(-65536);
            child.stdout.on('data', (chunk: any) => { stdout = append(stdout, chunk); });
            child.stderr.on('data', (chunk: any) => { stderr = append(stderr, chunk); });
            child.once('error', reject);
            child.once('close', (code: number | null) => {
                if (code === 0) resolve(stdout);
                else reject(new Error((stderr.trim() || stdout.trim() || `7-Zip exited with code ${code}.`).slice(-4000)));
            });
        });
    }

    private async resolveSevenZipExecutable(): Promise<string> {
        if (this.sevenZipExecutable) return this.sevenZipExecutable;
        const { fs, path, process } = this.nodeModules();
        const candidates = [
            process.env.ProgramFiles ? path.join(process.env.ProgramFiles, '7-Zip', '7z.exe') : '',
            process.env['ProgramFiles(x86)'] ? path.join(process.env['ProgramFiles(x86)'], '7-Zip', '7z.exe') : '',
            '/usr/local/bin/7zz',
            '/usr/local/bin/7z',
            '/usr/bin/7zz',
            '/usr/bin/7z',
            '7z.exe',
            '7zz',
            '7z',
            '7za'
        ].filter((candidate, index, all) => candidate && all.indexOf(candidate) === index);

        for (const candidate of candidates) {
            if (path.isAbsolute(candidate)) {
                const stat = await fs.promises.stat(candidate).catch(() => null);
                if (!stat?.isFile()) continue;
            }
            try {
                await this.runExecutable(candidate, ['i', '-bso0', '-bsp0']);
                this.sevenZipExecutable = candidate;
                return candidate;
            } catch (_) {
                // Try the next standard executable name or install location.
            }
        }

        throw new Error('7-Zip was not found. Install it from https://www.7-zip.org/ and restart Obsidian.');
    }

    private async runSevenZip(args: string[], cwd?: string): Promise<string> {
        return this.runExecutable(await this.resolveSevenZipExecutable(), args, cwd);
    }

    private async runSevenZipWithPassword(args: string[], password: string, stage: string, cwd?: string): Promise<void> {
        if (/[\x00-\x1f\x7f]/.test(password)) {
            throw new Error('Archive passwords cannot contain control characters.');
        }
        const executable = await this.resolveSevenZipExecutable();
        await this.ensureSevenZipPasswordPipe(executable);
        const command = args[0];
        const includePasswordSwitch = command === 'a'
            ? true
            : command === 't' || command === 'x'
                ? this.sevenZipReadPasswordModes?.[command]
                : undefined;
        if (includePasswordSwitch === undefined) throw new Error(`${stage}: unsupported 7-Zip password operation.`);
        await this.runSevenZipPasswordPipe(executable, args, password, stage, cwd, 24 * 60 * 60_000, includePasswordSwitch);
    }

    private runSevenZipPasswordPipe(executable: string, args: string[], password: string, stage: string, cwd: string | undefined, timeoutMs: number, includePasswordSwitch: boolean): Promise<void> {
        const { childProcess } = this.nodeModules();
        return new Promise<void>((resolve, reject) => {
            let child: any;
            let settled = false;
            let timeout: any = null;
            let stderr = '';
            let stdinFailed = false;
            const diagnostic = () => {
                // Never include stdout. It may echo the password on some 7-Zip builds.
                const lines = stderr
                    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
                    .split(/\r?\n|\r/)
                    .map(line => line.trim())
                    .filter(line => line && !/enter password\s*:/i.test(line))
                    .map(line => line.split(password).join('[password redacted]'));
                return lines.slice(-8).join(' | ').slice(0, 1200);
            };
            const finish = (error?: Error) => {
                if (settled) return;
                settled = true;
                if (timeout) clearTimeout(timeout);
                if (error) {
                    try { child?.kill(); } catch (_) { /* Process may already have exited. */ }
                    reject(error);
                } else {
                    resolve();
                }
            };
            try {
                child = childProcess.spawn(executable, [...args, ...(includePasswordSwitch ? ['-p'] : []), '-sccUTF-8'], {
                    cwd,
                    windowsHide: true,
                    shell: false,
                    stdio: ['pipe', 'pipe', 'pipe']
                });
            } catch (_) {
                finish(new Error(`${stage}: could not start 7-Zip with a private password pipe.`));
                return;
            }
            // Drain stdout without storing it. Only redacted stderr is used for diagnostics.
            child.stdout.on('data', () => undefined);
            child.stderr.on('data', (chunk: any) => { stderr = `${stderr}${String(chunk)}`.slice(-16384); });
            child.stdin.on('error', () => { stdinFailed = true; });
            child.once('error', () => finish(new Error(`${stage}: could not start 7-Zip with a private password pipe.`)));
            child.once('close', (exitCode: number | null) => {
                if (exitCode !== 0) {
                    const detail = diagnostic();
                    const pipeNote = stdinFailed ? ' The password input pipe closed early.' : '';
                    finish(new Error(`${stage} failed (7-Zip exit code ${exitCode ?? 'unknown'}).${pipeNote}${detail ? ` 7-Zip error: ${detail}` : ' 7-Zip provided no error output.'}`));
                } else {
                    finish();
                }
            });
            timeout = setTimeout(() => {
                const detail = diagnostic();
                finish(new Error(`${stage} timed out after ${Math.round(timeoutMs / 1000)} seconds.${detail ? ` 7-Zip error: ${detail}` : ''}`));
            }, timeoutMs);
            child.stdin.end(`${password}\n`, 'utf8');
        });
    }

    private async ensureSevenZipPasswordPipe(executable: string): Promise<void> {
        if (this.sevenZipPasswordPipeChecked) return;
        const { fs, path, os, crypto } = this.nodeModules();
        const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'obsidian-vault-7z-check-'));
        // Exercise punctuation and UTF-8 without putting either password in argv.
        const probePassword = `V7!@#$%^&*()_+-=[]{};:'",.<>?/\\|é${crypto.randomBytes(16).toString('hex')}`;
        try {
            const archive = path.join(directory, 'check.7z');
            const sample = path.join(directory, 'check.txt');
            await fs.promises.writeFile(sample, 'password-pipe-check', { flag: 'wx' });
            await this.runSevenZipPasswordPipe(executable, ['a', '-t7z', archive, sample, '-mx=0', '-mhe=on', '-y', '-bd', '-bso0', '-bsp0', '-bse2'], probePassword, '7-Zip password-pipe creation check', directory, 60_000, true);
            const selectReadMode = async (command: 't' | 'x'): Promise<boolean> => {
                const failures: string[] = [];
                for (const includePasswordSwitch of [false, true]) {
                    const destination = path.join(directory, `extract-${includePasswordSwitch ? 'switch' : 'prompt'}`);
                    const args = command === 't'
                        ? ['t', archive, '-y', '-bd', '-bso0', '-bsp0', '-bse2']
                        : ['x', archive, `-o${destination}`, '-y', '-bd', '-bso0', '-bsp0', '-bse2'];
                    try {
                        await this.runSevenZipPasswordPipe(executable, args, probePassword, `7-Zip password-pipe ${command} check`, directory, 60_000, includePasswordSwitch);
                        return includePasswordSwitch;
                    } catch (error) {
                        const detail = error instanceof Error ? error.message : String(error);
                        failures.push(`${includePasswordSwitch ? 'with -p' : 'without -p'}: ${detail}`);
                    }
                }
                throw new Error(`7-Zip cannot ${command === 't' ? 'test' : 'extract'} its own encrypted archive using a piped password. ${failures.join(' | ')}`);
            };
            const t = await selectReadMode('t');
            let wrongPasswordAccepted = false;
            try {
                await this.runSevenZipPasswordPipe(executable, ['t', archive, '-y', '-bd', '-bso0', '-bsp0', '-bse2'], 'wrong-password', '7-Zip wrong-password check', directory, 60_000, t);
                wrongPasswordAccepted = true;
            } catch (_) { /* The same pipe mode must reject an incorrect password. */ }
            if (wrongPasswordAccepted) throw new Error('7-Zip created an archive that does not reject an incorrect password.');
            const x = await selectReadMode('x');
            this.sevenZipReadPasswordModes = { t, x };
            this.sevenZipPasswordPipeChecked = true;
        } catch (error) {
            const detail = error instanceof Error ? error.message.split(probePassword).join('[probe password redacted]') : String(error);
            throw new Error(`7-Zip password-pipe check failed: ${detail}`);
        } finally {
            await fs.promises.rm(directory, { recursive: true, force: true }).catch(() => undefined);
        }
    }

    private credentialAccount(): string {
        const { path, crypto } = this.nodeModules();
        return crypto.createHash('sha256').update(path.resolve(this.vaultRoot())).digest('hex');
    }

    private runCredentialCommand(executable: string, args: string[], input?: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
        const { childProcess, process } = this.nodeModules();
        return new Promise((resolve, reject) => {
            let child: any;
            try {
                child = childProcess.spawn(executable, args, {
                    windowsHide: true,
                    shell: false,
                    stdio: ['pipe', 'pipe', 'pipe'],
                    env: process.platform === 'win32' ? process.env : { ...process.env, LANG: 'C', LC_ALL: 'C' }
                });
            } catch (_) {
                reject(new Error('Could not start the operating-system credential tool.'));
                return;
            }
            let stdout = '';
            let stderr = '';
            let settled = false;
            let timeout: any = null;
            const finish = (error?: Error, code: number | null = null) => {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                if (error) reject(error);
                else resolve({ code, stdout, stderr });
            };
            const append = (current: string, chunk: any) => `${current}${String(chunk)}`.slice(-65536);
            child.stdout.on('data', (chunk: any) => { stdout = append(stdout, chunk); });
            child.stderr.on('data', (chunk: any) => { stderr = append(stderr, chunk); });
            child.once('error', () => finish(new Error('The operating-system credential tool is unavailable.')));
            child.once('close', (code: number | null) => finish(undefined, code));
            timeout = setTimeout(() => {
                try { child.kill(); } catch (_) { /* The process may already have exited. */ }
                finish(new Error('Timed out waiting for the operating-system credential store.'));
            }, 5 * 60_000);
            child.stdin.on('error', () => { /* A failed child is handled by its exit event. */ });
            child.stdin.end(input ?? '');
        });
    }

    private async runWindowsCredential(operation: 'read' | 'write' | 'delete', password?: string): Promise<string | null> {
        // The encoded command contains only code and a vault-path hash. The secret crosses a private stdin pipe.
        const { BufferClass } = this.nodeModules();
        const target = `${CREDENTIAL_SERVICE}:${this.credentialAccount()}`;
        const script = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class VaultBackupCredential {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct Credential {
        public UInt32 Flags;
        public UInt32 Type;
        [MarshalAs(UnmanagedType.LPWStr)] public string TargetName;
        [MarshalAs(UnmanagedType.LPWStr)] public string Comment;
        public Int64 LastWritten;
        public UInt32 CredentialBlobSize;
        public IntPtr CredentialBlob;
        public UInt32 Persist;
        public UInt32 AttributeCount;
        public IntPtr Attributes;
        [MarshalAs(UnmanagedType.LPWStr)] public string TargetAlias;
        [MarshalAs(UnmanagedType.LPWStr)] public string UserName;
    }
    [DllImport("Advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredWrite(ref Credential credential, UInt32 flags);
    [DllImport("Advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredRead(string target, UInt32 type, UInt32 flags, out IntPtr credential);
    [DllImport("Advapi32.dll", EntryPoint = "CredDeleteW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredDelete(string target, UInt32 type, UInt32 flags);
    [DllImport("Advapi32.dll", EntryPoint = "CredFree")]
    private static extern void CredFree(IntPtr credential);
    public static void Write(string target, byte[] secret) {
        if (secret.Length > 2560) throw new ArgumentException("Password exceeds Windows Credential Manager's size limit.");
        var item = new Credential { Type = 1, TargetName = target, CredentialBlobSize = (UInt32)secret.Length, Persist = 2 };
        item.CredentialBlob = Marshal.AllocHGlobal(secret.Length);
        try {
            Marshal.Copy(secret, 0, item.CredentialBlob, secret.Length);
            if (!CredWrite(ref item, 0)) throw new Win32Exception(Marshal.GetLastWin32Error());
        } finally {
            Marshal.Copy(new byte[secret.Length], 0, item.CredentialBlob, secret.Length);
            Marshal.FreeHGlobal(item.CredentialBlob);
        }
    }
    public static byte[] Read(string target) {
        IntPtr pointer;
        if (!CredRead(target, 1, 0, out pointer)) {
            int code = Marshal.GetLastWin32Error();
            if (code == 1168) return null;
            throw new Win32Exception(code);
        }
        try {
            var item = (Credential)Marshal.PtrToStructure(pointer, typeof(Credential));
            var secret = new byte[item.CredentialBlobSize];
            Marshal.Copy(item.CredentialBlob, secret, 0, secret.Length);
            return secret;
        } finally { CredFree(pointer); }
    }
    public static void Delete(string target) {
        if (!CredDelete(target, 1, 0) && Marshal.GetLastWin32Error() != 1168)
            throw new Win32Exception(Marshal.GetLastWin32Error());
    }
}
'@
$target = '${target}'
${operation === 'write' ? "$secret = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()); [VaultBackupCredential]::Write($target, $secret); [Console]::Out.Write('OK')" : operation === 'read' ? "$secret = [VaultBackupCredential]::Read($target); if ($null -eq $secret) { [Console]::Out.Write('MISSING') } else { [Console]::Out.Write('FOUND:' + [Convert]::ToBase64String($secret)) }" : "[VaultBackupCredential]::Delete($target); [Console]::Out.Write('OK')"}
`;
        const encoded = BufferClass.from(script, 'utf16le').toString('base64');
        const input = operation === 'write' ? BufferClass.from(password ?? '', 'utf8').toString('base64') : undefined;
        const result = await this.runCredentialCommand('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], input);
        if (result.code !== 0) throw new Error('Windows Credential Manager rejected the operation.');
        if (operation === 'read') {
            if (result.stdout === 'MISSING') return null;
            if (!/^FOUND:[A-Za-z0-9+/]*={0,2}$/.test(result.stdout)) throw new Error('Windows Credential Manager returned an unexpected response.');
            return BufferClass.from(result.stdout.slice(6), 'base64').toString('utf8');
        }
        if (result.stdout !== 'OK') throw new Error('Windows Credential Manager did not confirm the operation.');
        return null;
    }

    private async saveMacCredential(password: string): Promise<void> {
        const { BufferClass } = this.nodeModules();
        // security -i reads commands from stdin. -X keeps the value out of argv and avoids shell quoting.
        const encodedPassword = `NLVB1:${BufferClass.from(password, 'utf8').toString('base64')}`;
        const hex = BufferClass.from(encodedPassword, 'utf8').toString('hex');
        const command = `add-generic-password -U -a ${this.credentialAccount()} -s ${CREDENTIAL_SERVICE} -X ${hex}\n`;
        if (command.length >= 4096) throw new Error('Password is too long for the macOS Keychain command interface.');
        const result = await this.runCredentialCommand('/usr/bin/security', ['-i'], command);
        if (result.code !== 0 || await this.getDefaultPassword() !== password) {
            throw new Error('macOS Keychain did not confirm the saved password.');
        }
    }

    private async getDefaultPassword(): Promise<string | null> {
        const { process } = this.nodeModules();
        const account = this.credentialAccount();
        if (process.platform === 'win32') return this.runWindowsCredential('read');
        if (process.platform === 'darwin') {
            const result = await this.runCredentialCommand('/usr/bin/security', ['find-generic-password', '-a', account, '-s', CREDENTIAL_SERVICE, '-w']);
            if (result.code === 0) {
                const stored = result.stdout.replace(/\r?\n$/, '');
                if (stored.startsWith('NLVB1:')) {
                    const encoded = stored.slice(6);
                    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
                        throw new Error('macOS Keychain returned a damaged backup password.');
                    }
                    return this.nodeModules().BufferClass.from(encoded, 'base64').toString('utf8');
                }
                return stored || null;
            }
            if (/could not be found|item not found/i.test(result.stderr)) return null;
            throw new Error('macOS Keychain could not read the default password.');
        }
        if (process.platform === 'linux') {
            const result = await this.runCredentialCommand('secret-tool', ['lookup', 'service', CREDENTIAL_SERVICE, 'vault', account]);
            if (result.code === 0) return result.stdout || null;
            if (result.code === 1 && !result.stderr.trim()) return null;
            throw new Error('Linux Secret Service could not read the default password.');
        }
        throw new Error('This operating system has no supported credential-store integration.');
    }

    private async saveDefaultPassword(password: string): Promise<void> {
        if (!password || /[\x00-\x1f\x7f]/.test(password)) {
            throw new Error('Enter a password without control characters.');
        }
        const { process } = this.nodeModules();
        if (process.platform === 'win32') await this.runWindowsCredential('write', password);
        else if (process.platform === 'darwin') await this.saveMacCredential(password);
        else if (process.platform === 'linux') {
            const result = await this.runCredentialCommand('secret-tool', ['store', '--label=Obsidian vault backup', 'service', CREDENTIAL_SERVICE, 'vault', this.credentialAccount()], password);
            if (result.code !== 0) throw new Error('Linux Secret Service could not save the default password.');
        } else throw new Error('This operating system has no supported credential-store integration.');
        this.sessionEncryptionPassword = null;
    }

    private async removeDefaultPassword(): Promise<void> {
        const { process } = this.nodeModules();
        if (process.platform === 'win32') await this.runWindowsCredential('delete');
        else if (process.platform === 'darwin') {
            const result = await this.runCredentialCommand('/usr/bin/security', ['delete-generic-password', '-a', this.credentialAccount(), '-s', CREDENTIAL_SERVICE]);
            if (result.code !== 0 && !/could not be found|item not found/i.test(result.stderr)) throw new Error('macOS Keychain could not remove the default password.');
        } else if (process.platform === 'linux') {
            const result = await this.runCredentialCommand('secret-tool', ['clear', 'service', CREDENTIAL_SERVICE, 'vault', this.credentialAccount()]);
            if (result.code !== 0) throw new Error('Linux Secret Service could not remove the default password.');
        } else throw new Error('This operating system has no supported credential-store integration.');
        this.sessionEncryptionPassword = null;
    }

    private askForManualPassword(defaultAvailable: boolean): Promise<{ useDefault: boolean; password: string | null } | null> {
        return new Promise(resolve => new ManualBackupPasswordModal(this.app, defaultAvailable, resolve).open());
    }

    private askForRecoveryPassword(defaultAvailable: boolean): Promise<{ useDefault: boolean; password: string | null } | null> {
        return new Promise(resolve => new RecoveryPasswordModal(this.app, defaultAvailable, resolve).open());
    }

    private askForPassword(
        title: string,
        message: string,
        confirmText: string,
        requireConfirmation: boolean
    ): Promise<string | null> {
        return new Promise(resolve => new PasswordPromptModal(
            this.app,
            title,
            message,
            confirmText,
            requireConfirmation,
            resolve
        ).open());
    }

    private async createSevenZipArchive(
        partialPath: string,
        backupDirectory: string,
        compression: BackupCompressionMethod,
        password: string | null
    ): Promise<void> {
        const { fs, path, os } = this.nodeModules();
        const listDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'obsidian-vault-7z-'));
        const listPath = path.join(listDirectory, 'files.txt');
        const listStream = fs.createWriteStream(listPath, { flags: 'wx', encoding: 'utf8' });
        let fileCount = 0;

        try {
            const excludedDirectory = this.backupDirectoryInsideVault(backupDirectory);
            for await (const file of this.walkFiles(this.vaultRoot(), excludedDirectory)) {
                if (/\r|\n/.test(file.relativePath)) {
                    throw new Error(`A filename contains a line break and cannot be passed safely to 7-Zip: ${file.relativePath}`);
                }
                await writeChunk(listStream, `${file.relativePath}\n`);
                fileCount += 1;
            }
            await closeWritable(listStream);
            if (fileCount === 0) throw new Error('The vault contains no files to back up.');

            const createArgs = [
                'a',
                '-t7z',
                partialPath,
                `@${listPath}`,
                '-scsUTF-8',
                `-mx=${compressionPreset(compression)}`,
                '-y',
                '-bd',
                '-bso0',
                '-bsp0',
                '-bse2',
                ...(password ? ['-mhe=on'] : [])
            ];
            if (password) await this.runSevenZipWithPassword(createArgs, password, 'Create encrypted archive', this.vaultRoot());
            else await this.runSevenZip(createArgs, this.vaultRoot());

            const testArgs = [
                't',
                partialPath,
                '-y',
                '-bd',
                '-bso0',
                '-bsp0',
                '-bse2'
            ];
            if (password) await this.runSevenZipWithPassword(testArgs, password, 'Verify newly created archive');
            else await this.runSevenZip(testArgs);
        } catch (error) {
            listStream.destroy();
            throw error;
        } finally {
            await fs.promises.rm(listDirectory, { recursive: true, force: true }).catch(() => undefined);
        }
    }

    async createBackup(kind: 'manual' | 'automatic'): Promise<void> {
        if (!Platform.isDesktopApp) {
            new Notice('Vault Backup is available only in Obsidian Desktop.');
            return;
        }
        if (this.operationRunning) {
            new Notice('A vault backup or restore operation is already running.');
            return;
        }

        const encrypted = Boolean(this.settings.encryptionEnabled);
        let password: string | null = null;
        if (encrypted) {
            let defaultPassword: string | null = null;
            try {
                defaultPassword = await this.getDefaultPassword();
            } catch (error) {
                new Notice(`Default password is unavailable; you can enter one for this backup. ${error instanceof Error ? error.message : String(error)}`, 10000);
            }

            if (kind === 'automatic') {
                password = defaultPassword || this.sessionEncryptionPassword;
                if (!password) {
                    password = await this.askForPassword(
                        'Automatic encrypted backup',
                        'No default password is available on this device. Enter and confirm a password for scheduled backups in this Obsidian session.',
                        'Create backup',
                        true
                    );
                    if (!password) {
                        new Notice('Automatic encrypted backup skipped because no password was entered.');
                        return;
                    }
                    this.sessionEncryptionPassword = password;
                }
            } else {
                const selection = await this.askForManualPassword(Boolean(defaultPassword));
                if (!selection) return;
                password = selection.useDefault ? defaultPassword : selection.password;
                if (!password) {
                    new Notice('No password was available for this manual backup.');
                    return;
                }
            }
        }

        this.operationRunning = true;
        const notice = new Notice(`${kind === 'automatic' ? 'Automatic' : 'Manual'} vault backup started…`, 0);
        let partialPath = '';
        try {
            const { fs, path } = this.nodeModules();
            const backupDirectory = this.resolvedBackupDirectory();
            await fs.promises.mkdir(backupDirectory, { recursive: true });
            const compression = normalizedCompressionMethod(this.settings.compressionMethod);
            const archivePath = path.join(backupDirectory, this.archiveName(kind, encrypted));
            partialPath = `${archivePath}.partial`;

            await this.createSevenZipArchive(partialPath, backupDirectory, compression, password);
            await fs.promises.rename(partialPath, archivePath);

            if (kind === 'automatic') await this.applyAutomaticRetention(backupDirectory);
            await this.refreshBackupListUi();
            notice.hide();
            new Notice(`Vault backup created: ${path.basename(archivePath)}`, 8000);
        } catch (error) {
            if (partialPath) {
                try { await this.nodeModules().fs.promises.unlink(partialPath); } catch (_) { /* Best-effort cleanup. */ }
            }
            notice.hide();
            console.error('[vault-backup] Backup failed.', error);
            new Notice(`Vault backup failed: ${error instanceof Error ? error.message : String(error)}`, 10000);
        } finally {
            this.operationRunning = false;
        }
    }

    private async applyAutomaticRetention(backupDirectory: string) {
        const keep = Math.max(1, Math.floor(Number(this.settings.automaticBackupsToKeep) || 1));
        const backups = (await this.listBackups(backupDirectory))
            .filter(backup => backup.automatic && backup.format === '7z')
            .sort((left, right) => right.modifiedMs - left.modifiedMs);
        const { fs } = this.nodeModules();
        for (const backup of backups.slice(keep)) await fs.promises.unlink(backup.absolutePath);
    }

    private async listBackups(directory?: string): Promise<BackupFileInfo[]> {
        const { fs, path } = this.nodeModules();
        const backupDirectory = directory || this.resolvedBackupDirectory();
        if (!(await fs.promises.stat(backupDirectory).catch(() => null))) return [];
        const names = await fs.promises.readdir(backupDirectory);
        const results: BackupFileInfo[] = [];
        for (const name of names) {
            const format: BackupFileInfo['format'] | null = name.endsWith('.7z')
                ? '7z'
                : name.endsWith('.vaultbak') || name.endsWith('.vaultbak.enc')
                    ? 'legacy'
                    : null;
            if (!format) continue;
            const absolutePath = path.join(backupDirectory, name);
            const stat = await fs.promises.stat(absolutePath);
            if (!stat.isFile()) continue;
            results.push({
                name,
                absolutePath,
                size: stat.size,
                modifiedMs: stat.mtimeMs,
                encrypted: name.endsWith('.encrypted.7z') || name.endsWith('.vaultbak.enc'),
                automatic: /-auto-\d{8}-\d{6}-\d{3}Z(?:\.encrypted)?\.7z$/.test(name)
                    || /-auto-\d{8}-\d{6}-\d{3}Z\.vaultbak(?:\.enc)?$/.test(name),
                format
            });
        }
        return results.sort((left, right) => right.modifiedMs - left.modifiedMs);
    }

    private askForConfirmation(title: string, message: string, confirmText: string, destructive: boolean): Promise<boolean> {
        return new Promise(resolve => new ConfirmActionModal(this.app, title, message, confirmText, destructive, resolve).open());
    }

    private safeRestoreTarget(tempRoot: string, archivePath: string): string {
        const { path } = this.nodeModules();
        if (!archivePath || archivePath.includes('\0') || path.isAbsolute(archivePath)) throw new Error(`Unsafe path in backup: ${archivePath}`);
        const pieces = archivePath.replace(/\\/g, '/').split('/');
        if (pieces.some(piece => !piece || piece === '.' || piece === '..')) throw new Error(`Unsafe path in backup: ${archivePath}`);
        const target = path.resolve(tempRoot, ...pieces);
        if (!target.startsWith(path.resolve(tempRoot) + path.sep)) throw new Error(`Unsafe path in backup: ${archivePath}`);
        return target;
    }

    private async extractSevenZipToTemporaryDirectory(backup: BackupFileInfo, password: string | null): Promise<string> {
        const { fs, path, os } = this.nodeModules();
        const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'obsidian-vault-restore-'));
        try {
            const testArgs = [
                't',
                backup.absolutePath,
                '-y',
                '-bd',
                '-bso0',
                '-bsp0',
                '-bse2'
            ];
            if (password) await this.runSevenZipWithPassword(testArgs, password, 'Verify archive before restore');
            else await this.runSevenZip(testArgs);

            const extractArgs = [
                'x',
                backup.absolutePath,
                `-o${tempRoot}`,
                '-y',
                '-aoa',
                '-bd',
                '-bso0',
                '-bsp0',
                '-bse2'
            ];
            if (password) await this.runSevenZipWithPassword(extractArgs, password, 'Extract archive for restore');
            else await this.runSevenZip(extractArgs);
            return tempRoot;
        } catch (error) {
            await fs.promises.rm(tempRoot, { recursive: true, force: true });
            throw error;
        }
    }

    private async extractLegacyBackupToTemporaryDirectory(backup: BackupFileInfo, password: string | null): Promise<string> {
        const { fs, path, crypto, zlib, os, stream, pipeline, BufferClass } = this.nodeModules();
        const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'obsidian-vault-restore-'));
        try {
            const stat = await fs.promises.stat(backup.absolutePath);
            if (stat.size < ARCHIVE_HEADER_SIZE + (backup.encrypted ? AUTH_TAG_SIZE : 0)) throw new Error('Backup archive is too small.');

            const header = BufferClass.alloc(ARCHIVE_HEADER_SIZE);
            let authTag: any = null;
            const handle = await fs.promises.open(backup.absolutePath, 'r');
            try {
                await handle.read(header, 0, ARCHIVE_HEADER_SIZE, 0);
                if ((header[8] & 1) === 1) {
                    authTag = BufferClass.alloc(AUTH_TAG_SIZE);
                    await handle.read(authTag, 0, AUTH_TAG_SIZE, stat.size - AUTH_TAG_SIZE);
                }
            } finally {
                await handle.close();
            }

            if (header.subarray(0, 8).toString('ascii') !== ARCHIVE_MAGIC) throw new Error('This is not a supported vault backup archive.');
            const encrypted = (header[8] & 1) === 1;
            const uncompressed = (header[8] & 2) === 2;
            if (encrypted !== backup.encrypted) throw new Error('Backup filename and encryption header do not match.');
            if (encrypted && !password) throw new Error('Enter the password required by this legacy backup.');
            const salt = header.subarray(9, 25);
            const iv = header.subarray(25, 37);

            const payloadEnd = stat.size - 1 - (encrypted ? AUTH_TAG_SIZE : 0);
            const payload: any = fs.createReadStream(backup.absolutePath, { start: ARCHIVE_HEADER_SIZE, end: payloadEnd });
            const decoded = uncompressed ? new stream.PassThrough() : zlib.createGunzip();
            const stages: any[] = [payload];
            if (encrypted) {
                const key = crypto.scryptSync(password, salt, 32);
                const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
                decipher.setAuthTag(authTag);
                stages.push(decipher);
            }
            stages.push(decoded);
            let pipelineError: unknown = null;
            const pipelinePromise = pipeline(...stages).catch((error: unknown) => {
                pipelineError = error;
            });
            const reader = new BufferedStreamReader(decoded, BufferClass);

            try {
                while (true) {
                    const lengthBuffer = await reader.readExactly(4);
                    const metadataLength = lengthBuffer.readUInt32BE(0);
                    if (metadataLength === 0) break;
                    if (metadataLength > 1024 * 1024) throw new Error('Backup metadata is invalid.');
                    const metadata = JSON.parse((await reader.readExactly(metadataLength)).toString('utf8'));
                    if (typeof metadata.path !== 'string' || !Number.isSafeInteger(metadata.size) || metadata.size < 0) {
                        throw new Error('Backup file metadata is invalid.');
                    }

                    const target = this.safeRestoreTarget(tempRoot, metadata.path);
                    await fs.promises.mkdir(path.dirname(target), { recursive: true });
                    const output = fs.createWriteStream(target, { flags: 'wx' });
                    try {
                        await reader.pipeExactly(metadata.size, output);
                        await closeWritable(output);
                    } catch (error) {
                        output.destroy();
                        throw error;
                    }
                    if (Number.isFinite(metadata.mode)) await fs.promises.chmod(target, metadata.mode).catch(() => undefined);
                    if (Number.isFinite(metadata.mtimeMs)) {
                        const modified = new Date(metadata.mtimeMs);
                        await fs.promises.utimes(target, modified, modified).catch(() => undefined);
                    }
                }

                await reader.expectEnd();
                await pipelinePromise;
                if (pipelineError) throw pipelineError;
            } catch (error) {
                decoded.destroy();
                await pipelinePromise;
                throw pipelineError || error;
            }
            return tempRoot;
        } catch (error) {
            await fs.promises.rm(tempRoot, { recursive: true, force: true });
            throw error;
        }
    }

    private async overlayDirectory(sourceRoot: string, destinationRoot: string): Promise<void> {
        const { fs, path } = this.nodeModules();
        const entries = await fs.promises.readdir(sourceRoot, { withFileTypes: true });
        for (const entry of entries) {
            const source = path.join(sourceRoot, entry.name);
            const destination = path.join(destinationRoot, entry.name);
            if (entry.isDirectory()) {
                await fs.promises.mkdir(destination, { recursive: true });
                await this.overlayDirectory(source, destination);
            } else if (entry.isFile()) {
                await fs.promises.mkdir(path.dirname(destination), { recursive: true });
                await fs.promises.copyFile(source, destination);
                const stat = await fs.promises.stat(source);
                await fs.promises.chmod(destination, stat.mode).catch(() => undefined);
                await fs.promises.utimes(destination, stat.atime, stat.mtime).catch(() => undefined);
            }
        }
    }

    private async restoreBackup(backup: BackupFileInfo) {
        if (this.operationRunning) {
            new Notice('A vault backup or restore operation is already running.');
            return;
        }
        const confirmed = await this.askForConfirmation(
            'Restore vault backup?',
            `This will overwrite files that exist in “${backup.name}”. Files created after the backup are preserved. Obsidian should be restarted after restore.`,
            'Restore backup',
            true
        );
        if (!confirmed) return;

        let password: string | null = null;
        if (backup.encrypted) {
            let defaultPassword: string | null = null;
            try {
                defaultPassword = await this.getDefaultPassword();
            } catch (error) {
                new Notice(`Default password is unavailable; enter the archive password instead. ${error instanceof Error ? error.message : String(error)}`, 10000);
            }
            const selection = await this.askForRecoveryPassword(Boolean(defaultPassword));
            if (!selection) return;
            password = selection.useDefault ? defaultPassword : selection.password;
            if (!password) return;
        }

        this.operationRunning = true;
        const notice = new Notice('Verifying and restoring vault backup…', 0);
        let tempRoot = '';
        try {
            tempRoot = backup.format === 'legacy'
                ? await this.extractLegacyBackupToTemporaryDirectory(backup, password)
                : await this.extractSevenZipToTemporaryDirectory(backup, password);
            await this.overlayDirectory(tempRoot, this.vaultRoot());
            notice.hide();
            new Notice('Vault restore completed. Restart Obsidian to reload restored configuration and plugins.', 12000);
        } catch (error) {
            notice.hide();
            console.error('[vault-backup] Restore failed.', error);
            new Notice(`Vault restore failed: ${error instanceof Error ? error.message : String(error)}`, 12000);
        } finally {
            if (tempRoot) await this.nodeModules().fs.promises.rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
            this.operationRunning = false;
        }
    }

    private async deleteBackup(backup: BackupFileInfo) {
        const confirmed = await this.askForConfirmation(
            'Delete backup?',
            `Permanently delete “${backup.name}”?`,
            'Delete',
            true
        );
        if (!confirmed) return;
        try {
            await this.nodeModules().fs.promises.unlink(backup.absolutePath);
            new Notice(`Deleted backup: ${backup.name}`);
            await this.refreshBackupListUi();
        } catch (error) {
            new Notice(`Could not delete backup: ${error instanceof Error ? error.message : String(error)}`, 10000);
        }
    }

    private async refreshBackupListUi() {
        if (this.backupListContainer?.isConnected) {
            await this.renderBackupList(this.backupListContainer);
        }
    }

    private async renderBackupList(containerEl: HTMLElement) {
        containerEl.empty();
        if (!this.settings.backupPath.trim()) {
            containerEl.createEl('p', { text: 'Choose a backup folder to view backups.', cls: 'setting-item-description' });
            return;
        }

        try {
            const backups = await this.listBackups();
            if (backups.length === 0) {
                containerEl.createEl('p', { text: 'No vault backups were found in this folder.', cls: 'setting-item-description' });
                return;
            }
            for (const backup of backups) {
                const type = backup.automatic ? 'Automatic' : 'Manual';
                const protection = backup.encrypted ? 'encrypted' : 'not encrypted';
                const format = backup.format === '7z' ? 'standard 7z' : 'legacy vault backup';
                new Setting(containerEl)
                    .setName(backup.name)
                    .setDesc(`${type} · ${format} · ${formatBytes(backup.size)} · ${new Date(backup.modifiedMs).toLocaleString()} · ${protection}`)
                    .addButton(button => button
                        .setButtonText('Restore')
                        .onClick(() => void this.restoreBackup(backup)))
                    .addButton(button => button
                        .setButtonText('Delete')
                        .setWarning()
                        .onClick(() => void this.deleteBackup(backup)));
            }
        } catch (error) {
            containerEl.createEl('p', {
                text: `Could not read the backup folder: ${error instanceof Error ? error.message : String(error)}`,
                cls: 'setting-item-description'
            });
        }
    }

    renderSettings(containerEl: HTMLElement) {
        if (!Platform.isDesktopApp) {
            containerEl.createEl('p', { text: 'Vault Backup is desktop-only because it needs direct filesystem access.' });
            return;
        }

        let backupPathInput: HTMLInputElement | null = null;
        new Setting(containerEl)
            .setName('Backup folder')
            .setDesc('Choose a folder in Explorer, or enter an absolute path or a path relative to the vault. A folder inside the vault is excluded from its own backups.')
            .addText(text => {
                backupPathInput = text.inputEl;
                text.setPlaceholder('D:\\Obsidian Backups')
                    .setValue(this.settings.backupPath)
                    .onChange(async value => {
                        this.settings.backupPath = value.trim();
                        await this.pluginInstance.saveSettings();
                    });
            })
            .addButton(button => button
                .setButtonText('Choose folder')
                .setTooltip('Open Explorer to choose the backup folder')
                .onClick(async () => {
                    try {
                        const selectedPath = await this.chooseBackupDirectory();
                        if (!selectedPath) return;
                        this.settings.backupPath = selectedPath;
                        if (backupPathInput) backupPathInput.value = selectedPath;
                        await this.pluginInstance.saveSettings();
                        this.pluginInstance.refreshSettingsUi?.();
                    } catch (error) {
                        console.error('[vault-backup] Could not open the backup folder picker.', error);
                        new Notice(`Could not choose a backup folder: ${error instanceof Error ? error.message : String(error)}`, 10000);
                    }
                }));

        new Setting(containerEl)
            .setName('Automatic backup cron')
            .setDesc('Five fields in local time: minute hour day month weekday. Example: “0 */6 * * *” runs every six hours.')
            .addText(text => text
                .setPlaceholder('0 */6 * * *')
                .setValue(this.settings.cronExpression)
                .onChange(async value => {
                    this.settings.cronExpression = value.trim();
                    await this.pluginInstance.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Automatic backups to keep')
            .setDesc('Older automatic backups are deleted after a successful automatic backup. Manual backups are never pruned.')
            .addText(text => {
                text.inputEl.type = 'number';
                text.inputEl.min = '1';
                text.setValue(String(this.settings.automaticBackupsToKeep));
                text.onChange(async value => {
                    const parsed = Math.max(1, Math.floor(Number(value) || VAULT_BACKUP_DEFAULTS.automaticBackupsToKeep));
                    this.settings.automaticBackupsToKeep = parsed;
                    await this.pluginInstance.saveSettings();
                });
            });

        new Setting(containerEl)
            .setName('Compression')
            .setDesc('All backups use standard .7z archives. This controls the 7-Zip compression preset.')
            .addDropdown(dropdown => dropdown
                .addOption('none', 'None — fastest')
                .addOption('fast', 'Fast')
                .addOption('balanced', 'Balanced')
                .addOption('maximum', 'Maximum')
                .setValue(normalizedCompressionMethod(this.settings.compressionMethod))
                .onChange(async value => {
                    this.settings.compressionMethod = normalizedCompressionMethod(value);
                    await this.pluginInstance.saveSettings();
                }));

        const sevenZipDescription = document.createDocumentFragment();
        sevenZipDescription.appendText('7-Zip must be installed and available in its standard install location or system PATH. ');
        const sevenZipLink = document.createElement('a');
        sevenZipLink.href = 'https://www.7-zip.org/';
        sevenZipLink.textContent = 'Download 7-Zip';
        sevenZipLink.target = '_blank';
        sevenZipLink.rel = 'noopener noreferrer';
        sevenZipDescription.appendChild(sevenZipLink);
        new Setting(containerEl)
            .setName('7-Zip dependency')
            .setDesc(sevenZipDescription)
            .addButton(button => button
                .setButtonText('Check installation')
                .onClick(async () => {
                    this.sevenZipExecutable = null;
                    this.sevenZipPasswordPipeChecked = false;
                    this.sevenZipReadPasswordModes = null;
                    try {
                        const executable = await this.resolveSevenZipExecutable();
                        await this.ensureSevenZipPasswordPipe(executable);
                        new Notice(`7-Zip found and password-pipe check passed: ${executable}`, 8000);
                    } catch (error) {
                        new Notice(error instanceof Error ? error.message : String(error), 10000);
                    }
                }));

        new Setting(containerEl)
            .setName('Encrypt backups')
            .setDesc('Uses standard 7z AES-256 encryption with encrypted filenames. Passwords go through a private input pipe; no native Node add-on is required. Automatic backups use the device’s saved default password, or prompt if none is available; manual backups always prompt.')
            .addToggle(toggle => toggle
                .setValue(this.settings.encryptionEnabled)
                .onChange(async value => {
                    this.settings.encryptionEnabled = value;
                    if (!value) this.sessionEncryptionPassword = null;
                    await this.pluginInstance.saveSettings();
                }));

        let defaultPasswordInput: HTMLInputElement | null = null;
        const defaultPasswordStatus = containerEl.createEl('p', {
            text: 'Checking this device’s credential store…',
            cls: 'setting-item-description'
        });
        const updateDefaultPasswordStatus = async () => {
            try {
                const saved = await this.getDefaultPassword();
                defaultPasswordStatus.setText(saved
                    ? 'A default password is saved in this device’s OS credential store. The field is intentionally never prefilled.'
                    : 'No default password is saved on this device.');
            } catch (error) {
                defaultPasswordStatus.setText(`Credential store unavailable: ${error instanceof Error ? error.message : String(error)}`);
            }
        };
        new Setting(containerEl)
            .setName('Default backup password')
            .setDesc('Set or replace the device’s default password. It is stored in the OS credential store, not plugin settings. Leave this field empty to keep the current default unchanged.')
            .addText(text => {
                defaultPasswordInput = text.inputEl;
                text.inputEl.type = 'password';
                text.setPlaceholder('New default password');
            })
            .addButton(button => button
                .setButtonText('Save')
                .onClick(async () => {
                    try {
                        await this.saveDefaultPassword(defaultPasswordInput?.value ?? '');
                        if (defaultPasswordInput) defaultPasswordInput.value = '';
                        await updateDefaultPasswordStatus();
                        new Notice('Default backup password saved in this device’s credential store.');
                    } catch (error) {
                        new Notice(`Could not save the default password: ${error instanceof Error ? error.message : String(error)}`, 10000);
                    }
                }))
            .addButton(button => button
                .setButtonText('Remove')
                .setWarning()
                .onClick(async () => {
                    try {
                        await this.removeDefaultPassword();
                        if (defaultPasswordInput) defaultPasswordInput.value = '';
                        await updateDefaultPasswordStatus();
                        new Notice('Default backup password removed from this device.');
                    } catch (error) {
                        new Notice(`Could not remove the default password: ${error instanceof Error ? error.message : String(error)}`, 10000);
                    }
                }));
        void updateDefaultPasswordStatus();

        new Setting(containerEl)
            .setName('Manual backup')
            .setDesc('Create a backup immediately using the compression and encryption settings above.')
            .addButton(button => button
                .setButtonText('Back up now')
                .setCta()
                .onClick(() => void this.createBackup('manual')));

        const listHeading = new Setting(containerEl)
            .setName('Available backups')
            .setDesc('Restore overlays files from the backup and preserves files that are not present in it.')
            .addButton(button => button
                .setButtonText('Refresh')
                .onClick(() => void this.renderBackupList(listContainer)));
        listHeading.settingEl.addClass('vault-backup-list-heading');
        const listContainer = containerEl.createDiv({ cls: 'vault-backup-list' });
        this.backupListContainer = listContainer;
        void this.renderBackupList(listContainer);
    }
}
