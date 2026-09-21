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
        if (password.includes('\0')) {
            new Notice('The password cannot contain a null character.');
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

            const passwordArgs = password ? [`-p${password}`, '-mhe=on'] : [];
            await this.runSevenZip([
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
                ...passwordArgs
            ], this.vaultRoot());

            await this.runSevenZip([
                't',
                partialPath,
                '-y',
                '-bd',
                '-bso0',
                '-bsp0',
                '-bse2',
                ...(password ? [`-p${password}`] : [])
            ]);
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
            password = kind === 'automatic' ? this.sessionEncryptionPassword : null;
            if (!password) {
                password = await this.askForPassword(
                    kind === 'automatic' ? 'Automatic encrypted backup' : 'Create encrypted backup',
                    kind === 'automatic'
                        ? 'Enter and confirm the 7z archive password. It will be kept only in memory for automatic backups until Obsidian closes.'
                        : 'Enter and confirm the password for this standard AES-256 encrypted 7z archive. It is not saved to settings.',
                    'Create backup',
                    true
                );
                if (!password) {
                    if (kind === 'automatic') new Notice('Automatic encrypted backup skipped because no password was entered.');
                    return;
                }
                this.sessionEncryptionPassword = password;
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
        const passwordArgs = password ? [`-p${password}`] : [];
        try {
            await this.runSevenZip([
                't',
                backup.absolutePath,
                '-y',
                '-bd',
                '-bso0',
                '-bsp0',
                '-bse2',
                ...passwordArgs
            ]);
            await this.runSevenZip([
                'x',
                backup.absolutePath,
                `-o${tempRoot}`,
                '-y',
                '-aoa',
                '-bd',
                '-bso0',
                '-bsp0',
                '-bse2',
                ...passwordArgs
            ]);
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
            password = await this.askForPassword(
                'Unlock encrypted backup',
                backup.format === '7z'
                    ? 'Enter the password for this AES-256 encrypted 7z archive.'
                    : 'Enter the password used by this legacy encrypted vault backup.',
                'Unlock and restore',
                false
            );
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
                    try {
                        const executable = await this.resolveSevenZipExecutable();
                        new Notice(`7-Zip found: ${executable}`, 8000);
                    } catch (error) {
                        new Notice(error instanceof Error ? error.message : String(error), 10000);
                    }
                }));

        new Setting(containerEl)
            .setName('Encrypt backups')
            .setDesc('Uses standard 7z AES-256 encryption with encrypted filenames. The password is requested in a popup and is never saved to settings. Automatic backups reuse it only in memory until Obsidian closes.')
            .addToggle(toggle => toggle
                .setValue(this.settings.encryptionEnabled)
                .onChange(async value => {
                    this.settings.encryptionEnabled = value;
                    if (!value) this.sessionEncryptionPassword = null;
                    await this.pluginInstance.saveSettings();
                }));

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
