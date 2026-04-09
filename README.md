# Modelica Graphical Preview

>AI真是强啊……想要一个东西就直接搓出来了。但是感觉要在vscode上复现openModelica的功能感觉还是有点路漫漫啊（）要是有大佬能做一下就好了#许愿

在 Visual Studio Code 中打开 **Modelica（`.mo`）** 文件时，根据源码里的 **`annotation`**（如 `Placement`、`connect` 的 `Line`、类级别的 `Diagram` / `Icon` 等）渲染**示意图预览**，便于对照图形与文本。

**扩展市场：**

- [Visual Studio Marketplace — Modelica Graphical Preview](https://marketplace.visualstudio.com/items?itemName=ThirraFang.modelica-preview)（官方 **Visual Studio Code** 默认市场）
- [Open VSX — Modelica Graphical Preview](https://open-vsx.org/extension/ThirraFang/modelica-preview)（**Cursor**、**VSCodium** 等常用）

**仓库：** [github.com/Thirra-Fang/modelica-preview](https://github.com/Thirra-Fang/modelica-preview)

## 功能

- **图形预览**：解析组件 `Placement(transformation(...))`、`connect(...)` 上的 `Line(...)`，以及类注解中的 `Diagram` / `Icon` 等图形元素，在 WebView 中绘制。
- **工作区模型 Icon 替换**：若组件类型在工作区内可解析到对应 `.mo` 模型，则在父模型预览中优先使用该模型的 `Icon` 图形替换组件占位框（同目录/同包最近优先）。
- **实时刷新**：预览打开时，对当前 `.mo` 的编辑会在短暂防抖后自动更新；保存文件也会刷新。
- **切换文件**：在保持预览面板打开的情况下，切换到另一个 `.mo` 编辑器会自动切换预览内容。
- **跳转到源码**：在预览中**点击组件**，可跳转到该组件在 `.mo` 中的声明行。

## 要求

- **VS Code** ≥ 1.85（与 `package.json` 中 `engines.vscode` 一致）

## 安装

### 从扩展市场安装（推荐）

1. 在 VS Code 中打开 **扩展** 视图（`Ctrl+Shift+X` / `Cmd+Shift+X`）。
2. 搜索 **Modelica Graphical Preview** 或 **modelica-preview**，选择发布者 **ThirraFang** 的条目，点击 **安装**。

也可在浏览器中打开 [Visual Studio Marketplace 页面](https://marketplace.visualstudio.com/items?itemName=ThirraFang.modelica-preview) 或 [Open VSX 页面](https://open-vsx.org/extension/ThirraFang/modelica-preview)，按页面提示在对应编辑器中安装。

### 从 VSIX 安装

若已打包得到 `artifacts/vsix/modelica-preview-*.vsix`（例如自行构建或离线分发）：

1. 在 VS Code 中选择 **扩展** → 右上角 `⋯` → **从 VSIX 安装…**
2. 选中该 `.vsix` 文件并安装。

## 使用方式

1. 在 VS Code 中打开任意 **`.mo`** 文件（或语言模式为 **Modelica** 的编辑器）。
2. 任选一种方式打开预览：
   - 点击编辑器标题栏右侧的 **打开预览** 图标（与内置 Markdown 预览同类图标；空间不足时可能被收进 **`⋯`** 溢出菜单）；
   - 或当 `.mo` / Modelica 为当前活动编辑器时，点击窗口底部状态栏右侧的 **`Modelica Preview`**（带预览图标，一般始终可见）；
   - 或使用快捷键：**`Ctrl+Alt+M`**（Windows / Linux）或 **`Cmd+Alt+M`**（macOS），需在编辑器内聚焦且当前为 `.mo` / Modelica；
   - 或打开命令面板（`Ctrl+Shift+P` / `Cmd+Shift+P`），执行 **`Modelica: Show Diagram Preview`**。

预览默认在侧边栏打开；可像普通编辑器标签一样移动或关闭。

若希望“点击新 `.mo` 文件时，不在预览分栏里打开文本代码”，可将预览所在分栏设为 **Lock Group（锁定分栏）**：在该分栏右上角菜单中启用锁定后，新打开的 `.mo` 会在其他分栏以文本模式打开，而此分栏会继续保留并显示 Modelica Preview（并随当前活动 `.mo` 自动切换内容）。

**提示：** 标题栏能摆下的按钮数量受窗口宽度、主题以及已安装扩展影响；若预览图标总进 **`⋯`**，可优先用状态栏或快捷键。也可在设置中搜索 **Editor Actions Position**（`workbench.editor.editorActionsLocation`）调整编辑器操作按钮的位置，观察哪种布局下更容易看到标题栏图标。

## 开发与打包

```bash
npm install
npm run compile    # 构建到 out/
npm run watch      # 监听修改并持续构建
npm run package    # 生产构建并执行 vsce package，输出到 artifacts/vsix/
```

使用 **F5**（“Run Extension”）可在 Extension Development Host 中调试本扩展。

**技术文档：** 面向开发者与后续维护者，说明架构、数据流、模块职责及按功能定位源码的速查表，见 [docs/TECHNICAL.md](docs/TECHNICAL.md)。

## 示例

仓库内 **`examples/`** 目录包含若干 `.mo` 示例（如简单电路、图形原语等），可直接打开并执行上述预览命令查看效果。

## 已知限制

- 预览基于对**当前文件**文本的解析，复杂语法、非标准写法或工具生成的代码可能无法完全识别。
- 工作区引用解析目前仅覆盖**组件声明引用**（如 `B b1`），尚未覆盖 `extends` 合并与 `import`/别名解析。
- 主要面向带有 **Modelica 图形注解** 的模型；不包含完整 Modelica 语义仿真，仅作**示意图**参考。

## 许可证

本项目以 [MIT License](LICENSE) 发布。

## 问题反馈

欢迎在 [Issues](https://github.com/Thirra-Fang/modelica-preview/issues) 提交缺陷或建议。

---

# English

>AI really is amazing… You just want something and it conjures it up straight away. But I reckon it’s still a long way off before we can replicate the openModelica functionality in VS Code () It’d be great if someone in the know could give it a go #wishlist

When you open **Modelica (`.mo`)** files in Visual Studio Code, this extension renders a **diagram-style preview** from **`annotation`** data in the source—such as `Placement`, `Line` on `connect` statements, and class-level `Diagram` / `Icon` annotations—so you can compare the drawing with the text.

**Marketplaces:**

- [Visual Studio Marketplace — Modelica Graphical Preview](https://marketplace.visualstudio.com/items?itemName=ThirraFang.modelica-preview) (default for official **Visual Studio Code**)
- [Open VSX — Modelica Graphical Preview](https://open-vsx.org/extension/ThirraFang/modelica-preview) (common for **Cursor**, **VSCodium**, and similar)

**Repository:** [github.com/Thirra-Fang/modelica-preview](https://github.com/Thirra-Fang/modelica-preview)

## Features

- **Diagram preview**: Parses `Placement(transformation(...))`, `Line(...)` on `connect(...)`, and `Diagram` / `Icon` graphics in class annotations, and draws them in a WebView.
- **Workspace model Icon substitution**: When a component type resolves to another `.mo` model in the workspace, the parent preview prefers that model's `Icon` graphics over the default placeholder box (nearest same-folder/package match first).
- **Live updates**: While the preview is open, edits to the current `.mo` are refreshed after a short debounce; saving the file also refreshes.
- **Switching files**: With the preview panel open, switching to another `.mo` editor updates the preview to match.
- **Jump to source**: **Click a component** in the preview to go to its declaration line in the `.mo` file.

## Requirements

- **VS Code** ≥ 1.85 (same as `engines.vscode` in `package.json`)

## Installation

### From the Marketplace (recommended)

1. Open the **Extensions** view in VS Code (`Ctrl+Shift+X` / `Cmd+Shift+X`).
2. Search for **Modelica Graphical Preview** or **modelica-preview**, choose the listing published by **ThirraFang**, and click **Install**.

You can also open the [Visual Studio Marketplace page](https://marketplace.visualstudio.com/items?itemName=ThirraFang.modelica-preview) or the [Open VSX page](https://open-vsx.org/extension/ThirraFang/modelica-preview) in a browser and follow the install flow for your editor.

### Install from VSIX

If you have an `artifacts/vsix/modelica-preview-*.vsix` file (e.g. from a local build or offline distribution):

1. In VS Code: **Extensions** → `⋯` in the top-right → **Install from VSIX…**
2. Select the `.vsix` file and install.

## Usage

1. Open any **`.mo`** file in VS Code (or an editor whose language mode is **Modelica**).
2. Open the preview in any of these ways:
   - Click the **Open Preview** icon on the right side of the editor title bar (same family of icon as the built-in Markdown preview; when space is tight it may move into the **`⋯`** overflow menu);
   - When a `.mo` / Modelica file is the active editor, click **`Modelica Preview`** on the right side of the status bar (with a preview icon—usually always visible);
   - Use the keyboard shortcut: **`Ctrl+Alt+M`** (Windows / Linux) or **`Cmd+Alt+M`** (macOS), while focus is in the editor and the file is `.mo` / Modelica;
   - Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and run **`Modelica: Show Diagram Preview`**.

The preview opens beside the editor by default; you can move or close it like a normal tab.

If you want to avoid opening source text inside the preview column when clicking another `.mo` file, set the preview column to **Lock Group** (from the group menu in the top-right corner). With the group locked, newly opened `.mo` files go to another editor group in text mode, while this group keeps showing Modelica Preview and continues following the active `.mo` file.

**Tip:** How many actions fit in the title bar depends on window width, theme, and other extensions. If the preview icon keeps landing under **`⋯`**, prefer the status bar or shortcut. You can also search settings for **Editor Actions Position** (`workbench.editor.editorActionsLocation`) and try different placements to see which layout surfaces title-bar actions more often.

## Development and packaging

```bash
npm install
npm run compile    # build to out/
npm run watch      # watch and rebuild
npm run package    # production build + vsce package → artifacts/vsix/
```

Press **F5** (“Run Extension”) to debug in an Extension Development Host.

**Technical documentation:** For developers and maintainers—architecture, data flow, module responsibilities, and a feature-to-file lookup—see [docs/TECHNICAL.md](docs/TECHNICAL.md).

## Examples

The **`examples/`** folder contains sample `.mo` files (e.g. simple circuits, graphics primitives). Open them and run the preview command above.

## Limitations

- The preview is driven by parsing the **current file**; unusual syntax, generated code, or complex constructs may not be fully recognized.
- Workspace reference resolution currently covers **component declarations only** (e.g. `B b1`), and does not yet include `extends`-merged graphics or `import` alias resolution.
- The focus is **Modelica graphical annotations**; there is no full semantic simulation—only a **diagram** for reference.

## License

This project is released under the [MIT License](LICENSE).

## Feedback

Please report bugs or suggestions in [Issues](https://github.com/Thirra-Fang/modelica-preview/issues).
