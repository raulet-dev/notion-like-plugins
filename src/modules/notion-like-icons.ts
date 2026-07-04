import { Component, App, PluginManifest, Setting, MarkdownView, requestUrl, Modal } from 'obsidian';

export interface NotionIconsSettings {
    icons: Record<string, string>;
    iconsFolder: string;
}

export const NOTION_ICONS_DEFAULTS: NotionIconsSettings = {
    icons: { phx_dark: "phx_dark.png" },
    iconsFolder: 'ZZ - Dependencies/notion-like-plugins/notion-like-icons'
};

const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif', 'image/svg+xml'];

export class NotionIconsModule extends Component {
    app: App;
    manifest: PluginManifest;
    pluginInstance: any;
    moduleId: string;
    
    folderIconsCache: Record<string, string> = {};
    private observer: MutationObserver | null = null;

    constructor(app: App, manifest: PluginManifest, pluginInstance: any, moduleId: string) {
        super();
        this.app = app;
        this.manifest = manifest;
        this.pluginInstance = pluginInstance;
        this.moduleId = moduleId;
    }

    get settings(): NotionIconsSettings {
        return this.pluginInstance.settings.modulesData[this.moduleId];
    }

    async onload() {
        await this.ensureIconFolder();
        await this.scanVaultForFolderIcons();
        await this.generateDynamicCssSnippet();

        this.pluginInstance.addRibbonIcon('image-plus', 'Notion-like Icon Manager', () => {
            new CentralIconLibraryModal(this.app, this).open();
        });

        this.pluginInstance.addCommand({
            id: 'open-icon-manager',
            name: 'Open Global Icon Library Manager',
            callback: () => { new CentralIconLibraryModal(this.app, this).open(); }
        });

        this.pluginInstance.addCommand({
            id: 'add-notion-icon',
            name: 'Configure Current Note Icon',
            callback: () => {
                const activeFile = this.app.workspace.getActiveFile();
                if (activeFile) {
                    new UniversalIconPickerModal(this.app, this, { type: 'note', target: activeFile }).open();
                }
            }
        });

        this.registerEvent(
            this.app.workspace.on('file-menu', (menu, abstractFile) => {
                if ((abstractFile as any).children) {
                    menu.addItem((item) => {
                        item.setTitle('Configure Folder Icon')
                            .setIcon('folder')
                            .onClick(() => {
                                new UniversalIconPickerModal(this.app, this, { type: 'folder', target: abstractFile }).open();
                            });
                    });
                }
            })
        );

        this.observer = new MutationObserver((mutations) => {
            for (let mutation of mutations) {
                for (let node of mutation.addedNodes) {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        this.applyShortcodeAttributes(node as HTMLElement);
                    }
                }
            }
        });
        this.observer.observe(document.body, { childList: true, subtree: true });

        this.registerEvent(this.app.workspace.on('layout-change', () => this.refreshAllDisplays()));
        this.registerEvent(this.app.workspace.on('file-open', () => this.refreshAllDisplays()));
        this.registerEvent(this.app.metadataCache.on('changed', () => this.refreshAllDisplays()));

