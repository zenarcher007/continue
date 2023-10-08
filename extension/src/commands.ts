import * as vscode from "vscode";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";

import { acceptDiffCommand, rejectDiffCommand } from "./diffs";
import { debugPanelWebview } from "./debugPanel";
import { ideProtocolClient } from "./activation/activate";

let focusedOnContinueInput = false;

function addHighlightedCodeToContext(edit: boolean) {
  focusedOnContinueInput = !focusedOnContinueInput;
  const editor = vscode.window.activeTextEditor;
  if (editor) {
    const selection = editor.selection;
    if (selection.isEmpty) return;
    const range = new vscode.Range(selection.start, selection.end);
    const contents = editor.document.getText(range);
    ideProtocolClient?.sendHighlightedCode(
      [
        {
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
        },
      ],
      edit
    );
  }
}

export const setFocusedOnContinueInput = (value: boolean) => {
  focusedOnContinueInput = value;
};

// Copy everything over from extension.ts
const commandsMap: { [command: string]: (...args: any) => any } = {
  "continue.acceptDiff": acceptDiffCommand,
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
    focusedOnContinueInput = true;
  },
  "continue.toggleAuxiliaryBar": () => {
    vscode.commands.executeCommand("workbench.action.toggleAuxiliaryBar");
  },
  "continue.quickTextEntry": async () => {
    const text = await vscode.window.showInputBox({
      placeHolder: "Ask a question or enter a slash command",
      title: "Continue Quick Input",
    });
    if (text) {
      ideProtocolClient.sendMainUserInput(text);
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

  "continue.inlineChat": () => {
    let editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const fsPath = editor.document.uri.fsPath;

    if (fsPath in currentEditorInsets) {
      currentEditorInsets[fsPath].editorInset.dispose();
      delete currentEditorInsets[fsPath];
    }

    const selection = editor.selection;
    let topOfSelection = selection.start.line

    const editorInset = vscode.window.createWebviewTextEditorInset(
      editor,
      topOfSelection - 1,
      3,
      {
        enableScripts: true,
        enableCommandUris: true,
      }
    );
    editorInset.webview.html = `<!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        
        <title>Continue</title>

        <style>

        #input-div {
          padding-top: 8px;
          padding-bottom: 8px;
          border-radius: 5px;
          color: white;
          font-family: sans-serif;
          height: 100%;
        }
        
        #input-textarea {
          background-color: #3e3e3e;
          padding: 4px 8px;
          border-radius: 5px;
          color: white;
          font-family: sans-serif;
          resize: none;
          width: 400px;
          outline: none;
          margin-left: 2px;
          
          :focus {
            border: 0.5px solid gray;
          }
        }

        </style>

        <script>const vscode = acquireVsCodeApi();</script>
      </head>
      <body>
        <div id="input-div">
          <textarea id="input-textarea" placeholder="Enter input"></textarea>
        </div>

        <script>
          const textArea = document.getElementById('input-textarea');

          textArea.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault(); // Prevent the newline character from being inserted
              const textValue = textArea.value;
              console.log('Text Area Value:', textValue);

              vscode.postMessage({
                type: 'input',
                input: textValue
              });
            }
          });

          textArea.addEventListener('onchange', (event) => {
            textArea.style.height = 'auto';
            textArea.style.height = textArea.scrollHeight + 'px';
            vscode.postMessage({
              type: 'resize',
              height: textArea.scrollHeight
            });
          });

          textArea.focus();

          // Listen for escape key
          document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
              vscode.postMessage({
                type: 'escape'
              });
            }
          });
        </script>
      </body>
    </html>`;

    currentEditorInsets[editor.document.uri.fsPath] = {
      editorInset,
      selection: selection,
    }

    editorInset.webview.onDidReceiveMessage((message) => {
      if (!editor) return
      if (message.type === 'input') {
        ideProtocolClient?.sendHighlightedCode(
          [
            {
              filepath: editor.document.uri.fsPath,
              contents: editor.document.getText(new vscode.Range(selection.start, selection.end)),
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
            },
          ],
          true
        );
        ideProtocolClient.sendMainUserInput("/edit " + message.input);
      } else if (message.type === 'resize') {
        (editorInset as any).height = message.height
      } else if (message.type === 'escape') {
        editorInset.dispose()
        delete currentEditorInsets[editor.document.uri.fsPath]
      }
    })
  },
  "continue.escapeEditorInsets": () => {
    const currentEditor = vscode.window.activeTextEditor;
    if (!currentEditor) return;

    currentEditorInsets[currentEditor.document.uri.fsPath]?.editorInset.dispose()
  }
};

interface EditorInsetInfo {
  editorInset: vscode.WebviewEditorInset;
  selection: vscode.Selection;
}
let currentEditorInsets: {[filepath: string]: EditorInsetInfo} = {};

export function registerAllCommands(context: vscode.ExtensionContext) {
  for (const [command, callback] of Object.entries(commandsMap)) {
    context.subscriptions.push(
      vscode.commands.registerCommand(command, callback)
    );
  }
}
