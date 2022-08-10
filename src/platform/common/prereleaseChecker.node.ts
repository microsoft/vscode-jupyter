// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import './extensions';
import { inject, injectable, named } from 'inversify';
import { IExtensionSingleActivationService } from '../activation/types';
import { IApplicationEnvironment, IApplicationShell } from '../common/application/types';
import { GLOBAL_MEMENTO, IMemento, IsPreRelease } from '../common/types';
import * as localize from './utils/localize';
import { JVSC_EXTENSION_ID } from './constants';
import * as vscode from 'vscode';
import { noop } from './utils/misc';

const PRERELEASE_DONT_ASK_FLAG = 'dontAskForPrereleaseUpgrade';

/**
 * Puts up a UI asking the user to pick the prerelease version of the extension when running in insiders.
 */
@injectable()
export class PreReleaseChecker implements IExtensionSingleActivationService {
    constructor(
        @inject(IApplicationEnvironment) private readonly appEnv: IApplicationEnvironment,
        @inject(IApplicationShell) private readonly appShell: IApplicationShell,
        @inject(IMemento) @named(GLOBAL_MEMENTO) private globalState: vscode.Memento,
        @inject(IsPreRelease) private isPreRelease: Promise<boolean>
    ) {}
    public async activate(): Promise<void> {
        this.isPreRelease
            .then((isPreRelease) => {
                const dontAsk = this.globalState.get(PRERELEASE_DONT_ASK_FLAG, false);

                // Ask user if the version is not prerelease
                if (!isPreRelease && !dontAsk && this.appEnv.channel === 'insiders') {
                    const yes = localize.DataScience.usingNonPrereleaseYes();
                    const no = localize.DataScience.usingNonPrereleaseNo();
                    const dontAskAgain = localize.DataScience.usingNonPrereleaseNoAndDontAskAgain();
                    this.appShell
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
                        }, noop);
                }
            })
            .ignoreErrors();
    }
}
