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
      inlineEditManager.enter();
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
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }
    const previousFileContents = editor.document.getText();

    // Highlight the selected range with a decoration
    const originalRange = editor.selection;
    const highlightDecorationType =
      vscode.window.createTextEditorDecorationType({
        backgroundColor: "#eee2",
        isWholeLine: true,
      });
    if (!editor.selection.isEmpty) {
      editor.setDecorations(highlightDecorationType, [originalRange]);
    }
    const decorationTypes = [highlightDecorationType];

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
    const decorationType = createSvgDecorationType("box.svg");
    decorationTypes.push(decorationType);
    editor.setDecorations(decorationType, [
      new vscode.Range(position.translate(-1, 0), position.translate(0, 0)),
    ]);

    const endLineDecorationType = vscode.window.createTextEditorDecorationType({
      before: {
        // contentText: "⌘ ⇧ ⏎ to edit, esc to cancel",
        // contentIconPath: vscode.Uri.file(
        //   path.join(__dirname, "..", "media", "test.svg")
        // ),
        margin: "0 0 4em 0",
        color: "#8888",
      },
      // backgroundColor: "#eee2",
      isWholeLine: true,
      color: "transparent",
      cursor: "default",
    });
    decorationTypes.push(endLineDecorationType);
    editor.setDecorations(endLineDecorationType, [
      new vscode.Range(position.translate(1, 0), position.translate(1, 0)),
    ]);

    const startLine = position.line - 1;

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
          if (start.line <= startLine && end.line >= startLine) {
            // Revert the start line to its original state
            editor.edit((editBuilder) => {
              editBuilder.replace(
                new vscode.Range(startLine, 0, startLine, 1000),
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
        const contentsOfFirstLine = editor.document.lineAt(startLine + 1).text;
        if (contentsOfFirstLine === "" || contentsOfFirstLine === " ") {
          // If the space was removed from the start of the line, put it back
          editor.edit((editBuilder) => {
            editBuilder.insert(new vscode.Position(startLine + 1, 0), "  ");
          });
        }
      });

      const disposables = [editListener];

      inlineEditManager.add({
        startLine,
        decorationTypes,
        editor,
        highlightDecorationType,
        previousFileContents,
        disposables,
        lineCount: 1,
      });
    }, 100);
  },
  "continue.clearInlineEdit": () => {
    inlineEditManager.removeAll();
  },
};

function createSvgDecorationType(img: string) {
  return vscode.window.createTextEditorDecorationType({
    before: {
      margin: "0 0 0 0px",
      // contentText: "",
      contentIconPath: vscode.Uri.file(
        path.join(__dirname, "..", "media", img)
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

interface InlineEdit {
  startLine: number;
  decorationTypes: vscode.TextEditorDecorationType[];
  highlightDecorationType: vscode.TextEditorDecorationType;
  editor: vscode.TextEditor;
  previousFileContents: string;
  disposables: vscode.Disposable[];
  lineCount: number;
}

// Only allow one per editor
class InlineEditManager {
  private edits: InlineEdit[] = [];

  add(inlineEdit: InlineEdit) {
    this.edits.push(inlineEdit);

    // Add listener for when number of lines changes
    const lineCountListener = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document !== inlineEdit.editor.document) {
        return;
      }

      const range = this.findRange(inlineEdit);
      const lineCount = range.end.line - range.start.line - 2;

      if (lineCount !== inlineEdit.lineCount) {
        let imgName = "box.svg";
        switch (lineCount) {
          case 0:
          case 1:
            imgName = "box.svg";
            break;
          case 2:
            imgName = "box2.svg";
            break;
          default:
            // Use the tallest existing box
            imgName = "box2.svg";
            break;
        }

        // Update the decoration
        inlineEdit.editor.setDecorations(inlineEdit.decorationTypes[1], []);

        inlineEdit.decorationTypes[1] = createSvgDecorationType(imgName);
        inlineEdit.editor.setDecorations(inlineEdit.decorationTypes[1], [
          new vscode.Range(range.start, range.start.translate(lineCount, 0)),
        ]);

        inlineEdit.lineCount = lineCount;
      }
    });

    inlineEdit.disposables.push(lineCountListener);

    // Add listener for when the user puts their cursor on a boundary line (and move back to middle)
    const cursorListener = vscode.window.onDidChangeTextEditorSelection((e) => {
      if (e.textEditor !== inlineEdit.editor) {
        return;
      }

      const selection = e.selections[0];
      const range = this.findRange(inlineEdit);
      if (
        selection.active.line === range.start.line ||
        selection.active.line === range.end.line - 1
      ) {
        // Move the cursor back to the middle
        const position = range.start.translate(1, 2);
        inlineEdit.editor.selection = new vscode.Selection(position, position);
      }
    });

    inlineEdit.disposables.push(cursorListener);
  }

  count() {
    return this.edits.length;
  }

  private findRange(inlineEdit: InlineEdit) {
    const startPos = new vscode.Position(inlineEdit.startLine, 0);

    // Find the end line
    let endPos = startPos;
    while (
      endPos.line < inlineEdit.editor.document.lineCount &&
      inlineEdit.editor.document.lineAt(endPos.line).text !== "`;"
    ) {
      endPos = endPos.translate(1, 0);
    }
    endPos = endPos.translate(1, 0);

    return new vscode.Range(startPos, endPos);
  }

  async enter() {
    const edit = this.edits[0];

    // Get the text
    const fullRange = this.findRange(edit);
    const range = new vscode.Range(
      fullRange.start.translate(1, 0),
      fullRange.end.translate(-1, 0)
    );
    const text = edit.editor.document.getText(range).trim();
    ideProtocolClient.sendMainUserInput("/edit " + text);

    this.removeAll();
  }

  private remove(inlineEdit: InlineEdit) {
    this.edits = this.edits.filter((edit) => edit !== inlineEdit);
    for (const decorationType of inlineEdit.decorationTypes) {
      inlineEdit.editor.setDecorations(decorationType, []);
      decorationType.dispose();
    }

    inlineEdit.editor.setDecorations(inlineEdit.highlightDecorationType, []);

    // Remove the inserted text
    inlineEdit.editor.edit((editBuilder) => {
      editBuilder.delete(this.findRange(inlineEdit));
    });

    // If the file contents are the same as original, save the file, because it's annoying to have to save it manually
    setTimeout(() => {
      const fileContents = inlineEdit.editor.document.getText();
      if (fileContents === inlineEdit.previousFileContents) {
        inlineEdit.editor.document.save();
      }
    }, 100);

    // Dispose of the listeners
    for (const disposable of inlineEdit.disposables) {
      disposable.dispose();
    }
  }

  removeAll() {
    for (const edit of this.edits) {
      this.remove(edit);
    }
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
