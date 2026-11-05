<!--
Source: Complete examples from obsidian-sample-plugin, obsidian-plugin-docs, and obsidian-api (API is authoritative)
Update frequency: Check reference repos for new patterns
-->

# Code Patterns

Comprehensive code patterns for common Obsidian plugin development tasks. **Always verify API details in `node_modules/obsidian/obsidian.d.ts`** - it's the authoritative source and may have features not yet documented in plugin docs.

**When to use this vs [common-tasks.md](common-tasks.md)**:
- **code-patterns.md**: Complete, production-ready examples with full context, error handling, and best practices
- **common-tasks.md**: Quick snippets and basic patterns for simple operations

## Settings tabs

This repo targets `minAppVersion` 1.11.0, so `SettingGroup` is available without version guards, but the declarative `getSettingDefinitions()` API (Obsidian 1.13+) is not. Settings tabs implement `display()` (see `src/SettingsTab.ts`). Add `getSettingDefinitions()` only together with a `minAppVersion` bump to 1.13, or keep `display()` as the required fallback. Sentence case for all UI text (names, descriptions, headings); headings via `setHeading()`.

## Modal with Form Input


```ts
import { App, Modal, Notice, Setting } from "obsidian";

interface FormData {
  name: string;
  email: string;
}

class FormModal extends Modal {
  result: FormData;
  onSubmit: (result: FormData) => void;

  constructor(app: App, onSubmit: (result: FormData) => void) {
    super(app);
    this.onSubmit = onSubmit;
    this.result = { name: "", email: "" };
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "Enter Information" });

    new Setting(contentEl)
      .setName("Name")
      .addText((text) =>
        text.onChange((value) => {
          this.result.name = value;
        })
      );

    new Setting(contentEl)
      .setName("Email")
      .addText((text) =>
        text
          .setPlaceholder("email@example.com")
          .onChange((value) => {
            this.result.email = value;
          })
      );

    new Setting(contentEl)
      .addButton((btn) =>
        btn
          .setButtonText("Submit")
          .setCta()
          .onClick(() => {
            if (!this.result.name || !this.result.email) {
              new Notice("Please fill in all fields");
              return;
            }
            this.close();
            this.onSubmit(this.result);
          })
      );
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

// Usage:
new FormModal(this.app, (result) => {
  new Notice(`Submitted: ${result.name} (${result.email})`);
}).open();
```

## SuggestModal Implementation


```ts
import { App, Notice, SuggestModal } from "obsidian";

interface Item {
  title: string;
  description: string;
}

const ALL_ITEMS: Item[] = [
  { title: "Item 1", description: "Description 1" },
  { title: "Item 2", description: "Description 2" },
];

class ItemSuggestModal extends SuggestModal<Item> {
  onChoose: (item: Item) => void;

  constructor(app: App, onChoose: (item: Item) => void) {
    super(app);
    this.onChoose = onChoose;
  }

  getSuggestions(query: string): Item[] {
    return ALL_ITEMS.filter((item) =>
      item.title.toLowerCase().includes(query.toLowerCase())
    );
  }

  renderSuggestion(item: Item, el: HTMLElement) {
    el.createEl("div", { text: item.title });
    el.createEl("small", { text: item.description });
  }

  onChooseSuggestion(item: Item, evt: MouseEvent | KeyboardEvent) {
    this.onChoose(item);
  }
}

// Usage:
new ItemSuggestModal(this.app, (item) => {
  new Notice(`Selected: ${item.title}`);
}).open();
```

## Custom View with Registration


