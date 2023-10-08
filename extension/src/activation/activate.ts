import * as vscode from "vscode";
import IdeProtocolClient from "../continueIdeClient";
import { getContinueServerUrl } from "../bridge";
import { ContinueGUIWebviewViewProvider } from "../debugPanel";
import {
  getExtensionVersion,
  startContinuePythonServer,
} from "./environmentSetup";
import { registerAllCodeLensProviders } from "../lang-server/codeLens";
import { registerAllCommands } from "../commands";
import registerQuickFixProvider from "../lang-server/codeActions";
import path from "path";
import os from "os";
import fs from "fs";
import { getExtensionUri } from "../util/vscode";

const PACKAGE_JSON_RAW_GITHUB_URL =
  "https://raw.githubusercontent.com/continuedev/continue/HEAD/extension/package.json";

export let extensionContext: vscode.ExtensionContext | undefined = undefined;

export let ideProtocolClient: IdeProtocolClient;

function getExtensionVersionInt(versionString: string): number {
  return parseInt(versionString.replace(/\./g, ""));
}

function addPythonPathForConfig() {
  // Add to python.analysis.extraPaths global setting so config.py gets LSP

  if (
    vscode.workspace.workspaceFolders?.some((folder) =>
      folder.uri.fsPath.endsWith("continue")
    )
  ) {
    // Not for the Continue repo
    return;
  }

  const pythonConfig = vscode.workspace.getConfiguration("python");
  const analysisPaths = pythonConfig.get<string[]>("analysis.extraPaths");
  const autoCompletePaths = pythonConfig.get<string[]>(
    "autoComplete.extraPaths"
  );
  const pathToAdd = extensionContext?.extensionPath;
  if (analysisPaths && pathToAdd && !analysisPaths.includes(pathToAdd)) {
    analysisPaths.push(pathToAdd);
    pythonConfig.update("analysis.extraPaths", analysisPaths);
  }

  if (
    autoCompletePaths &&
    pathToAdd &&
    !autoCompletePaths.includes(pathToAdd)
  ) {
    autoCompletePaths.push(pathToAdd);
    pythonConfig.update("autoComplete.extraPaths", autoCompletePaths);
  }
}

export async function activateExtension(context: vscode.ExtensionContext) {
  extensionContext = context;
  console.log("Using Continue version: ", getExtensionVersion());
  try {
    console.log(
      "In workspace: ",
      vscode.workspace.workspaceFolders?.[0].uri.fsPath
    );
  } catch (e) {
    console.log("Error getting workspace folder: ", e);
  }

  // Register commands and providers
  registerAllCodeLensProviders(context);
  registerAllCommands(context);
  registerQuickFixProvider();
  addPythonPathForConfig();

  const vscodeInsidersDir = path.join(os.homedir(), '.vscode-insiders');
  const argvJsonPath = path.join(vscodeInsidersDir, 'argv.json');

  try {
    if (fs.existsSync(argvJsonPath)) {
      const fileContents = fs.readFileSync(argvJsonPath, 'utf8');
      const lines = [];
      for (const line of fileContents.split("\n")) {
        if (line.trimStart().startsWith("//")) {
          continue;
        }
        lines.push(line);
      }
      const argvData = JSON.parse(lines.join("\n"));

      if (!argvData['enable-proposed-api']) {
        argvData['enable-proposed-api'] = ['Continue.continue'];
      } else if (!argvData['enable-proposed-api'].includes('Continue.continue')) {
        argvData['enable-proposed-api'].push('Continue.continue');
      }

      fs.writeFileSync(argvJsonPath, JSON.stringify(argvData, null, 2), 'utf8');
    }
  } catch (e) {}

  try {
    const packageJsonPath = path.join(getExtensionUri().fsPath, "package.json");
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      
      if (!packageJson["enabledApiProposals"]) {
        packageJson["enabledApiProposals"] = ["editorInsets"];
        fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2), 'utf8');
        vscode.commands.executeCommand("workbench.action.reloadWindow");
      }
    }
  } catch(e) {}

  // Start the server
  const sessionIdPromise = (async () => {
    await startContinuePythonServer();

    console.log("Continue server started");
    // Initialize IDE Protocol Client
    const serverUrl = getContinueServerUrl();
    ideProtocolClient = new IdeProtocolClient(
      `${serverUrl.replace("http", "ws")}/ide/ws`,
      context
    );
    return await ideProtocolClient.getSessionId();
  })();

  // Register Continue GUI as sidebar webview, and beginning a new session
  const provider = new ContinueGUIWebviewViewProvider(sessionIdPromise);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      "continue.continueGUIView",
      provider,
      {
        webviewOptions: { retainContextWhenHidden: true },
      }
    )
  );

  // vscode.commands.executeCommand("continue.focusContinueInput");
}
