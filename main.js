var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => MasterOrchestratorPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian5 = require("obsidian");

// src/modules/cryptomator-keep-alive.ts
var import_obsidian = require("obsidian");
var CRYPTOMATOR_KEEP_ALIVE_DEFAULTS = {
  intervalSeconds: 28,
  mode: "write-delete",
  filePath: "ZZ - Dependencies/notion-like-plugins/keep-alive.tmp"
};
var CryptomatorKeepAliveModule = class extends import_obsidian.Component {
  app;
  manifest;
  pluginInstance;
  moduleId;
  intervalHandle = null;
  constructor(app, manifest, pluginInstance, moduleId) {
    super();
    this.app = app;
    this.manifest = manifest;
    this.pluginInstance = pluginInstance;
    this.moduleId = moduleId;
  }
  get settings() {
    return this.pluginInstance.settings.modulesData[this.moduleId];
  }
  async onload() {
    this.startTicking();
    this.pluginInstance.addCommand({
      id: "cryptomator-keepalive-read-now",
      name: "Cryptomator Keep-Alive: trigger now",
      callback: () => this.tick()
    });
  }
  onunload() {
    this.stopTicking();
  }
  startTicking() {
    this.stopTicking();
    const seconds = Math.max(5, Number(this.settings.intervalSeconds) || 60);
    this.intervalHandle = window.setInterval(() => this.tick(), seconds * 1e3);
  }
  stopTicking() {
    if (this.intervalHandle) {
      window.clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }
  getTargetPath() {
    const custom = (this.settings.filePath || "").trim();
    return custom.length > 0 ? custom : `cryptomator-keepalive-heartbeat.tmp`;
  }
  async tick() {
    const path = this.getTargetPath();
    try {
      const lastSlash = path.lastIndexOf("/");
      if (lastSlash > 0) {
        const dir = path.substring(0, lastSlash);
        if (!await this.app.vault.adapter.exists(dir)) {
          await this.app.vault.adapter.mkdir(dir);
        }
      }
      await this.app.vault.adapter.write(path, `keepalive:${Date.now()}`);
      if (this.settings.mode === "write-delete") {
        await this.app.vault.adapter.remove(path);
      }
    } catch (err) {
      console.warn(`[cryptomator-keepalive] tick failed for "${path}":`, err);
    }
  }
  renderSettings(containerEl) {
    new import_obsidian.Setting(containerEl).setName("Interval (seconds)").setDesc("How often to touch the vault.").addText(
      (text) => text.setValue(String(this.settings.intervalSeconds)).onChange(async (value) => {
        const parsed = Number(value);
        this.settings.intervalSeconds = Number.isFinite(parsed) && parsed > 0 ? parsed : CRYPTOMATOR_KEEP_ALIVE_DEFAULTS.intervalSeconds;
        await this.pluginInstance.saveSettings();
        this.startTicking();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Mode").addDropdown(
      (drop) => drop.addOption("write", "Write").addOption("write-delete", "Write + delete").setValue(this.settings.mode).onChange(async (value) => {
        this.settings.mode = value;
        await this.pluginInstance.saveSettings();
      })
    );
  }
};

// src/modules/font-colors.ts
var import_obsidian2 = require("obsidian");
var FONT_COLORS_DEFAULTS = {
  textColors: [
    { name: "Gray", hex: "#737373" },
    { name: "Brown", hex: "#8B5A2B" },
    { name: "Orange", hex: "#FF6B00" },
    { name: "Yellow", hex: "#D4A373" },
    { name: "Green", hex: "#00A86B" },
    { name: "Blue", hex: "#0077B6" },
    { name: "Purple", hex: "#7209B7" },
    { name: "Pink", hex: "#FF477E" }
  ],
  backgroundPairs: [
    { name: "Gray", bg: "#555555", text: "#FFFFFF" },
    { name: "Brown", bg: "#6E473B", text: "#FFFFFF" },
    { name: "Orange", bg: "#FF6B00", text: "#FFFFFF" },
    { name: "Yellow", bg: "#FFD166", text: "#1C1A17" },
    { name: "Green", bg: "#06D6A0", text: "#1C1A17" },
    { name: "Blue", bg: "#118AB2", text: "#FFFFFF" },
    { name: "Purple", bg: "#7209B7", text: "#FFFFFF" },
    { name: "Pink", bg: "#EF476F", text: "#FFFFFF" }
  ]
};
var FontColorsModule = class extends import_obsidian2.Component {
  app;
  manifest;
  pluginInstance;
  moduleId;
  constructor(app, manifest, pluginInstance, moduleId) {
    super();
    this.app = app;
    this.manifest = manifest;
    this.pluginInstance = pluginInstance;
    this.moduleId = moduleId;
  }
  get settings() {
    return this.pluginInstance.settings.modulesData[this.moduleId];
  }
  async onload() {
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor) => {
        let targetData = this.detectAndExpandSpanSelection(editor);
        if (!targetData.text || targetData.text.trim() === "") return;
        menu.addSeparator();
        menu.addItem((item) => {
          item.setTitle("Text Color").setIcon("type").setSubmenu();
          item.submenu.addItem((subItem) => {
            subItem.setTitle("Clear Text Color").setIcon("eraser").onClick(() => {
              editor.setSelection(targetData.startPos, targetData.endPos);
              editor.replaceSelection(targetData.cleanText);
            });
          });
          this.settings.textColors.forEach((c) => {
            item.submenu.addItem((subItem) => {
              subItem.setTitle(c.name).onClick(() => {
                editor.setSelection(targetData.startPos, targetData.endPos);
                const replacement = `<span style="color: ${c.hex};">${targetData.cleanText}</span>`;
                editor.replaceSelection(replacement);
              });
              setTimeout(() => {
                if (subItem.dom) {
                  subItem.dom.style.color = c.hex;
                  subItem.dom.style.fontWeight = "600";
                }
              }, 0);
            });
          });
        });
        menu.addItem((item) => {
          item.setTitle("Background Color").setIcon("highlighter").setSubmenu();
          item.submenu.addItem((subItem) => {
            subItem.setTitle("Clear Background").setIcon("eraser").onClick(() => {
              editor.setSelection(targetData.startPos, targetData.endPos);
              editor.replaceSelection(targetData.cleanText);
            });
          });
          this.settings.backgroundPairs.forEach((c) => {
            item.submenu.addItem((subItem) => {
              subItem.setTitle(`${c.name} background`).onClick(() => {
                editor.setSelection(targetData.startPos, targetData.endPos);
                const replacement = `<span style="background-color: ${c.bg}; color: ${c.text}; padding: 2px 6px; border-radius: 4px; display: inline-block; line-height: 1.2;">${targetData.cleanText}</span>`;
                editor.replaceSelection(replacement);
              });
              setTimeout(() => {
                if (subItem.dom) {
                  subItem.dom.style.backgroundColor = c.bg;
                  subItem.dom.style.color = c.text;
                  subItem.dom.style.borderRadius = "4px";
                  subItem.dom.style.margin = "2px 4px";
                  subItem.dom.style.padding = "4px 8px";
                }
              }, 0);
            });
          });
        });
      })
    );
  }
  detectAndExpandSpanSelection(editor) {
    let from = editor.getCursor("from");
    let to = editor.getCursor("to");
    let rawSelectedText = editor.getSelection();
    let lineText = editor.getLine(from.line);
    let extendedFromOffset = Math.max(0, from.ch - 150);
    let extendedToOffset = Math.min(lineText.length, to.ch + 50);
    let contextLeft = lineText.substring(extendedFromOffset, from.ch);
    let contextRight = lineText.substring(to.ch, extendedToOffset);
    let startPos = { line: from.line, ch: from.ch };
    let endPos = { line: to.line, ch: to.ch };
    let leftSpanMatch = contextLeft.match(/<span style="[^"]*">[^<>]*$/i);
    let rightSpanMatch = contextRight.match(/^[^<>]*<\/span>/i);
    if (leftSpanMatch && rightSpanMatch) {
      startPos.ch = extendedFromOffset + leftSpanMatch.index;
      endPos.ch = to.ch + rightSpanMatch[0].length;
      rawSelectedText = lineText.substring(startPos.ch, endPos.ch);
    }
    let cleanText = rawSelectedText.replace(/<(span|font)[^>]*>([\s\S]*?)<\/\1>/gi, "$2");
    return { text: rawSelectedText, cleanText, startPos, endPos };
  }
  renderSettings(containerEl) {
    containerEl.createEl("h3", { text: "Text Colors" });
    this.settings.textColors.forEach((color, index) => {
      const s = new import_obsidian2.Setting(containerEl).setName(`Text Color #${index + 1}`);
      const previewEl = s.nameEl.createEl("span", { text: "Sample" });
      previewEl.style.color = color.hex;
      previewEl.style.fontWeight = "600";
      previewEl.style.marginRight = "15px";
      previewEl.style.border = "1px solid var(--background-modifier-border)";
      previewEl.style.padding = "2px 6px";
      previewEl.style.borderRadius = "4px";
      s.addText((text) => text.setValue(color.name).onChange(async (value) => {
        color.name = value;
        await this.pluginInstance.saveSettings();
      })).addColorPicker((cp) => cp.setValue(color.hex).onChange(async (value) => {
        color.hex = value;
        if (previewEl) previewEl.style.color = value;
        await this.pluginInstance.saveSettings();
      })).addButton((btn) => btn.setButtonText("Delete").setWarning().onClick(async () => {
        this.settings.textColors.splice(index, 1);
        await this.pluginInstance.saveSettings();
        this.pluginInstance.refreshSettingsUi();
      }));
    });
    new import_obsidian2.Setting(containerEl).setName("Add Custom Text Color").addButton((btn) => btn.setButtonText("Add Color").setCta().onClick(async () => {
      this.settings.textColors.push({ name: "Custom Color", hex: "#000000" });
      await this.pluginInstance.saveSettings();
      this.pluginInstance.refreshSettingsUi();
    }));
  }
};

