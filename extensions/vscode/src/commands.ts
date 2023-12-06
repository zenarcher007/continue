import * as vscode from "vscode";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";

import { acceptDiffCommand, rejectDiffCommand } from "./diffs";
import { debugPanelWebview, getSidebarContent } from "./debugPanel";
import { ideProtocolClient } from "./activation/activate";

function addHighlightedCodeToContext(edit: boolean) {
  const editor = vscode.window.activeTextEditor;
  if (editor) {
    const selection = editor.selection;
    if (selection.isEmpty) return;
    const range = new vscode.Range(selection.start, selection.end);
    const contents = editor.document.getText(range);
    const rangeInFileWithContents = {
      filepath: editor.document.uri.fsPath,
      contents,
      range: {
        start: {
          line: selection.start.line,
          character: selection.start.character,
        },
        end: {
          line: selection.end.line,
          character: selection.end.character,
        },
      },
    };

    debugPanelWebview?.postMessage({
      type: "highlightedCode",
      rangeInFileWithContents,
      edit,
    });
  }
}

async function addEntireFileToContext(filepath: vscode.Uri, edit: boolean) {
  // If a directory, add all files in the directory
  const stat = await vscode.workspace.fs.stat(filepath);
  if (stat.type === vscode.FileType.Directory) {
    const files = await vscode.workspace.fs.readDirectory(filepath);
    for (const [filename, type] of files) {
      if (type === vscode.FileType.File) {
        addEntireFileToContext(vscode.Uri.joinPath(filepath, filename), edit);
      }
    }
    return;
  }

  // Get the contents of the file
  const contents = (await vscode.workspace.fs.readFile(filepath)).toString();
  const rangeInFileWithContents = {
    filepath: filepath.fsPath,
    contents: contents,
    range: {
      start: {
        line: 0,
        character: 0,
      },
      end: {
        line: contents.split(os.EOL).length - 1,
        character: 0,
      },
    },
  };

  debugPanelWebview?.postMessage({
    type: "highlightedCode",
    rangeInFileWithContents,
    edit,
  });
}

