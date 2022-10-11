// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';
import { inject, injectable, named } from 'inversify';
import { commands, Memento } from 'vscode';
import { IExtensionSyncActivationService } from '../platform/activation/types';
import { IApplicationShell } from '../platform/common/application/types';
import { GLOBAL_MEMENTO, IBrowserService, IMemento } from '../platform/common/types';
import { Common, DataScience } from '../platform/common/utils/localize';
import { noop } from '../platform/common/utils/misc';
import { TrustedKernelPaths } from './raw/finder/trustedKernelSpecPaths.node';

const MEMENTO_KEY_NOTIFIED_ABOUT_HIDDEN_KERNEL = 'MEMENTO_KEY_NOTIFIED_ABOUT_HIDDEN_KERNEL_1';
@injectable()
export class HiddenKernelNotification implements IExtensionSyncActivationService {
    private notifiedAboutHiddenKernel?: boolean;
    constructor(
        @inject(IMemento) @named(GLOBAL_MEMENTO) private readonly globalMemento: Memento,
        @inject(IApplicationShell) private readonly appShell: IApplicationShell,
        @inject(IBrowserService) private readonly browser: IBrowserService
    ) {}

    public activate(): void {
        TrustedKernelPaths.IsKernelSpecHidden.promise
            .then((hidden) => {
                if (
                    !hidden ||
                    this.notifiedAboutHiddenKernel ||
                    this.globalMemento.get<boolean>(MEMENTO_KEY_NOTIFIED_ABOUT_HIDDEN_KERNEL, false)
                ) {
                    return;
                }
                this.notifiedAboutHiddenKernel = true;
                this.globalMemento.update(MEMENTO_KEY_NOTIFIED_ABOUT_HIDDEN_KERNEL, true).then(noop, noop);
                this.appShell
                    .showWarningMessage(
                        DataScience.untrustedKernelSpecsHidden(),
                        Common.learnMore(),
                        DataScience.updateSettingToTrustKernelSpecs()
                    )
                    .then((selection) => {
                        switch (selection) {
                            case Common.learnMore():
                                this.browser.launch('https://aka.ms/JupyterTrustedKernelPaths');
                                break;
                            case DataScience.updateSettingToTrustKernelSpecs():
                                commands
                                    .executeCommand('workbench.action.openSettings', 'jupyter.kernels.trusted')
                                    .then(noop, noop);
                                break;
                        }
                    })
                    .then(noop, noop);
            })
            .catch(noop);
    }
}