// src/modules/notion-like-icons.ts
var import_obsidian3 = require("obsidian");
var NOTION_ICONS_DEFAULTS = {
  icons: { phx_dark: "phx_dark.png" },
  iconsFolder: "ZZ - Dependencies/notion-like-plugins/notion-like-icons"
};
var ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif", "image/svg+xml"];
var NotionIconsModule = class extends import_obsidian3.Component {
  app;
  manifest;
  pluginInstance;
  moduleId;
  folderIconsCache = {};
  observer = null;
  constructor(app, manifest, pluginInstance, moduleId) {
    super();
    this.app = app;
    this.manifest = manifest;
    this.pluginInstance = pluginInstance;
    this.moduleId = moduleId;
  }
  get settings() {
    return this.pluginInstance.settings.modulesData[this.moduleId];
  }
  async onload() {
    await this.ensureIconFolder();
    await this.scanVaultForFolderIcons();
    await this.generateDynamicCssSnippet();
    this.pluginInstance.addRibbonIcon("image-plus", "Notion-like Icon Manager", () => {
      new CentralIconLibraryModal(this.app, this).open();
    });
    this.pluginInstance.addCommand({
      id: "open-icon-manager",
      name: "Open Global Icon Library Manager",
      callback: () => {
        new CentralIconLibraryModal(this.app, this).open();
      }
    });
    this.pluginInstance.addCommand({
      id: "add-notion-icon",
      name: "Configure Current Note Icon",
      callback: () => {
        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile) {
          new UniversalIconPickerModal(this.app, this, { type: "note", target: activeFile }).open();
        }
      }
    });
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, abstractFile) => {
        if (abstractFile.children) {
          menu.addItem((item) => {
            item.setTitle("Configure Folder Icon").setIcon("folder").onClick(() => {
              new UniversalIconPickerModal(this.app, this, { type: "folder", target: abstractFile }).open();
            });
          });
        }
      })
    );
    this.observer = new MutationObserver((mutations) => {
      for (let mutation of mutations) {
        for (let node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            this.applyShortcodeAttributes(node);
          }
        }
      }
    });
    this.observer.observe(document.body, { childList: true, subtree: true });
    this.registerEvent(this.app.workspace.on("layout-change", () => this.refreshAllDisplays()));
    this.registerEvent(this.app.workspace.on("file-open", () => this.refreshAllDisplays()));
    this.registerEvent(this.app.metadataCache.on("changed", () => this.refreshAllDisplays()));
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
    if (!await this.app.vault.adapter.exists(path)) {
      await this.app.vault.adapter.mkdir(path);
    }
  }
  getIconSrcPath(filename) {
    if (!filename) return "";
    const rawPath = `${this.getIconFolderPath()}/${filename}`;
    const normalizedPath = decodeURIComponent(rawPath);
    return this.app.vault.adapter.getResourcePath(normalizedPath);
  }
  async scanVaultForFolderIcons() {
    this.folderIconsCache = {};
    await this.scanFolderRecursive("");
  }
  async scanFolderRecursive(folderPath) {
    const list = await this.app.vault.adapter.list(folderPath);
    if (folderPath === this.getIconFolderPath()) return;
    const configFilePath = folderPath ? `${folderPath}/.folder-icon.json` : ".folder-icon.json";
    if (await this.app.vault.adapter.exists(configFilePath)) {
      try {
        const data = JSON.parse(await this.app.vault.adapter.read(configFilePath));
        if (data && data.iconName) {
          this.folderIconsCache[folderPath || "/"] = data.iconName;
        }
      } catch (e) {
      }
    }
    for (let subFolder of list.folders) {
      await this.scanFolderRecursive(subFolder);
    }
  }
  async generateDynamicCssSnippet() {
    let cssContent = `/* Automatically generated by Notion-like Icons Plugin */
`;
    cssContent += `span[data-shortcode] { display: inline-flex; align-items: center; color: transparent !important; font-size: 0 !important; position: relative; vertical-align: middle; }
`;
    cssContent += `span[data-shortcode]::before { content: ""; display: inline-block; background-size: contain; background-repeat: no-repeat; background-position: center; border-radius: 4px; }
`;
    Object.keys(this.settings.icons).forEach((name) => {
      const filename = this.settings.icons[name];
      const localSrc = this.getIconSrcPath(filename);
      cssContent += `span[data-shortcode="${name}"]::before { background-image: url("${localSrc}"); width: 18px; height: 18px; margin-right: 4px; }
`;
    });
    const snippetPath = `${this.app.vault.configDir}/snippets/notion-live-icons.css`;
    if (!await this.app.vault.adapter.exists(`${this.app.vault.configDir}/snippets`)) {
      await this.app.vault.adapter.mkdir(`${this.app.vault.configDir}/snippets`);
    }
    await this.app.vault.adapter.write(snippetPath, cssContent);
    this.app.customCss?.setCssEnabledStatus?.("notion-live-icons", true);
    this.app.customCss?.requestLoadSnippets?.();
  }
  applyShortcodeAttributes(element) {
    if (!element) return;
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null);
    let textNode;
    const regex = /:([a-zA-Z0-9_-]+):/g;
    const nodesToReplace = [];
    while (textNode = walker.nextNode()) {
      if (regex.test(textNode.nodeValue || "")) {
        if (textNode.parentElement && (textNode.parentElement.closest(".modal") || textNode.parentElement.closest("code") || textNode.parentElement.hasAttribute("data-shortcode") || textNode.parentElement.classList.contains("inline-title") || textNode.parentElement.classList.contains("notion-sidebar-icon"))) {
          continue;
        }
        nodesToReplace.push(textNode);
      }
      regex.lastIndex = 0;
    }
    nodesToReplace.forEach((node) => {
      const text = node.nodeValue || "";
      const parent = node.parentElement;
      if (!parent) return;
      const matches = [...text.matchAll(regex)];
      const fragment = document.createDocumentFragment();
      let lastIndex = 0;
      let hasValidMatch = false;
      matches.forEach((match) => {
        const iconName = match[1];
        const fullShortcode = match[0];
        const matchIndex = match.index;
        if (matchIndex > lastIndex) {
          fragment.appendChild(document.createTextNode(text.substring(lastIndex, matchIndex)));
        }
        if (this.settings.icons[iconName]) {
          hasValidMatch = true;
          const insideBasesCell = parent.closest("td") || parent.closest(".metadata-property") || parent.closest(".db-folder");
          if (insideBasesCell) {
            const img = document.createElement("img");
            img.src = this.getIconSrcPath(this.settings.icons[iconName]);
            img.style.width = "16px";
            img.style.height = "16px";
            img.style.objectFit = "contain";
            img.style.display = "inline-block";
            img.style.verticalAlign = "middle";
            img.style.marginRight = "4px";
            fragment.appendChild(img);
          } else {
            const span = document.createElement("span");
            span.setAttribute("data-shortcode", iconName);
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
  async assignIconToNote(file, iconName) {
    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      frontmatter["notion-like-icon"] = `:${iconName}:`;
    });
    this.refreshAllDisplays();
  }
  async removeIconFromNote(file) {
    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      delete frontmatter["notion-like-icon"];
    });
    this.refreshAllDisplays();
  }
  async assignIconToFolder(folderPath, iconName) {
    const cacheKey = folderPath || "/";
    this.folderIconsCache[cacheKey] = iconName;
    const configFilePath = folderPath ? `${folderPath}/.folder-icon.json` : ".folder-icon.json";
    await this.app.vault.adapter.write(configFilePath, JSON.stringify({ iconName }, null, 2));
    this.refreshAllDisplays();
  }
  async removeIconFromFolder(folderPath) {
    const cacheKey = folderPath || "/";
    delete this.folderIconsCache[cacheKey];
    const configFilePath = folderPath ? `${folderPath}/.folder-icon.json` : ".folder-icon.json";
    if (await this.app.vault.adapter.exists(configFilePath)) {
      await this.app.vault.adapter.remove(configFilePath);
    }
    this.refreshAllDisplays();
  }
  renderIconArea() {
    const activeView = this.app.workspace.getActiveViewOfType(import_obsidian3.MarkdownView);
    if (!activeView || !activeView.file) return;
    const file = activeView.file;
    const cache = this.app.metadataCache.getFileCache(file);
    const iconPropValue = cache?.frontmatter?.["notion-like-icon"] || "";
    const existingWrapper = activeView.containerEl.querySelector(".notion-icon-wrapper");
    if (existingWrapper) existingWrapper.remove();
    const titleContainer = activeView.containerEl.querySelector(".inline-title");
    if (!titleContainer || !titleContainer.parentElement) return;
    const wrapper = document.createElement("div");
    wrapper.className = "notion-icon-wrapper";
    const iconName = iconPropValue.replace(/:/g, "").trim();
    if (iconName && this.settings.icons[iconName]) {
      const iconContainer = wrapper.createEl("div", { cls: "notion-icon-container" });
      const iconImg = document.createElement("img");
      iconImg.src = this.getIconSrcPath(this.settings.icons[iconName]);
      iconImg.className = "notion-active-icon";
      iconImg.addEventListener("click", () => {
        new UniversalIconPickerModal(this.app, this, { type: "note", target: file }).open();
      });
      iconContainer.appendChild(iconImg);
    } else {
      const addBtn = document.createElement("button");
      addBtn.className = "notion-add-icon-btn";
      addBtn.innerHTML = "<span>\u2795</span> Add icon";
      addBtn.addEventListener("click", () => {
        new UniversalIconPickerModal(this.app, this, { type: "note", target: file }).open();
      });
      wrapper.appendChild(addBtn);
    }
    titleContainer.parentElement.insertBefore(wrapper, titleContainer);
  }
  renderFileExplorerIcons() {
    const fileExplorerLeaves = this.app.workspace.getLeavesOfType("file-explorer");
    fileExplorerLeaves.forEach((leaf) => {
      const fileItems = leaf.view.fileItems;
      if (!fileItems) return;
      Object.keys(fileItems).forEach((path) => {
        const item = fileItems[path];
        if (!item || !item.el) return;
        const oldIcon = item.el.querySelector(".notion-sidebar-icon");
        if (oldIcon) oldIcon.remove();
        const abstractFile = this.app.vault.getAbstractFileByPath(path);
        if (!abstractFile) return;
        let iconName = "";
        if (abstractFile.children) {
          iconName = this.folderIconsCache[path || "/"] || "";
        } else {
          const cache = this.app.metadataCache.getCache(path);
          const rawProp = cache?.frontmatter?.["notion-like-icon"] || "";
          iconName = rawProp.replace(/:/g, "").trim();
        }
        if (iconName && this.settings.icons[iconName]) {
          const iconImg = document.createElement("img");
          iconImg.src = this.getIconSrcPath(this.settings.icons[iconName]);
          iconImg.className = "notion-sidebar-icon";
          const titleEl = item.el.querySelector(".nav-folder-title-content") || item.el.querySelector(".nav-file-title-content");
          if (titleEl) titleEl.parentElement.insertBefore(iconImg, titleEl);
        }
      });
    });
  }
  async processImageBlob(blob, name) {
    if (!ALLOWED_IMAGE_TYPES.includes(blob.type)) throw new Error("InvalidFormat");
    const img = new Image();
    img.src = URL.createObjectURL(blob);
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error("CorruptedImage"));
    });
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.drawImage(img, 0, 0, 64, 64);
      const targetBlob = await new Promise((res) => canvas.toBlob(res, "image/png"));
      if (!targetBlob) throw new Error("CanvasFailure");
      const arrayBuffer = await targetBlob.arrayBuffer();
      const cleanName = name.replace(/[^a-z0-9_-]/gi, "_").toLowerCase();
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
  async downloadAndSaveIcon(url, name) {
    url = url.trim();
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      return { success: false, message: "\u274C Invalid URL protocol." };
    }
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 7e3));
    try {
      const response = await Promise.race([(0, import_obsidian3.requestUrl)({ url }), timeoutPromise]);
      const contentType = (response.headers["content-type"] || response.headers["Content-Type"] || "").toLowerCase();
      if (contentType.includes("text/html") || !ALLOWED_IMAGE_TYPES.some((t) => contentType.includes(t))) {
        throw new Error("NotAnImage");
      }
      const cleanMimeType = ALLOWED_IMAGE_TYPES.find((t) => contentType.includes(t)) || "image/png";
      const blob = new Blob([response.arrayBuffer], { type: cleanMimeType });
      const savedName = await this.processImageBlob(blob, name);
      return { success: true, name: savedName };
    } catch (error) {
      return { success: false, message: "\u26A0\uFE0F Failed to fetch image online." };
    }
  }
  async renameIconShortcode(oldName, newName) {
    newName = newName.replace(/[^a-z0-9_-]/gi, "_").toLowerCase().trim();
    if (!newName || oldName === newName) return { success: false };
    if (this.settings.icons[newName]) return { success: false, message: "\u274C Code already exists!" };
    this.settings.icons[newName] = this.settings.icons[oldName];
    delete this.settings.icons[oldName];
    await this.pluginInstance.saveSettings();
    await this.generateDynamicCssSnippet();
    return { success: true };
  }
  async removeIconFromLibrary(name) {
    const filename = this.settings.icons[name];
    if (filename) {
      try {
        const fullPath = `${this.getIconFolderPath()}/${filename}`;
        if (await this.app.vault.adapter.exists(fullPath)) {
          await this.app.vault.adapter.remove(fullPath);
        }
      } catch (e) {
      }
    }
    delete this.settings.icons[name];
    await this.pluginInstance.saveSettings();
    await this.generateDynamicCssSnippet();
  }
  renderSettings(containerEl) {
    new import_obsidian3.Setting(containerEl).setName("Icons Storage Folder").setDesc("Asset assets deployment workspace container track route.").addText((text) => text.setValue(this.settings.iconsFolder || "").onChange(async (value) => {
      this.settings.iconsFolder = value.trim();
      await this.pluginInstance.saveSettings();
      await this.ensureIconFolder();
    }));
  }
};
var CentralIconLibraryModal = class extends import_obsidian3.Modal {
  plugin;
  jszipInstance = null;
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
  }
  async getJSZip() {
    if (this.jszipInstance) return this.jszipInstance;
    if (window.JSZip) return window.JSZip;
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
    document.head.appendChild(script);
    await new Promise((resolve) => script.onload = resolve);
    return window.JSZip;
  }
  getMimeTypeByExtension(filename) {
    const ext = filename.split(".").pop()?.toLowerCase();
    if (ext === "png") return "image/png";
    if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
    if (ext === "webp") return "image/webp";
    return "";
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "Global Icon Library Manager" });
    const errorDiv = contentEl.createEl("div");
    errorDiv.style.cssText = "color: var(--text-error); margin-bottom: 12px; display: none;";
    const searchInput = contentEl.createEl("input");
    searchInput.style.cssText = "width:100%; margin-bottom:15px; padding:8px; border-radius:6px;";
    searchInput.placeholder = "\u{1F50D} Search active library codes...";
    const grid = contentEl.createEl("div", { cls: "icon-grid-container" });
    const rebuildGrid = () => {
      grid.empty();
      Object.keys(this.plugin.settings.icons).forEach((name) => {
        const item = grid.createDiv({ cls: "icon-grid-item global-card" });
        item.setAttribute("data-name", name.toLowerCase());
        item.createEl("img", { attr: { src: this.plugin.getIconSrcPath(this.plugin.settings.icons[name]) } });
        const labelContainer = item.createDiv({ cls: "card-label-wrapper" });
        labelContainer.createEl("span", { text: `:${name}:`, cls: "card-shortcode-label" });
        const editInputBox = labelContainer.createEl("input", { type: "text", value: name, cls: "card-edit-input" });
        const saveRenameBtn = labelContainer.createEl("button", { text: "\u2713", cls: "card-edit-save-btn" });
        const actionsBox = item.createDiv({ cls: "card-actions-overlay" });
        actionsBox.createEl("button", { text: "\u{1F4CB}" }).addEventListener("click", (e) => {
          e.stopPropagation();
          navigator.clipboard.writeText(`:${name}:`);
        });
        actionsBox.createEl("button", { text: "\u270F\uFE0F" }).addEventListener("click", (e) => {
          e.stopPropagation();
          labelContainer.classList.add("is-editing");
          editInputBox.focus();
        });
        const deleteBtn = actionsBox.createEl("button", { text: "\u2715" });
        deleteBtn.style.color = "var(--text-error)";
        deleteBtn.addEventListener("click", async (e) => {
          e.stopPropagation();
          if (confirm("Permanently wipe this icon?")) {
            await this.plugin.removeIconFromLibrary(name);
            rebuildGrid();
            this.plugin.refreshAllDisplays();
          }
        });
        saveRenameBtn.addEventListener("click", async (e) => {
          e.stopPropagation();
          const val = editInputBox.value.trim();
          if (val && val !== name) {
            const res = await this.plugin.renameIconShortcode(name, val);
            if (res && res.message) {
              errorDiv.innerText = res.message;
              errorDiv.style.display = "block";
            }
          }
          rebuildGrid();
          this.plugin.refreshAllDisplays();
        });
      });
    };
    rebuildGrid();
    searchInput.addEventListener("input", (e) => {
      const query = e.target.value.toLowerCase().trim();
      grid.querySelectorAll(".icon-grid-item").forEach((item) => {
        item.style.display = (item.getAttribute("data-name") || "").includes(query) ? "flex" : "none";
      });
    });
    const dropZone = contentEl.createEl("div", { cls: "icon-drop-zone", text: "\u{1F4E5} Drag image file or a compressed .zip package here" });
    dropZone.addEventListener("dragover", (e) => e.preventDefault());
    dropZone.addEventListener("drop", async (e) => {
      e.preventDefault();
      const dropFile = e.dataTransfer?.files[0];
      if (!dropFile) return;
      if (dropFile.name.endsWith(".zip")) {
        try {
          const zipLib = await this.getJSZip();
          const zip = await zipLib.loadAsync(dropFile);
          for (const relPath of Object.keys(zip.files)) {
            const entry = zip.files[relPath];
            if (entry.dir) continue;
            const mime2 = this.getMimeTypeByExtension(entry.name);
            if (!mime2) continue;
            const baseName = entry.name.split("/").pop()?.replace(/\.[^/.]+$/, "").toLowerCase() || "icon";
            const buf = await entry.async("arraybuffer");
            await this.plugin.processImageBlob(new Blob([buf], { type: mime2 }), baseName);
          }
          rebuildGrid();
          this.plugin.refreshAllDisplays();
        } catch (err) {
        }
        return;
      }
      const mime = this.getMimeTypeByExtension(dropFile.name);
      if (mime || ALLOWED_IMAGE_TYPES.includes(dropFile.type)) {
        const cleanName = dropFile.name.replace(/\.[^/.]+$/, "").toLowerCase().replace(/[^a-z0-9_-]/gi, "_");
        await this.plugin.processImageBlob(dropFile, cleanName);
        rebuildGrid();
        this.plugin.refreshAllDisplays();
      }
    });
  }
  onClose() {
    this.contentEl.empty();
  }
};
var UniversalIconPickerModal = class extends import_obsidian3.Modal {
  plugin;
  context;
  selectedIconName;
  shouldClearIcon = false;
  constructor(app, plugin, context) {
    super(app);
    this.plugin = plugin;
    this.context = context;
    this.selectedIconName = context.type === "folder" ? plugin.folderIconsCache[context.target.path || "/"] || "" : (app.metadataCache.getFileCache(context.target)?.frontmatter?.["notion-like-icon"] || "").replace(/:/g, "").trim();
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "Select Element Identifier Asset" });
    const grid = contentEl.createDiv({ cls: "icon-grid-container" });
    Object.keys(this.plugin.settings.icons).forEach((name) => {
      const item = grid.createDiv({ cls: "icon-grid-item note-card" });
      item.createEl("img", { attr: { src: this.plugin.getIconSrcPath(this.plugin.settings.icons[name]) } });
      item.createEl("span", { text: `:${name}:` });
      item.addEventListener("click", async () => {
        if (this.context.type === "folder") {
          await this.plugin.assignIconToFolder(this.context.target.path, name);
        } else {
          await this.plugin.assignIconToNote(this.context.target, name);
        }
        this.close();
      });
    });
    const clearBtn = contentEl.createEl("button", { cls: "mod-warning", text: "Clear Icon" });
    clearBtn.addEventListener("click", async () => {
      if (this.context.type === "folder") {
        await this.plugin.removeIconFromFolder(this.context.target.path);
      } else {
        await this.plugin.removeIconFromNote(this.context.target);
      }
      this.close();
    });
  }
  onClose() {
    this.contentEl.empty();
  }
};