// Copy everything over from extension.ts
const commandsMap: { [command: string]: (...args: any) => any } = {
  "continue.acceptDiff": (...args) => {
    if (inlineEditManager.count() > 0) {
      // inlineEditManager.enter();
    } else {
      acceptDiffCommand(...args);
    }
  },
  "continue.rejectDiff": rejectDiffCommand,
  "continue.quickFix": async (message: string, code: string, edit: boolean) => {
    ideProtocolClient.sendMainUserInput(
      `${
        edit ? "/edit " : ""
      }${code}\n\nHow do I fix this problem in the above code?: ${message}`
    );
    if (!edit) {
      vscode.commands.executeCommand("continue.continueGUIView.focus");
    }
  },
  "continue.focusContinueInput": async () => {
    vscode.commands.executeCommand("continue.continueGUIView.focus");
    debugPanelWebview?.postMessage({
      type: "focusContinueInput",
    });
    addHighlightedCodeToContext(false);
  },
  "continue.focusContinueInputWithEdit": async () => {
    vscode.commands.executeCommand("continue.continueGUIView.focus");
    addHighlightedCodeToContext(true);
    debugPanelWebview?.postMessage({
      type: "focusContinueInputWithEdit",
    });
  },
  "continue.toggleAuxiliaryBar": () => {
    vscode.commands.executeCommand("workbench.action.toggleAuxiliaryBar");
  },
  "continue.quickTextEntry": async () => {
    addHighlightedCodeToContext(true);
    const text = await vscode.window.showInputBox({
      placeHolder: "Ask a question or enter a slash command",
      title: "Continue Quick Input",
    });
    if (text) {
      debugPanelWebview?.postMessage({
        type: "userInput",
        input: text,
      });
      if (!text.startsWith("/edit")) {
        vscode.commands.executeCommand("continue.continueGUIView.focus");
      }
    }
  },
  "continue.viewLogs": async () => {
    // Open ~/.continue/continue.log
    const logFile = path.join(os.homedir(), ".continue", "continue.log");
    // Make sure the file/directory exist
    if (!fs.existsSync(logFile)) {
      fs.mkdirSync(path.dirname(logFile), { recursive: true });
      fs.writeFileSync(logFile, "");
    }

    const uri = vscode.Uri.file(logFile);
    await vscode.window.showTextDocument(uri);
  },
  "continue.debugTerminal": async () => {
    vscode.commands.executeCommand("continue.continueGUIView.focus");
    await ideProtocolClient.debugTerminal();
  },
  "continue.hideInlineTip": () => {
    vscode.workspace
      .getConfiguration("continue")
      .update("showInlineTip", false, vscode.ConfigurationTarget.Global);
  },

  // Commands without keyboard shortcuts
  "continue.addModel": () => {
    vscode.commands.executeCommand("continue.continueGUIView.focus");
    debugPanelWebview?.postMessage({
      type: "addModel",
    });
  },
  "continue.openSettingsUI": () => {
    vscode.commands.executeCommand("continue.continueGUIView.focus");
    debugPanelWebview?.postMessage({
      type: "openSettings",
    });
  },
  "continue.sendMainUserInput": (text: string) => {
    ideProtocolClient.sendMainUserInput(text);
  },
  "continue.shareSession": () => {
    ideProtocolClient.sendMainUserInput("/share");
  },
  "continue.selectRange": (startLine: number, endLine: number) => {
    if (!vscode.window.activeTextEditor) {
      return;
    }
    vscode.window.activeTextEditor.selection = new vscode.Selection(
      startLine,
      0,
      endLine,
      0
    );
  },
  "continue.foldAndUnfold": (
    foldSelectionLines: number[],
    unfoldSelectionLines: number[]
  ) => {
    vscode.commands.executeCommand("editor.unfold", {
      selectionLines: unfoldSelectionLines,
    });
    vscode.commands.executeCommand("editor.fold", {
      selectionLines: foldSelectionLines,
    });
  },
  "continue.sendToTerminal": (text: string) => {
    ideProtocolClient.runCommand(text);
  },
  "continue.toggleFullScreen": () => {
    // Check if full screen is already open by checking open tabs
    const tabs = vscode.window.tabGroups.all.flatMap(
      (tabGroup) => tabGroup.tabs
    );

    const fullScreenTab = tabs.find(
      (tab) => (tab.input as any).viewType?.endsWith("continue.continueGUIView")
    );

    // Check if the active editor is the Continue GUI View
    if (fullScreenTab && fullScreenTab.isActive) {
      vscode.commands.executeCommand("workbench.action.closeActiveEditor");
      vscode.commands.executeCommand("continue.focusContinueInput");
      return;
    }

    if (fullScreenTab) {
      // Focus the tab
      const openOptions = {
        preserveFocus: true,
        preview: fullScreenTab.isPreview,
        viewColumn: fullScreenTab.group.viewColumn,
      };

      vscode.commands.executeCommand(
        "vscode.open",
        (fullScreenTab.input as any).uri,
        openOptions
      );
      return;
    }

    // Close the sidebars
    // vscode.commands.executeCommand("workbench.action.closeSidebar");
    vscode.commands.executeCommand("workbench.action.closeAuxiliaryBar");
    // vscode.commands.executeCommand("workbench.action.toggleZenMode");
    const panel = vscode.window.createWebviewPanel(
      "continue.continueGUIView",
      "Continue",
      vscode.ViewColumn.One
    );
    panel.webview.html = getSidebarContent(panel, undefined, undefined, true);
  },
  "continue.selectFilesAsContext": (
    firstUri: vscode.Uri,
    uris: vscode.Uri[]
  ) => {
    vscode.commands.executeCommand("continue.continueGUIView.focus");

    for (const uri of uris) {
      addEntireFileToContext(uri, false);
    }
  },
  "continue.updateAllReferences": (filepath: vscode.Uri) => {
    // Get the cursor position in the editor
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }
    const position = editor.selection.active;
    ideProtocolClient.sendMainUserInput(
      `/references ${filepath.fsPath} ${position.line} ${position.character}`
    );
  },
  "continue.type": async () => {
    inlineEditManager.new();
  },
  "continue.clearInlineEdit": () => {
    inlineEditManager.remove(vscode.window.activeTextEditor);
  },
};

function createSvgDecorationType(lineCount: number, focused: boolean) {
  if (lineCount > 2) {
    lineCount = 2;
  } else if (lineCount < 1) {
    lineCount = 1;
  }
  return vscode.window.createTextEditorDecorationType({
    before: {
      margin: "0 0 0 0px",
      // contentText: "",
      contentIconPath: vscode.Uri.file(
        path.join(
          __dirname,
          "..",
          "media",
          "boxes",
          `box${lineCount}${focused ? "_focus" : ""}.svg`
        )
      ),
    },
    // border: "solid 1px #888",
    // backgroundColor: "#eee2",
    // borderRadius: "2em",
    isWholeLine: true,
    color: "#ddd",
    fontWeight: "light",
  });
}

class InlineEdit extends vscode.Disposable {
  private autocompleteWasEnabled: boolean | undefined;
  public startLine: number;
  public previousFileContents: string;
  public disposables: vscode.Disposable[] = [];
  public lineCount: number;
  public focused: boolean;

  public highlightDecorationType: vscode.TextEditorDecorationType;
  public svgDecorationType: vscode.TextEditorDecorationType;
  public endLineDecorationType: vscode.TextEditorDecorationType;

