# Modelica Graphical Preview

在 Visual Studio Code 中打开 **Modelica（`.mo`）** 文件时，根据源码里的 **`annotation`**（如 `Placement`、`connect` 的 `Line`、类级别的 `Diagram` / `Icon` 等）渲染**示意图预览**，便于对照图形与文本。

**仓库：** [github.com/Thirra-Fang/modelica-preview](https://github.com/Thirra-Fang/modelica-preview)

## 功能

- **图形预览**：解析组件 `Placement(transformation(...))`、`connect(...)` 上的 `Line(...)`，以及类注解中的 `Diagram` / `Icon` 等图形元素，在 WebView 中绘制。
- **实时刷新**：预览打开时，对当前 `.mo` 的编辑会在短暂防抖后自动更新；保存文件也会刷新。
- **切换文件**：在保持预览面板打开的情况下，切换到另一个 `.mo` 编辑器会自动切换预览内容。
- **跳转到源码**：在预览中**点击组件**，可跳转到该组件在 `.mo` 中的声明行。

## 要求

- **VS Code** ≥ 1.85（与 `package.json` 中 `engines.vscode` 一致）

## 使用方式

1. 在 VS Code 中打开任意 **`.mo`** 文件。
2. 任选一种方式打开预览：
   - 点击编辑器标题栏右侧的 **预览** 图标（仅当当前文件为 `.mo` 时显示）；
   - 或打开命令面板（`Ctrl+Shift+P` / `Cmd+Shift+P`），执行 **`Modelica: Show Diagram Preview`**。

预览默认在侧边栏打开；可像普通编辑器标签一样移动或关闭。

## 从 VSIX 安装

若已打包得到 `modelica-preview-*.vsix`：

1. 在 VS Code 中选择 **扩展** → 右上角 `⋯` → **从 VSIX 安装…**
2. 选中该 `.vsix` 文件并安装。

（若将来发布到 Marketplace / Open VSX，也可从扩展市场直接安装。）

## 开发与打包

```bash
npm install
npm run compile    # 构建到 out/
npm run watch      # 监听修改并持续构建
npm run package    # 生产构建并执行 vsce package，生成 .vsix
```

使用 **F5**（“Run Extension”）可在 Extension Development Host 中调试本扩展。

## 示例

仓库内 **`examples/`** 目录包含若干 `.mo` 示例（如简单电路、图形原语等），可直接打开并执行上述预览命令查看效果。

## 已知限制

- 预览基于对**当前文件**文本的解析，复杂语法、非标准写法或工具生成的代码可能无法完全识别。
- 主要面向带有 **Modelica 图形注解** 的模型；不包含完整 Modelica 语义仿真，仅作**示意图**参考。

## 许可证

本项目以 [MIT License](LICENSE) 发布。

## 问题反馈

欢迎在 [Issues](https://github.com/Thirra-Fang/modelica-preview/issues) 提交缺陷或建议。

---

# English

When you open **Modelica (`.mo`)** files in Visual Studio Code, this extension renders a **diagram-style preview** from **`annotation`** data in the source—such as `Placement`, `Line` on `connect` statements, and class-level `Diagram` / `Icon` annotations—so you can compare the drawing with the text.

**Repository:** [github.com/Thirra-Fang/modelica-preview](https://github.com/Thirra-Fang/modelica-preview)

## Features

- **Diagram preview**: Parses `Placement(transformation(...))`, `Line(...)` on `connect(...)`, and `Diagram` / `Icon` graphics in class annotations, and draws them in a WebView.
- **Live updates**: While the preview is open, edits to the current `.mo` are refreshed after a short debounce; saving the file also refreshes.
- **Switching files**: With the preview panel open, switching to another `.mo` editor updates the preview to match.
- **Jump to source**: **Click a component** in the preview to go to its declaration line in the `.mo` file.

## Requirements

- **VS Code** ≥ 1.85 (same as `engines.vscode` in `package.json`)

## Usage

1. Open any **`.mo`** file in VS Code.
2. Open the preview in either way:
   - Click the **preview** icon in the editor title bar (shown only for `.mo` files); or
   - Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and run **`Modelica: Show Diagram Preview`**.

The preview opens beside the editor by default; you can move or close it like a normal tab.

## Install from VSIX

If you have a `modelica-preview-*.vsix` package:

1. In VS Code: **Extensions** → `⋯` in the top-right → **Install from VSIX…**
2. Select the `.vsix` file and install.

(If the extension is published to the Marketplace or Open VSX, you can install it from there instead.)

## Development and packaging

```bash
npm install
npm run compile    # build to out/
npm run watch      # watch and rebuild
npm run package    # production build + vsce package → .vsix
```

Press **F5** (“Run Extension”) to debug in an Extension Development Host.

## Examples

The **`examples/`** folder contains sample `.mo` files (e.g. simple circuits, graphics primitives). Open them and run the preview command above.

## Limitations

- The preview is driven by parsing the **current file**; unusual syntax, generated code, or complex constructs may not be fully recognized.
- The focus is **Modelica graphical annotations**; there is no full semantic simulation—only a **diagram** for reference.

## License

This project is released under the [MIT License](LICENSE).

## Feedback

Please report bugs or suggestions in [Issues](https://github.com/Thirra-Fang/modelica-preview/issues).
