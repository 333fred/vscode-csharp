/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ParsedEnvironmentFile } from '../coreclr-debug/ParsedEnvironmentFile';
import { getBrokeredServicePipeName } from '../coreclr-debug/activate';

import { MessageItem } from '../vscodeAdapter';
import { CertToolStatusCodes, createSelfSignedCert, hasDotnetDevCertsHttps } from '../utils/DotnetDevCertsHttps';
import { AttachItem, RemoteAttachPicker, DotNetAttachItemsProviderFactory, AttachPicker } from '../features/processPicker';
import { PlatformInformation } from './platform';
import OptionProvider from './observers/OptionProvider';
import { getCSharpDevKit } from '../utils/getCSharpDevKit';

/**
 * Class used for debug configurations that will be sent to the debugger registered by {@link DebugAdapterExecutableFactory}
 * 
 * This class will handle:
 * 1. Setting options that were set under csharp.debug.* 
 * 2. Show the process picker if the request type is attach and if process is not set.
 * 3. Handle registering developer certs for web development.
 */
export class BaseVsDbgConfigurationProvider implements vscode.DebugConfigurationProvider {
    public constructor(protected platformInformation: PlatformInformation, private optionProvider: OptionProvider, private csharpOutputChannel: vscode.OutputChannel) { }

    //#region DebugConfigurationProvider

    async resolveDebugConfiguration(folder: vscode.WorkspaceFolder | undefined, debugConfiguration: vscode.DebugConfiguration, token?: vscode.CancellationToken): Promise<vscode.DebugConfiguration | undefined | null> {
        // Check to see if we are in the "Run and Debug" scenario.
        if (Object.keys(debugConfiguration).length == 0) {
            const csharpDevkitExtension = getCSharpDevKit();
            // If we dont have the csharpDevKitExtension, prompt for initial configurations.
            return csharpDevkitExtension ? undefined : null;
        }

        // Load settings before resolving variables as there may be variables set in settings.
        this.loadSettingDebugOptions(debugConfiguration);

        return debugConfiguration;
    }

    /**
     * Try to add all missing attributes to the debug configuration being launched.
     */
    async resolveDebugConfigurationWithSubstitutedVariables(folder: vscode.WorkspaceFolder | undefined, debugConfiguration: vscode.DebugConfiguration, token?: vscode.CancellationToken): Promise<vscode.DebugConfiguration | null | undefined> {

        if (!debugConfiguration.type) {
            // If the config doesn't look functional force VSCode to open a configuration file https://github.com/Microsoft/vscode/issues/54213
            return null;
        }

        let brokeredServicePipeName = getBrokeredServicePipeName();
        if (brokeredServicePipeName !== undefined) {
            debugConfiguration.brokeredServicePipeName = brokeredServicePipeName;
        }

        if (debugConfiguration.request === "launch") {
            if (!debugConfiguration.cwd && !debugConfiguration.pipeTransport) {
                debugConfiguration.cwd = folder?.uri.fsPath; // Workspace folder
            }

            debugConfiguration.internalConsoleOptions ??= "openOnSessionStart";

            // read from envFile and set config.env
            if (debugConfiguration.envFile !== undefined && debugConfiguration.envFile.length > 0) {
                debugConfiguration = this.parseEnvFile(debugConfiguration.envFile, debugConfiguration);
            }
        }

        // Process Id is empty, handle Attach to Process Dialog.
        if (debugConfiguration.request === "attach" && !debugConfiguration.processId && !debugConfiguration.processName) {
            let process: AttachItem | undefined;
            if (debugConfiguration.pipeTransport) {
                process = await RemoteAttachPicker.ShowAttachEntries(debugConfiguration, this.platformInformation);
            }
            else {
                let attachItemsProvider = DotNetAttachItemsProviderFactory.Get();
                let attacher = new AttachPicker(attachItemsProvider);
                process = await attacher.ShowAttachEntries();
            }

            if (process !== undefined) {
                debugConfiguration.processId = process.id;

                if (debugConfiguration.type == "coreclr" &&
                    this.platformInformation.isMacOS() &&
                    this.platformInformation.architecture == 'arm64') {
                    // For Apple Silicon M1, it is possible that the process we are attaching to is being emulated as x86_64.
                    // The process is emulated if it has process flags has P_TRANSLATED (0x20000).
                    if (process.flags & 0x20000) {
                        debugConfiguration.targetArchitecture = "x86_64";
                    }
                    else {
                        debugConfiguration.targetArchitecture = "arm64";
                    }
                }
            }
            else {
                vscode.window.showErrorMessage("No process was selected.", { modal: true });
                return undefined;
            }
        }

        // We want to ask the user if we should run dotnet  dev-certs https --trust, but this doesn't work in a few cases --
        // Linux -- not supported by the .NET CLI as there isn't a single root cert store
        // VS Code remoting/Web UI -- the trusted cert work would need to happen on the client machine, but we don't have a way to run code there currently
        // pipeTransport -- the dev cert on the server will be different from the client
        if (!this.platformInformation.isLinux() && !vscode.env.remoteName && vscode.env.uiKind != vscode.UIKind.Web && !debugConfiguration.pipeTransport) {
            if (debugConfiguration.checkForDevCert === undefined && debugConfiguration.serverReadyAction && debugConfiguration.type === "coreclr") {
                debugConfiguration.checkForDevCert = true;
            }

            if (debugConfiguration.checkForDevCert) {
                this.checkForDevCerts(this.optionProvider.GetLatestOptions().commonOptions.dotnetPath);
            }
        }

        return debugConfiguration;
    }