  get decorationTypes() {
    return [
      this.highlightDecorationType,
      this.svgDecorationType,
      this.endLineDecorationType,
    ];
  }

  private static _setAutocompleteEnabled(
    enabled: boolean | undefined
  ): boolean | undefined {
    const config = vscode.workspace.getConfiguration("github.copilot");
    const wasEnabled = config.get<boolean>("editor.enableAutoCompletions");
    config.update(
      "editor.enableAutoCompletions",
      enabled,
      vscode.ConfigurationTarget.Global
    );
    return wasEnabled;
  }

  constructor(public editor: vscode.TextEditor) {
    super(() => {
      this.customDispose();
    });
    // Disable GH Copilot while inside the edit box
    this.autocompleteWasEnabled = InlineEdit._setAutocompleteEnabled(false);
    this.lineCount = 1;
    this.focused = true;
    this.previousFileContents = editor.document.getText();

    // Highlight the selected range with a decoration
    const originalRange = editor.selection;
    this.highlightDecorationType = vscode.window.createTextEditorDecorationType(
      {
        backgroundColor: "#eee2",
        isWholeLine: true,
      }
    );
    if (!editor.selection.isEmpty) {
      editor.setDecorations(this.highlightDecorationType, [originalRange]);
    }

    // Select as context item
    addHighlightedCodeToContext(true);

    // Add a `` and insert the cursor in the middle
    const startOfLine = new vscode.Position(editor.selection.start.line, 0);
    editor.edit((editBuilder) => {
      editBuilder.insert(startOfLine, "`\n  \n`;\n");
    });
    let position = startOfLine.translate(1, 2);
    editor.selection = new vscode.Selection(position, position);

    // Add text via a decoration
    this.svgDecorationType = createSvgDecorationType(1, true);
    editor.setDecorations(this.svgDecorationType, [
      new vscode.Range(position.translate(-1, 0), position.translate(0, 0)),
    ]);

    this.endLineDecorationType = vscode.window.createTextEditorDecorationType({
      before: {
        // contentText: "⌘ ⇧ ⏎ to edit, esc to cancel",
        margin: "0 0 4em 0",
        color: "#8888",
      },
      isWholeLine: true,
      color: "transparent",
    });
    editor.setDecorations(this.endLineDecorationType, [
      new vscode.Range(position.translate(1, 0), position.translate(1, 0)),
    ]);

    this.startLine = position.line - 1;

    // Add a listener to revert any edits made to the boundary lines
    // Timeout so the initial creation of the zone isn't counted
    setTimeout(() => {
      const editListener = vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document !== editor.document) {
          return;
        }

        for (const change of e.contentChanges) {
          // The editBuilder.replace will trigger another onDidChangeTextDocument event, so we need to filter these out
          // False positives are okay
          if (change.text === "`" || change.text === "`;") {
            continue;
          }

          // Check if the boundary line is included in the edit at all
          const start = change.range.start;
          const end = change.range.end;
          if (start.line <= this.startLine && end.line >= this.startLine) {
            // Revert the start line to its original state
            editor.edit((editBuilder) => {
              editBuilder.replace(
                new vscode.Range(this.startLine, 0, this.startLine, 1000),
                "`"
              );
            });
          }

          // TODO: Need to truly keep track of the endline and startline, because they BOTH could move (just more often a problem with the endline)
          // if (start.line <= endLine && end.line >= endLine) {
          //   // Revert the end line to its original state
          //   editor.edit((editBuilder) => {
          //     editBuilder.replace(
          //       new vscode.Range(endLine, 0, endLine, 1000),
          //       "`;"
          //     );
          //   });
          // }
        }
        const contentsOfFirstLine = editor.document.lineAt(
          this.startLine + 1
        ).text;
        if (contentsOfFirstLine === "" || contentsOfFirstLine === " ") {
          // If the space was removed from the start of the line, put it back
          editor.edit((editBuilder) => {
            editBuilder.insert(
              new vscode.Position(this.startLine + 1, 0),
              "  "
            );
          });
        }
      });

