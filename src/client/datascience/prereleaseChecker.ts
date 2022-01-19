// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import '../common/extensions';
import { inject, injectable, named } from 'inversify';
import { IExtensionSingleActivationService } from '../activation/types';
import { IApplicationEnvironment, IApplicationShell } from '../common/application/types';
import { GLOBAL_MEMENTO, IMemento, IsPreRelease } from '../common/types';
import * as localize from '../common/utils/localize';
import { JVSC_EXTENSION_ID } from '../common/constants';
import * as vscode from 'vscode';

const PRERELEASE_DONT_ASK_FLAG = 'dontAskForPrereleaseUpgrade';

@injectable()
export class PreReleaseChecker implements IExtensionSingleActivationService {
    constructor(
        @inject(IApplicationEnvironment) private readonly appEnv: IApplicationEnvironment,
        @inject(IApplicationShell) private readonly appShell: IApplicationShell,
        @inject(IMemento) @named(GLOBAL_MEMENTO) private globalState: vscode.Memento,
        @inject(IsPreRelease) private isPreRelease: boolean
    ) {}
    public async activate(): Promise<void> {
        // Ask user if the version is not prerelease
        const dontAsk = this.globalState.get(PRERELEASE_DONT_ASK_FLAG, false);
        if (!this.isPreRelease && this.appEnv.channel === 'insiders' && !dontAsk) {
            const yes = localize.DataScience.usingNonPrereleaseYes();
            const no = localize.DataScience.usingNonPrereleaseNo();
            const dontAskAgain = localize.DataScience.usingNonPrereleaseNoAndDontAskAgain();
            void this.appShell
                .showWarningMessage(localize.DataScience.usingNonPrerelease(), yes, no, dontAskAgain)
                .then((answer) => {
                    if (answer === yes) {
                        return vscode.commands.executeCommand(
                            'workbench.extensions.installExtension',
                            JVSC_EXTENSION_ID,
                            {
                                installPreReleaseVersion: true
                            }
                        );
                    } else if (answer == dontAskAgain) {
                        return this.globalState.update(PRERELEASE_DONT_ASK_FLAG, true);
                    }
                });
        }
    }
}