        this.app.workspace.onLayoutReady(() => {
            this.applyShortcodeAttributes(document.body);
            this.refreshAllDisplays();
        });
    }

    onunload() {
        if (this.observer) this.observer.disconnect();
    }

    getIconFolderPath() {
        return this.settings.iconsFolder?.trim() || NOTION_ICONS_DEFAULTS.iconsFolder;
    }

    async ensureIconFolder() {
        const path = this.getIconFolderPath();
        if (!(await this.app.vault.adapter.exists(path))) {
            await this.app.vault.adapter.mkdir(path);
        }
    }

    getIconSrcPath(filename: string) {
        if (!filename) return '';
        const rawPath = `${this.getIconFolderPath()}/${filename}`;
        const normalizedPath = decodeURIComponent(rawPath);
        return this.app.vault.adapter.getResourcePath(normalizedPath);
    }

    async scanVaultForFolderIcons() {
        this.folderIconsCache = {};
        await this.scanFolderRecursive('');
    }

    async scanFolderRecursive(folderPath: string) {
        const list = await this.app.vault.adapter.list(folderPath);
        if (folderPath === this.getIconFolderPath()) return;

        const configFilePath = folderPath ? `${folderPath}/.folder-icon.json` : '.folder-icon.json';
        if (await this.app.vault.adapter.exists(configFilePath)) {
            try {
                const data = JSON.parse(await this.app.vault.adapter.read(configFilePath));
                if (data && data.iconName) {
                    this.folderIconsCache[folderPath || '/'] = data.iconName;
                }
            } catch(e) {}
        }

        for (let subFolder of list.folders) {
            await this.scanFolderRecursive(subFolder);
        }
    }

    async generateDynamicCssSnippet() {
        let cssContent = `/* Automatically generated by Notion-like Icons Plugin */\n`;
        cssContent += `span[data-shortcode] { display: inline-flex; align-items: center; color: transparent !important; font-size: 0 !important; position: relative; vertical-align: middle; }\n`;
        cssContent += `span[data-shortcode]::before { content: ""; display: inline-block; background-size: contain; background-repeat: no-repeat; background-position: center; border-radius: 4px; }\n`;

        Object.keys(this.settings.icons).forEach((name) => {
            const filename = this.settings.icons[name];
            const localSrc = this.getIconSrcPath(filename);
            cssContent += `span[data-shortcode="${name}"]::before { background-image: url("${localSrc}"); width: 18px; height: 18px; margin-right: 4px; }\n`;
        });

        const snippetPath = `${this.app.vault.configDir}/snippets/notion-live-icons.css`;
        if (!(await this.app.vault.adapter.exists(`${this.app.vault.configDir}/snippets`))) {
            await this.app.vault.adapter.mkdir(`${this.app.vault.configDir}/snippets`);
        }
        await this.app.vault.adapter.write(snippetPath, cssContent);
        (this.app as any).customCss?.setCssEnabledStatus?.("notion-live-icons", true);
        (this.app as any).customCss?.requestLoadSnippets?.();
    }

    applyShortcodeAttributes(element: HTMLElement) {
        if (!element) return;
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null);
        let textNode;
        const regex = /:([a-zA-Z0-9_-]+):/g;
        const nodesToReplace: Node[] = [];

        while (textNode = walker.nextNode()) {
            if (regex.test(textNode.nodeValue || '')) {
                if (textNode.parentElement && (
                    textNode.parentElement.closest('.modal') || 
                    textNode.parentElement.closest('code') ||
                    textNode.parentElement.hasAttribute('data-shortcode') ||
                    textNode.parentElement.classList.contains('inline-title') ||
                    textNode.parentElement.classList.contains('notion-sidebar-icon')
                )) {
                    continue;
                }
                nodesToReplace.push(textNode);
            }
            regex.lastIndex = 0; 
        }

        nodesToReplace.forEach(node => {
            const text = node.nodeValue || '';
            const parent = node.parentElement;
            if (!parent) return;

            const matches = [...text.matchAll(regex)];
            const fragment = document.createDocumentFragment();
            let lastIndex = 0;
            let hasValidMatch = false;

            matches.forEach(match => {
                const iconName = match[1];
                const fullShortcode = match[0];
                const matchIndex = match.index!;

                if (matchIndex > lastIndex) {
                    fragment.appendChild(document.createTextNode(text.substring(lastIndex, matchIndex)));
                }

                if (this.settings.icons[iconName]) {
                    hasValidMatch = true;
                    const insideBasesCell = parent.closest('td') || parent.closest('.metadata-property') || parent.closest('.db-folder');
                    
                    if (insideBasesCell) {
                        const img = document.createElement('img');
                        img.src = this.getIconSrcPath(this.settings.icons[iconName]);
                        img.style.width = "16px"; img.style.height = "16px";
                        img.style.objectFit = "contain"; img.style.display = "inline-block";
                        img.style.verticalAlign = "middle"; img.style.marginRight = "4px";
                        fragment.appendChild(img);
                    } else {
                        const span = document.createElement('span');
                        span.setAttribute('data-shortcode', iconName);
                        span.textContent = fullShortcode;
                        fragment.appendChild(span);
                    }
                } else {
                    fragment.appendChild(document.createTextNode(fullShortcode));
                }
                lastIndex = matchIndex + fullShortcode.length;
            });

            if (lastIndex < text.length) {
                fragment.appendChild(document.createTextNode(text.substring(lastIndex)));
            }
            if (hasValidMatch) parent.replaceChild(fragment, node);
        });
    }

    refreshAllDisplays() {
        this.renderIconArea();
        this.renderFileExplorerIcons();
        this.applyShortcodeAttributes(document.body);
    }

    async assignIconToNote(file: any, iconName: string) {
        await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
            frontmatter['notion-like-icon'] = `:${iconName}:`;
        });
        this.refreshAllDisplays();
    }

    async removeIconFromNote(file: any) {
        await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
            delete frontmatter['notion-like-icon'];
        });
        this.refreshAllDisplays();
    }

    async assignIconToFolder(folderPath: string, iconName: string) {
        const cacheKey = folderPath || '/';
        this.folderIconsCache[cacheKey] = iconName;
        const configFilePath = folderPath ? `${folderPath}/.folder-icon.json` : '.folder-icon.json';
        await this.app.vault.adapter.write(configFilePath, JSON.stringify({ iconName }, null, 2));
        this.refreshAllDisplays();
    }

    async removeIconFromFolder(folderPath: string) {
        const cacheKey = folderPath || '/';
        delete this.folderIconsCache[cacheKey];
        const configFilePath = folderPath ? `${folderPath}/.folder-icon.json` : '.folder-icon.json';
        if (await this.app.vault.adapter.exists(configFilePath)) {
            await this.app.vault.adapter.remove(configFilePath);
        }
        this.refreshAllDisplays();
    }

    renderIconArea() {
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!activeView || !activeView.file) return;

        const file = activeView.file;
        const cache = this.app.metadataCache.getFileCache(file);
        const iconPropValue = cache?.frontmatter?.['notion-like-icon'] || '';

        const existingWrapper = activeView.containerEl.querySelector('.notion-icon-wrapper');
        if (existingWrapper) existingWrapper.remove();

        const titleContainer = activeView.containerEl.querySelector('.inline-title');
        if (!titleContainer || !titleContainer.parentElement) return;

        const wrapper = document.createElement('div');
        wrapper.className = 'notion-icon-wrapper';
        const iconName = iconPropValue.replace(/:/g, '').trim();

        if (iconName && this.settings.icons[iconName]) {
            const iconContainer = wrapper.createEl('div', { cls: 'notion-icon-container' });
            const iconImg = document.createElement('img');
            iconImg.src = this.getIconSrcPath(this.settings.icons[iconName]);
            iconImg.className = 'notion-active-icon';
            
            iconImg.addEventListener('click', () => {
                new UniversalIconPickerModal(this.app, this, { type: 'note', target: file }).open();
            });
            iconContainer.appendChild(iconImg);
        } else {
            const addBtn = document.createElement('button');
            addBtn.className = 'notion-add-icon-btn';
            addBtn.innerHTML = '<span>➕</span> Add icon';
            addBtn.addEventListener('click', () => {
                new UniversalIconPickerModal(this.app, this, { type: 'note', target: file }).open();
            });
            wrapper.appendChild(addBtn);
        }
        titleContainer.parentElement.insertBefore(wrapper, titleContainer);
    }

    renderFileExplorerIcons() {
        const fileExplorerLeaves = this.app.workspace.getLeavesOfType('file-explorer');
        fileExplorerLeaves.forEach((leaf) => {
            const fileItems = (leaf.view as any).fileItems; if (!fileItems) return;
            Object.keys(fileItems).forEach((path) => {
                const item = fileItems[path]; if (!item || !item.el) return;
                const oldIcon = item.el.querySelector('.notion-sidebar-icon');
                if (oldIcon) oldIcon.remove();

                const abstractFile = this.app.vault.getAbstractFileByPath(path);
                if (!abstractFile) return;

                let iconName = '';
                if ((abstractFile as any).children) {
                    iconName = this.folderIconsCache[path || '/'] || '';
                } else {
                    const cache = this.app.metadataCache.getCache(path);
                    const rawProp = cache?.frontmatter?.['notion-like-icon'] || '';
                    iconName = rawProp.replace(/:/g, '').trim();
                }

                if (iconName && this.settings.icons[iconName]) {
                    const iconImg = document.createElement('img');
                    iconImg.src = this.getIconSrcPath(this.settings.icons[iconName]);
                    iconImg.className = 'notion-sidebar-icon';
                    
                    const titleEl = item.el.querySelector('.nav-folder-title-content') || item.el.querySelector('.nav-file-title-content');
                    if (titleEl) titleEl.parentElement.insertBefore(iconImg, titleEl);
                }
            });
        });
    }

    async processImageBlob(blob: Blob, name: string): Promise<string> {
        if (!ALLOWED_IMAGE_TYPES.includes(blob.type)) throw new Error("InvalidFormat");
        const img = new Image();
        img.src = URL.createObjectURL(blob);
        await new Promise((resolve, reject) => {
            img.onload = resolve; img.onerror = () => reject(new Error("CorruptedImage"));
        });

        const canvas = document.createElement('canvas');
        canvas.width = 64; canvas.height = 64;
        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.drawImage(img, 0, 0, 64, 64);
            const targetBlob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/png'));
            if (!targetBlob) throw new Error("CanvasFailure");
            const arrayBuffer = await targetBlob.arrayBuffer();
            const cleanName = name.replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
            const filename = `${cleanName}.png`;
            await this.app.vault.adapter.writeBinary(`${this.getIconFolderPath()}/${filename}`, arrayBuffer);
            URL.revokeObjectURL(img.src);
            this.settings.icons[cleanName] = filename;
            await this.pluginInstance.saveSettings();
            await this.generateDynamicCssSnippet(); 
            return cleanName;
        }
        throw new Error("CanvasFailure");
    }

    async downloadAndSaveIcon(url: string, name: string) {
        url = url.trim();
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            return { success: false, message: "❌ Invalid URL protocol." };
        }
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 7000));
        try {
            const response = await Promise.race([requestUrl({ url: url }), timeoutPromise]) as any;
            const contentType = (response.headers['content-type'] || response.headers['Content-Type'] || '').toLowerCase();
            if (contentType.includes('text/html') || !ALLOWED_IMAGE_TYPES.some(t => contentType.includes(t))) {
                throw new Error("NotAnImage");
            }
            const cleanMimeType = ALLOWED_IMAGE_TYPES.find(t => contentType.includes(t)) || 'image/png';
            const blob = new Blob([response.arrayBuffer], { type: cleanMimeType });
            const savedName = await this.processImageBlob(blob, name);
            return { success: true, name: savedName };
        } catch (error) {
            return { success: false, message: "⚠️ Failed to fetch image online." };
        }
    }

    async renameIconShortcode(oldName: string, newName: string) {
        newName = newName.replace(/[^a-z0-9_-]/gi, '_').toLowerCase().trim();
        if (!newName || oldName === newName) return { success: false };
        if (this.settings.icons[newName]) return { success: false, message: "❌ Code already exists!" };

        this.settings.icons[newName] = this.settings.icons[oldName];
        delete this.settings.icons[oldName];
        await this.pluginInstance.saveSettings();
        await this.generateDynamicCssSnippet();
        return { success: true };
    }

    async removeIconFromLibrary(name: string) {
        const filename = this.settings.icons[name];
        if (filename) {
            try {
                const fullPath = `${this.getIconFolderPath()}/${filename}`;
                if (await this.app.vault.adapter.exists(fullPath)) {
                    await this.app.vault.adapter.remove(fullPath);
                }
            } catch (e) {}
        }
        delete this.settings.icons[name];
        await this.pluginInstance.saveSettings();
        await this.generateDynamicCssSnippet(); 
    }

    renderSettings(containerEl: HTMLElement) {
        new Setting(containerEl)
            .setName('Icons Storage Folder')
            .setDesc('Asset assets deployment workspace container track route.')
            .addText(text => text
                .setValue(this.settings.iconsFolder || '')
                .onChange(async (value) => {
                    this.settings.iconsFolder = value.trim();
                    await this.pluginInstance.saveSettings();
                    await this.ensureIconFolder();
                }));
    }
}