      const disposables = [editListener];
    });

    const lineCountListener = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document !== this.editor.document) {
        return;
      }

      // Add listener for when number of lines changes
      const range = this.findRange();
      const lineCount = range.end.line - range.start.line - 2;

      if (lineCount !== this.lineCount) {
        // Update the decoration
        this.updateSvgDecorationType(lineCount, true);
      }
    });

    this.disposables.push(lineCountListener);

    const cursorListener = vscode.window.onDidChangeTextEditorSelection((e) => {
      if (e.textEditor !== this.editor) {
        return;
      }

      // Add listener for when the user puts their cursor on a boundary line (and move back to middle)
      const selection = e.selections[0];
      const range = this.findRange();
      if (
        selection.active.line === range.start.line ||
        selection.active.line === range.end.line - 1
      ) {
        // Move the cursor back to the middle
        const position = range.start.translate(1, 2);
        this.editor.selection = new vscode.Selection(position, position);
      }

      // If cursor is in the margins, move it to the fake start of the line
      if (
        range.contains(selection.active) &&
        selection.isEmpty &&
        selection.active.character < 2
      ) {
        // Read the active line
        const activeLineContents = this.editor.document.lineAt(
          selection.active.line
        ).text;

        if (
          activeLineContents === "" &&
          range.start.line !== selection.active.line
        ) {
          // Deletion, remove the line and move to the above
          editor.edit((editBuilder) => {
            editBuilder.delete(
              new vscode.Range(
                selection.active.line,
                0,
                selection.active.line + 1,
                0
              )
            );
          });
          const lineAboveLength = this.editor.document.lineAt(
            selection.active.line - 1
          ).text.length;
          this.editor.selection = new vscode.Selection(
            selection.active.line - 1,
            lineAboveLength,
            selection.active.line - 1,
            lineAboveLength
          );
        } else {
          // Cursor just moved, move it to start of the line
          if (selection.active.line !== range.end.line - 1) {
            const position = selection.active.translate(
              0,
              2 - selection.active.character
            );
            this.editor.selection = new vscode.Selection(position, position);
          }
        }
      }

      // Also listen for when the box is focused / blurred
      const focused = this.findRange().contains(selection.active);
      if (focused !== this.focused) {
        this.updateSvgDecorationType(this.lineCount, focused);
      }
    });

    this.disposables.push(cursorListener);

    // Disable tab-autocomplete
    const config = vscode.workspace.getConfiguration("github.copilot");
    const enabled = config.get<string[]>("editor.enableAutoCompletions");
    config.update(
      "editor.enableAutoCompletions",
      false,
      vscode.ConfigurationTarget.Global
    );
  }

  findRange() {
    const startPos = new vscode.Position(this.startLine, 0);

    // Find the end line
    let endPos = startPos;
    while (
      endPos.line < this.editor.document.lineCount &&
      this.editor.document.lineAt(endPos.line).text !== "`;"
    ) {
      endPos = endPos.translate(1, 0);
    }
    endPos = endPos.translate(1, 0);

    return new vscode.Range(startPos, endPos);
  }

  customDispose() {
    InlineEdit._setAutocompleteEnabled(this.autocompleteWasEnabled);

    for (const decorationType of this.decorationTypes) {
      this.editor.setDecorations(decorationType, []);
      decorationType.dispose();
    }

    this.editor.setDecorations(this.highlightDecorationType, []);

    // Remove the inserted text
    this.editor.edit((editBuilder) => {
      editBuilder.delete(this.findRange());
    });

    // If the file contents are the same as original, save the file, because it's annoying to have to save it manually
    setTimeout(() => {
      const fileContents = this.editor.document.getText();
      if (fileContents === this.previousFileContents) {
        this.editor.document.save();
      }
    }, 100);

    // Dispose of the listeners
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    super.dispose();
  }

  async enter() {
    // Get the text
    const fullRange = this.findRange();
    const range = new vscode.Range(
      fullRange.start.translate(1, 0),
      fullRange.end.translate(-1, 0)
    );
    const text = this.editor.document.getText(range).trim();
    ideProtocolClient.sendMainUserInput("/edit " + text);

    this.dispose();
  }

  updateSvgDecorationType(lineCount: number, focused: boolean) {
    this.editor.setDecorations(this.svgDecorationType, []);
    const range = this.findRange();
    this.svgDecorationType = createSvgDecorationType(lineCount, focused);
    this.editor.setDecorations(this.svgDecorationType, [
      new vscode.Range(range.start, range.start.translate(lineCount, 0)),
    ]);
    this.lineCount = lineCount;
    this.focused = focused;
  }
}

// Only allow one per editor
class InlineEditManager {
  private edits: Map<vscode.TextEditor, InlineEdit> = new Map();

  new() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }

    const inlineEdit = new InlineEdit(editor);
    this.edits.set(editor, inlineEdit);
  }

  count() {
    return this.edits.size;
  }

  remove(editor?: vscode.TextEditor) {
    if (!editor) {
      return;
    }
    this.edits.get(editor)?.dispose();
    this.edits.delete(editor);
  }
}

const inlineEditManager = new InlineEditManager();

export function registerAllCommands(context: vscode.ExtensionContext) {
  for (const [command, callback] of Object.entries(commandsMap)) {
    context.subscriptions.push(
      vscode.commands.registerCommand(command, callback)
    );
  }
}