// src/modules/vault-size-bar.ts
var import_obsidian4 = require("obsidian");
var VAULT_SIZE_BAR_DEFAULTS = {
  fontSize: 11
};
var VaultSizeBarModule = class extends import_obsidian4.Component {
  app;
  manifest;
  pluginInstance;
  moduleId;
  statusBarEl = null;
  leftSlot = null;
  rightSlot = null;
  lastClickedPath = null;
  constructor(app, manifest, pluginInstance, moduleId) {
    super();
    this.app = app;
    this.manifest = manifest;
    this.pluginInstance = pluginInstance;
    this.moduleId = moduleId;
  }
  get settings() {
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
      const filesContainer = explorerLeaf.view.containerEl.querySelector(".nav-files-container");
      if (filesContainer) filesContainer.style.paddingBottom = "";
    }
  }
  createSizeBar() {
    const fileExplorerView = this.app.workspace.getLeavesOfType("file-explorer")[0]?.view;
    if (!fileExplorerView) return;
    const container = fileExplorerView.containerEl;
    if (!container || container.querySelector(".obsidian-vault-size-bar")) return;
    container.style.position = "relative";
    container.style.display = "flex";
    container.style.flexDirection = "column";
    this.statusBarEl = document.createElement("div");
    this.statusBarEl.addClass("obsidian-vault-size-bar");
    this.leftSlot = document.createElement("span");
    this.leftSlot.addClass("size-bar-left");
    this.rightSlot = document.createElement("span");
    this.rightSlot.addClass("size-bar-right");
    this.applyFontStyles();
    this.statusBarEl.appendChild(this.leftSlot);
    this.statusBarEl.appendChild(this.rightSlot);
    container.appendChild(this.statusBarEl);
    const filesContainer = container.querySelector(".nav-files-container");
    if (filesContainer) {
      filesContainer.style.paddingBottom = "30px";
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
    this.registerEvent(this.app.vault.on("modify", () => this.updateBar()));
    this.registerEvent(this.app.vault.on("create", () => this.updateBar()));
    this.registerEvent(this.app.vault.on("delete", () => this.updateBar()));
    this.registerDomEvent(document, "click", (evt) => {
      const target = evt.target;
      const navItem = target.closest(".nav-file-title, .nav-folder-title");
      if (navItem) {
        const fileExplorer = this.app.workspace.getLeavesOfType("file-explorer")[0]?.view;
        if (!fileExplorer || !fileExplorer.fileItems) return;
        for (const [path, item] of Object.entries(fileExplorer.fileItems)) {
          if (item.titleEl === navItem || item.el === navItem.parentElement) {
            this.lastClickedPath = path;
            this.updateBar();
            break;
          }
        }
      }
    });
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => {
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
    const syncPlugin = this.app.internalPlugins?.plugins?.["sync"];
    if (syncPlugin && syncPlugin.enabled) {
      const syncInstance = syncPlugin.instance;
      let limitBytes = null;
      if (syncInstance?.api?.limit) limitBytes = syncInstance.api.limit;
      const userPlan = syncInstance?.api?.user?.plan;
      if (userPlan) {
        if (userPlan.toLowerCase().includes("standard") || userPlan.toLowerCase().includes("basic")) {
          limitBytes = 1 * 1024 * 1024 * 1024;
        } else if (userPlan.toLowerCase().includes("plus")) {
          limitBytes = 10 * 1024 * 1024 * 1024;
        } else if (userPlan.toLowerCase().includes("pro")) {
          limitBytes = 50 * 1024 * 1024 * 1024;
        }
      }
      if (!limitBytes) {
        if (syncInstance?.api?.getLimit) {
          limitBytes = typeof syncInstance.api.getLimit === "function" ? await syncInstance.api.getLimit() : syncInstance.api.getLimit;
        } else if (syncInstance?.config?.maxVaultSize) {
          limitBytes = syncInstance.config.maxVaultSize;
        }
      }
      if (!limitBytes) limitBytes = 1 * 1024 * 1024 * 1024;
      rightText += ` / ${this.formatBytes(limitBytes)}`;
    }
    this.rightSlot.innerHTML = `${rightText}&nbsp;`;
  }
  calculateItemSize(item) {
    if (item instanceof import_obsidian4.TFile) {
      return item.stat.size;
    } else if (item instanceof import_obsidian4.TFolder) {
      let total = 0;
      this.getFolderSizeRecursively(item, (file) => {
        total += file.stat.size;
      });
      return total;
    }
    return 0;
  }
  getFolderSizeRecursively(folder, callback) {
    if (!folder.children) return;
    for (const child of folder.children) {
      if (child instanceof import_obsidian4.TFile) {
        callback(child);
      } else if (child instanceof import_obsidian4.TFolder) {
        this.getFolderSizeRecursively(child, callback);
      }
    }
  }
  async calculateVaultTotalSize() {
    let total = 0;
    const files = this.app.vault.getFiles();
    for (const file of files) {
      total += file.stat.size;
    }
    return total;
  }
  formatBytes(bytes) {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  }
  renderSettings(containerEl) {
    new import_obsidian4.Setting(containerEl).setName("Font Size (px)").setDesc("Adjust the text scale inside the file explorer size bar zone.").addSlider((slider) => {
      slider.setLimits(7, 16, 0.5).setValue(this.settings.fontSize).setDynamicTooltip();
      slider.sliderEl.addEventListener("input", (e) => {
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
};

// src/modules.ts
var autoModules = {
  "cryptomator-keep-alive": { classRef: CryptomatorKeepAliveModule, defaults: CRYPTOMATOR_KEEP_ALIVE_DEFAULTS },
  "font-colors": { classRef: FontColorsModule, defaults: FONT_COLORS_DEFAULTS },
  "notion-like-icons": { classRef: NotionIconsModule, defaults: NOTION_ICONS_DEFAULTS },
  "vault-size-bar": { classRef: VaultSizeBarModule, defaults: VAULT_SIZE_BAR_DEFAULTS }
};

// src/main.ts
var DEFAULT_SETTINGS = {
  enabledModules: {},
  expandedSettings: {},
  modulesData: {}
};
var MasterOrchestratorPlugin = class extends import_obsidian5.Plugin {
  activeInstances = {};
  async onload() {
    await this.loadSettings();
    this.addSettingTab(new OrchestratorSettingTab(this.app, this));
    Object.keys(autoModules).forEach((id) => {
      if (this.settings.enabledModules[id]) {
        this.startModule(id);
      }
    });
  }
  startModule(id) {
    if (this.activeInstances[id]) return;
    const moduleMeta = autoModules[id];
    if (!moduleMeta) return;
    const instance = new moduleMeta.classRef(this.app, this.manifest, this, id);
    this.addChild(instance);
    this.activeInstances[id] = instance;
  }
  stopModule(id) {
    const instance = this.activeInstances[id];
    if (instance) {
      this.removeChild(instance);
      delete this.activeInstances[id];
    }
  }
  async loadSettings() {
    const loadedData = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, loadedData);
    this.settings.enabledModules = Object.assign({}, DEFAULT_SETTINGS.enabledModules, loadedData?.enabledModules);
    this.settings.expandedSettings = Object.assign({}, DEFAULT_SETTINGS.expandedSettings, loadedData?.expandedSettings);
    this.settings.modulesData = Object.assign({}, DEFAULT_SETTINGS.modulesData, loadedData?.modulesData);
    Object.keys(autoModules).forEach((id) => {
      const moduleMeta = autoModules[id];
      this.settings.modulesData[id] = Object.assign({}, moduleMeta.defaults, this.settings.modulesData[id]);
    });
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
  refreshSettingsUi() {
    const settingTab = this.app.setting?.settingTabs?.find((tab) => tab instanceof OrchestratorSettingTab);
    if (settingTab) settingTab.display();
  }
  onunload() {
    Object.keys(this.activeInstances).forEach((id) => this.stopModule(id));
  }
};
var OrchestratorSettingTab = class extends import_obsidian5.PluginSettingTab {
  plugin;
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Plugin Sandbox Orchestrator" });
    Object.keys(autoModules).forEach((id) => {
      const isModuleEnabled = this.plugin.settings.enabledModules[id] || false;
      const displayTitle = id.replace(/([A-Z])/g, " $1").replace(/^./, (str) => str.toUpperCase());
      const moduleSectionEl = containerEl.createDiv();
      moduleSectionEl.style.border = "1px solid var(--background-modifier-border)";
      moduleSectionEl.style.borderRadius = "8px";
      moduleSectionEl.style.padding = "12px";
      moduleSectionEl.style.marginBottom = "12px";
      moduleSectionEl.style.backgroundColor = "var(--background-primary-alt)";
      const mainRowSetting = new import_obsidian5.Setting(moduleSectionEl).setName(displayTitle).setDesc(`Workspace component feature extension module [${id}].`).addToggle((toggle) => toggle.setValue(isModuleEnabled).onChange(async (value) => {
        this.plugin.settings.enabledModules[id] = value;
        await this.plugin.saveSettings();
        if (value) {
          this.plugin.startModule(id);
        } else {
          this.plugin.stopModule(id);
          this.plugin.settings.expandedSettings[id] = false;
        }
        this.display();
      }));
      mainRowSetting.settingEl.style.borderTop = "none";
      mainRowSetting.settingEl.style.padding = "0";
      const activeInstance = this.plugin.activeInstances[id];
      if (isModuleEnabled && activeInstance && typeof activeInstance.renderSettings === "function") {
        const showSettingsActive = this.plugin.settings.expandedSettings[id] || false;
        const controlEl = mainRowSetting.settingEl.querySelector(".setting-item-control");
        if (controlEl) {
          const textLabel = document.createElement("span");
          textLabel.innerText = "Options";
          textLabel.style.fontSize = "0.75em";
          textLabel.style.color = "var(--text-muted)";
          textLabel.style.marginRight = "6px";
          textLabel.style.marginLeft = "12px";
          const subToggleEl = document.createElement("input");
          subToggleEl.type = "checkbox";
          subToggleEl.checked = showSettingsActive;
          subToggleEl.className = "task-list-item-checkbox";
          subToggleEl.style.cursor = "pointer";
          subToggleEl.style.transform = "scale(0.9)";
          subToggleEl.addEventListener("change", async (e) => {
            this.plugin.settings.expandedSettings[id] = e.target.checked;
            await this.plugin.saveSettings();
            this.display();
          });
          controlEl.insertBefore(subToggleEl, controlEl.firstChild);
          controlEl.insertBefore(textLabel, controlEl.firstChild);
        }
        if (showSettingsActive) {
          const subSettingsContainer = moduleSectionEl.createDiv({ cls: "orchestrator-sub-settings" });
          subSettingsContainer.style.fontSize = "85%";
          subSettingsContainer.style.marginTop = "10px";
          subSettingsContainer.style.padding = "8px 12px";
          subSettingsContainer.style.borderTop = "1px dashed var(--background-modifier-border)";
          try {
            activeInstance.renderSettings(subSettingsContainer);
          } catch (err) {
            console.error(`UI Error [${id}]:`, err);
          }
        }
      }
    });
  }
};