class CentralIconLibraryModal extends Modal {
    plugin: NotionIconsModule;
    jszipInstance: any = null;
    constructor(app: App, plugin: NotionIconsModule) { super(app); this.plugin = plugin; }
    
    async getJSZip() {
        if (this.jszipInstance) return this.jszipInstance;
        if ((window as any).JSZip) return (window as any).JSZip;
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
        document.head.appendChild(script);
        await new Promise((resolve) => script.onload = resolve);
        return (window as any).JSZip;
    }

    getMimeTypeByExtension(filename: string) {
        const ext = filename.split('.').pop()?.toLowerCase();
        if (ext === 'png') return 'image/png';
        if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
        if (ext === 'webp') return 'image/webp';
        return '';
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl('h2', { text: 'Global Icon Library Manager' });
        const errorDiv = contentEl.createEl('div');
        errorDiv.style.cssText = 'color: var(--text-error); margin-bottom: 12px; display: none;';

        const searchInput = contentEl.createEl('input');
        searchInput.style.cssText = 'width:100%; margin-bottom:15px; padding:8px; border-radius:6px;';
        searchInput.placeholder = '🔍 Search active library codes...';

        const grid = contentEl.createEl('div', { cls: 'icon-grid-container' });

        const rebuildGrid = () => {
            grid.empty();
            Object.keys(this.plugin.settings.icons).forEach(name => {
                const item = grid.createDiv({ cls: 'icon-grid-item global-card' });
                item.setAttribute('data-name', name.toLowerCase());
                item.createEl('img', { attr: { src: this.plugin.getIconSrcPath(this.plugin.settings.icons[name]) } });
                
                const labelContainer = item.createDiv({ cls: 'card-label-wrapper' });
                labelContainer.createEl('span', { text: `:${name}:`, cls: 'card-shortcode-label' });
                
                const editInputBox = labelContainer.createEl('input', { type: 'text', value: name, cls: 'card-edit-input' });
                const saveRenameBtn = labelContainer.createEl('button', { text: '✓', cls: 'card-edit-save-btn' });

                const actionsBox = item.createDiv({ cls: 'card-actions-overlay' });
                actionsBox.createEl('button', { text: '📋' }).addEventListener('click', (e) => {
                    e.stopPropagation(); navigator.clipboard.writeText(`:${name}:`);
                });

                actionsBox.createEl('button', { text: '✏️' }).addEventListener('click', (e) => {
                    e.stopPropagation(); labelContainer.classList.add('is-editing'); editInputBox.focus();
                });

                const deleteBtn = actionsBox.createEl('button', { text: '✕' });
                deleteBtn.style.color = 'var(--text-error)';
                deleteBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    if (confirm('Permanently wipe this icon?')) {
                        await this.plugin.removeIconFromLibrary(name); rebuildGrid(); this.plugin.refreshAllDisplays();
                    }
                });

                saveRenameBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const val = editInputBox.value.trim();
                    if (val && val !== name) {
                        const res = await this.plugin.renameIconShortcode(name, val);
                        if (res && res.message) { errorDiv.innerText = res.message; errorDiv.style.display = 'block'; }
                    }
                    rebuildGrid(); this.plugin.refreshAllDisplays();
                });
            });
        };
        rebuildGrid();

        searchInput.addEventListener('input', (e: any) => {
            const query = e.target.value.toLowerCase().trim();
            grid.querySelectorAll('.icon-grid-item').forEach((item: any) => {
                item.style.display = (item.getAttribute('data-name') || '').includes(query) ? 'flex' : 'none';
            });
        });

        const dropZone = contentEl.createEl('div', { cls: 'icon-drop-zone', text: '📥 Drag image file or a compressed .zip package here' });
        dropZone.addEventListener('dragover', (e) => e.preventDefault());
        dropZone.addEventListener('drop', async (e: DragEvent) => {
            e.preventDefault();
            const dropFile = e.dataTransfer?.files[0]; if (!dropFile) return;

            if (dropFile.name.endsWith('.zip')) {
                try {
                    const zipLib = await this.getJSZip();
                    const zip = await zipLib.loadAsync(dropFile);
                    for (const relPath of Object.keys(zip.files)) {
                        const entry = zip.files[relPath]; if (entry.dir) continue;
                        const mime = this.getMimeTypeByExtension(entry.name); if (!mime) continue;
                        const baseName = entry.name.split('/').pop()?.replace(/\.[^/.]+$/, "").toLowerCase() || 'icon';
                        const buf = await entry.async('arraybuffer');
                        await this.plugin.processImageBlob(new Blob([buf], { type: mime }), baseName);
                    }
                    rebuildGrid(); this.plugin.refreshAllDisplays();
                } catch (err) {}
                return;
            }

            const mime = this.getMimeTypeByExtension(dropFile.name);
            if (mime || ALLOWED_IMAGE_TYPES.includes(dropFile.type)) {
                const cleanName = dropFile.name.replace(/\.[^/.]+$/, "").toLowerCase().replace(/[^a-z0-9_-]/gi, '_');
                await this.plugin.processImageBlob(dropFile, cleanName);
                rebuildGrid(); this.plugin.refreshAllDisplays();
            }
        });
    }
    onClose() { this.contentEl.empty(); }
}