```ts
import { ItemView, WorkspaceLeaf } from "obsidian";

export const VIEW_TYPE_MY_VIEW = "my-view";

export class MyView extends ItemView {
  private content: string;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    this.content = "Initial content";
  }

  getViewType(): string {
    return VIEW_TYPE_MY_VIEW;
  }

  getDisplayText(): string {
    return "My Custom View";
  }

  getIcon(): string {
    return "document"; // Icon name
  }

  async onOpen() {
    const container = this.contentEl;
    container.empty();
    
    container.createEl("h2", { text: "My View" });
    
    const contentEl = container.createEl("div", { cls: "my-view-content" });
    contentEl.setText(this.content);
    
    // Add interactive elements
    const button = container.createEl("button", { text: "Update" });
    button.addEventListener("click", () => {
      this.updateContent();
    });
  }

  async onClose() {
    // Clean up resources
  }

  private updateContent() {
    const contentEl = this.contentEl.querySelector(".my-view-content");
    if (contentEl) {
      this.content = "Updated content";
      contentEl.setText(this.content);
    }
  }
}

// In main plugin class:
export default class MyPlugin extends Plugin {
  async onload() {
    // Register view
    this.registerView(VIEW_TYPE_MY_VIEW, (leaf) => new MyView(leaf));

    // Add command to open view
    this.addCommand({
      id: "open-my-view",
      name: "Open My View",
      callback: () => {
        this.activateView();
      },
    });
  }

  async activateView() {
    const { workspace } = this.app;

    let leaf = workspace.getLeavesOfType(VIEW_TYPE_MY_VIEW)[0];

    if (!leaf) {
      const rightLeaf = workspace.getRightLeaf(false);
      if (!rightLeaf) return;
      await rightLeaf.setViewState({ type: VIEW_TYPE_MY_VIEW, active: true });
      leaf = rightLeaf;
    }

    await workspace.revealLeaf(leaf);
  }

  // No onunload detach: open leaves reinitialize in place after a plugin update.
}
```

## File Operations


```ts
// Read a file
async readFile(file: TFile): Promise<string> {
  return await this.app.vault.read(file);
}

// Write to a file
async writeFile(file: TFile, content: string): Promise<void> {
  await this.app.vault.modify(file, content);
}

// Create a new file
async createFile(path: string, content: string): Promise<TFile> {
  return await this.app.vault.create(path, content);
}

// Delete a file (respects user's trash preference)
async deleteFile(file: TFile): Promise<void> {
  await this.app.fileManager.trashFile(file);
}

// Check if file exists
fileExists(path: string): boolean {
  return this.app.vault.getAbstractFileByPath(path) !== null;
}

// Get all markdown files
getAllMarkdownFiles(): TFile[] {
  return this.app.vault.getMarkdownFiles();
}
```

## Workspace Events


```ts
// File opened event
this.registerEvent(
  this.app.workspace.on("file-open", (file) => {
    if (file) {
      console.log("File opened:", file.path);
    }
  })
);

// Active leaf changed
this.registerEvent(
  this.app.workspace.on("active-leaf-change", (leaf) => {
    if (leaf?.view instanceof MarkdownView) {
      console.log("Active markdown view:", leaf.view.file?.path);
    }
  })
);

// Layout changed
this.registerEvent(
  this.app.workspace.on("layout-change", () => {
    console.log("Workspace layout changed");
  })
);

// Editor change (in markdown view)
this.registerEvent(
  this.app.workspace.on("editor-change", (editor, info) => {
    console.log("Editor changed:", info);
  })
);
```

## Status Bar with Updates


```ts
export default class MyPlugin extends Plugin {
  private statusBarItem: HTMLElement;

  async onload() {
    // Create status bar item
    this.statusBarItem = this.addStatusBarItem();
    this.updateStatusBar("Ready");

    // Update status bar periodically
    this.registerInterval(
      window.setInterval(() => {
        this.updateStatusBar(`Time: ${new Date().toLocaleTimeString()}`);
      }, 1000)
    );

    // Update on file open
    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        if (file) {
          this.updateStatusBar(`Open: ${file.name}`);
        }
      })
    );
  }

  private updateStatusBar(text: string) {
    this.statusBarItem.empty();
    this.statusBarItem.createEl("span", { text });
  }
}
```

## Editor Interactions


```ts
// Get active editor
getActiveEditor(): Editor | null {
  const view = this.app.workspace.getActiveViewOfType(MarkdownView);
  return view?.editor ?? null;
}

// Get selected text
getSelection(): string {
  const editor = this.getActiveEditor();
  return editor?.getSelection() ?? "";
}

// Replace selection
replaceSelection(text: string) {
  const editor = this.getActiveEditor();
  if (editor) {
    editor.replaceSelection(text);
  }
}

// Insert at cursor
insertAtCursor(text: string) {
  const editor = this.getActiveEditor();
  if (editor) {
    const cursor = editor.getCursor();
    editor.replaceRange(text, cursor);
  }
}

// Get current line
getCurrentLine(): string {
  const editor = this.getActiveEditor();
  if (editor) {
    const line = editor.getCursor().line;
    return editor.getLine(line);
  }
  return "";
}
```

