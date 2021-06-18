// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import '../../common/extensions';

import { inject, injectable } from 'inversify';
import { workspace } from 'vscode';
import { IDataScienceCommandListener } from '../types';
import { NewInteractiveWindowCommandListener } from './newInteractiveWindowCommandListener';
import { OldInteractiveWindowCommandListener } from './oldInteractiveWindowCommandListener';
import { ICommandManager } from '../../common/application/types';

@injectable()
export class InteractiveWindowCommandListener implements IDataScienceCommandListener {
    constructor(
        @inject(OldInteractiveWindowCommandListener) private oldListener: OldInteractiveWindowCommandListener,
        @inject(NewInteractiveWindowCommandListener) private newListener: NewInteractiveWindowCommandListener
    ) {}

    public register(commandManager: ICommandManager) {
        const interactiveConfiguration = workspace.getConfiguration('interactive.experiments');
        if (interactiveConfiguration.get<boolean | undefined>('enable') === true) {
            this.newListener.register(commandManager);
        } else {
            this.oldListener.register(commandManager);
        }
    }
}
