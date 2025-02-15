/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as ObservableEvent from "../omnisharp/loggingEvents";
import { vscode } from '../vscodeAdapter';
import showInformationMessage from "../shared/observers/utils/ShowInformationMessage";
import { EventType } from "../omnisharp/EventType";
import OptionProvider from "../shared/observers/OptionProvider";

export class InformationMessageObserver {
    constructor(private vscode: vscode, private optionProvider: OptionProvider) {
    }

    public post = (event: ObservableEvent.BaseEvent) => {
        switch (event.type) {
            case EventType.OmnisharpServerUnresolvedDependencies:
                this.handleOmnisharpServerUnresolvedDependencies(<ObservableEvent.OmnisharpServerUnresolvedDependencies>event);
                break;
        }
    }

    private async handleOmnisharpServerUnresolvedDependencies(event: ObservableEvent.OmnisharpServerUnresolvedDependencies) {
        //to do: determine if we need the unresolved dependencies message
        if (!this.optionProvider.GetLatestOptions().omnisharpOptions.suppressDotnetRestoreNotification) {
            let message = `There are unresolved dependencies. Please execute the restore command to continue.`;
            return showInformationMessage(this.vscode, message, { title: "Restore", command: "dotnet.restore.all" });
        }
    }
}