class UniversalIconPickerModal extends Modal {
    plugin: NotionIconsModule; context: any; selectedIconName: string; shouldClearIcon = false;
    constructor(app: App, plugin: NotionIconsModule, context: any) {
        super(app); this.plugin = plugin; this.context = context;
        this.selectedIconName = context.type === 'folder' 
            ? (plugin.folderIconsCache[context.target.path || '/'] || '')
            : ((app.metadataCache.getFileCache(context.target)?.frontmatter?.['notion-like-icon'] || '').replace(/:/g, '').trim());
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl('h2', { text: 'Select Element Identifier Asset' });
        const grid = contentEl.createDiv({ cls: 'icon-grid-container' });

        Object.keys(this.plugin.settings.icons).forEach(name => {
            const item = grid.createDiv({ cls: 'icon-grid-item note-card' });
            item.createEl('img', { attr: { src: this.plugin.getIconSrcPath(this.plugin.settings.icons[name]) } });
            item.createEl('span', { text: `:${name}:` });
            item.addEventListener('click', async () => {
                if (this.context.type === 'folder') {
                    await this.plugin.assignIconToFolder(this.context.target.path, name);
                } else {
                    await this.plugin.assignIconToNote(this.context.target, name);
                }
                this.close();
            });
        });

        const clearBtn = contentEl.createEl('button', { cls: 'mod-warning', text: 'Clear Icon' });
        clearBtn.addEventListener('click', async () => {
            if (this.context.type === 'folder') {
                await this.plugin.removeIconFromFolder(this.context.target.path);
            } else {
                await this.plugin.removeIconFromNote(this.context.target);
            }
            this.close();
        });
    }
    onClose() { this.contentEl.empty(); }
}