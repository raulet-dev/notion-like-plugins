// Auto-generated module exports
import { CryptomatorKeepAliveModule, CRYPTOMATOR_KEEP_ALIVE_DEFAULTS } from './modules/cryptomator-keep-alive';
import { FontColorsModule, FONT_COLORS_DEFAULTS } from './modules/font-colors';
import { NotionIconsModule, NOTION_ICONS_DEFAULTS } from './modules/notion-like-icons';
import { VaultSizeBarModule, VAULT_SIZE_BAR_DEFAULTS } from './modules/vault-size-bar';
import { BasesKanbanModule, BASES_KANBAN_DEFAULTS } from './modules/bases-kanban';

interface ModuleMetadata {
    classRef: any;
    defaults: any;
}

export const autoModules: Record<string, ModuleMetadata> = {
    'cryptomator-keep-alive': { classRef: CryptomatorKeepAliveModule, defaults: CRYPTOMATOR_KEEP_ALIVE_DEFAULTS },
    'font-colors': { classRef: FontColorsModule, defaults: FONT_COLORS_DEFAULTS },
    'notion-like-icons': { classRef: NotionIconsModule, defaults: NOTION_ICONS_DEFAULTS },
    'vault-size-bar': { classRef: VaultSizeBarModule, defaults: VAULT_SIZE_BAR_DEFAULTS },
    'bases-kanban': { classRef: BasesKanbanModule, defaults: BASES_KANBAN_DEFAULTS }
};