    //#endregion

    /**
     * Parse envFile and add to config.env
     */
    private parseEnvFile(envFile: string, config: vscode.DebugConfiguration): vscode.DebugConfiguration {
        try {
            const parsedFile = ParsedEnvironmentFile.CreateFromFile(envFile, config["env"]);

            // show error message if single lines cannot get parsed
            if (parsedFile.Warning) {
                this.showFileWarningAsync(parsedFile.Warning, envFile);
            }

            config.env = parsedFile.Env;
        }
        catch (e) {
            throw new Error(`Can't parse envFile ${envFile} because of ${e}`);
        }

        // remove envFile from config after parsing
        delete config.envFile;

        return config;
    }

    private async showFileWarningAsync(message: string, fileName: string) {
        const openItem: MessageItem = { title: 'Open envFile' };
        const result = await vscode.window.showWarningMessage(message, openItem);
        if (result?.title === openItem.title) {
            const doc = await vscode.workspace.openTextDocument(fileName);
            await vscode.window.showTextDocument(doc);
        }
    }

    private loadSettingDebugOptions(debugConfiguration: vscode.DebugConfiguration): void {
        let debugOptions = vscode.workspace.getConfiguration('csharp').get('debug');
        let result = JSON.parse(JSON.stringify(debugOptions));
        let keys = Object.keys(result);

        for (let key of keys) {
            // Skip since option is set in the launch.json configuration
            // Skip 'console' option since this should be set when we know this is a console project.
            if (debugConfiguration.hasOwnProperty(key) || key === "console") {
                continue;
            }

            const settingsValue: any = result[key];
            if (!this.CheckIfSettingIsEmpty(settingsValue)) {
                debugConfiguration[key] = settingsValue;
            }
        }
    }

    private CheckIfSettingIsEmpty(input: any): boolean {
        switch (typeof (input)) {
            case "object":
                if (Array.isArray(input)) {
                    return input.length === 0;
                }
                else {
                    return Object.keys(input).length === 0;
                }
            case "string":
                return !input;
            case "boolean":
            case "number":
                return false; // booleans and numbers are never empty
            default:
                throw "Unknown type to check to see if setting is empty";
        }
    }

    private checkForDevCerts(dotnetPath: string) {
        hasDotnetDevCertsHttps(dotnetPath).then(async (returnData) => {
            let errorCode = returnData.error?.code;
            if (errorCode === CertToolStatusCodes.CertificateNotTrusted || errorCode === CertToolStatusCodes.ErrorNoValidCertificateFound) {
                const labelYes: string = "Yes";
                const labelNotNow: string = "Not Now";
                const labelMoreInfo: string = "More Information";

                const result = await vscode.window.showInformationMessage(
                    "The selected launch configuration is configured to launch a web browser but no trusted development certificate was found. Create a trusted self-signed certificate?",
                    { title: labelYes }, { title: labelNotNow, isCloseAffordance: true }, { title: labelMoreInfo }
                );
                if (result?.title === labelYes) {
                    let returnData = await createSelfSignedCert(dotnetPath);
                    if (returnData.error === null) //if the prcess returns 0, returnData.error is null, otherwise the return code can be acessed in returnData.error.code
                    {
                        let message = errorCode === CertToolStatusCodes.CertificateNotTrusted ? 'trusted' : 'created';
                        vscode.window.showInformationMessage(`Self-signed certificate sucessfully ${message}.`);
                    }
                    else {
                        this.csharpOutputChannel.appendLine(`Couldn't create self-signed certificate. ${returnData.error.message}\ncode: ${returnData.error.code}\nstdout: ${returnData.stdout}`);

                        const labelShowOutput: string = "Show Output";
                        const result = await vscode.window.showWarningMessage("Couldn't create self-signed certificate. See output for more information.", labelShowOutput);
                        if (result === labelShowOutput) {
                            this.csharpOutputChannel.show();
                        }
                    }
                }
                if (result?.title === labelMoreInfo) {
                    const launchjsonDescriptionURL = 'https://aka.ms/VSCode-CS-LaunchJson#check-for-devcert';
                    vscode.env.openExternal(vscode.Uri.parse(launchjsonDescriptionURL));
                    this.checkForDevCerts(dotnetPath);
                }
            }
        });
    }
}
