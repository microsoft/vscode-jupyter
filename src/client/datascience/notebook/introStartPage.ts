// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable, named } from 'inversify';
import { Memento } from 'vscode';
import { IExtensionSingleActivationService } from '../../activation/types';
import { IApplicationEnvironment, IApplicationShell } from '../../common/application/types';
import { UseVSCodeNotebookEditorApi } from '../../common/constants';
import { GLOBAL_MEMENTO, IMemento } from '../../common/types';
import { noop } from '../../common/utils/misc';
import { InsidersNotebookSurveyStateKeys } from '../dataScienceSurveyBanner';

export const IntroduceNativeNotebookDisplayed = 'JVSC_INTRO_NATIVE_NB_DISPLAYED';

/**
 * Display a notebook introducing Native Notebooks to those users in the stable Notebook experiment & have previously run a notebook.
 */
@injectable()
export class IntroduceNativeNotebookStartPage implements IExtensionSingleActivationService {
    constructor(
        @inject(UseVSCodeNotebookEditorApi) private readonly useVSCNotebook: boolean,
        @inject(IApplicationEnvironment) private readonly appEnv: IApplicationEnvironment,
        @inject(IApplicationShell) private readonly appShell: IApplicationShell,
        @inject(IMemento) @named(GLOBAL_MEMENTO) private readonly memento: Memento
    ) {}
    public async activate(): Promise<void> {
        if (
            this.appEnv.channel !== 'stable' ||
            this.memento.get<boolean>(IntroduceNativeNotebookDisplayed, false) ||
            !this.useVSCNotebook
        ) {
            return;
        }

        this.memento.update(IntroduceNativeNotebookDisplayed, true).then(noop, noop);
        // Only display to users who have run a notebook at least once before.
        if (this.memento.get<number>(InsidersNotebookSurveyStateKeys.ExecutionCount, 0) === 0) {
            return;
        }
        this.appShell
            .showInformationMessage(
                'The notebook interface has been revamped. To learn more about this improved experience, click [here](https://github.com/microsoft/vscode-jupyter/wiki/Introducing-Native-Notebooks)'
            )
            .then(noop, noop);
    }
}
