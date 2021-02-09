// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import * as path from 'path';
import * as fs from 'fs-extra';
import { inject, injectable, named } from 'inversify';
import { Memento, Uri } from 'vscode';
import { IExtensionSingleActivationService } from '../../activation/types';
import { IApplicationEnvironment, ICommandManager } from '../../common/application/types';
import { UseVSCodeNotebookEditorApi } from '../../common/constants';
import { GLOBAL_MEMENTO, IExtensionContext, IMemento } from '../../common/types';
import { noop } from '../../common/utils/misc';
import { CommandSource } from '../../testing/common/constants';
import { Commands } from '../constants';
import { ITrustService } from '../types';
import { swallowExceptions } from '../../common/utils/decorators';
import { InsidersNotebookSurveyStateKeys } from '../insidersNativeNotebookSurveyBanner';

export const IntroduceNativeNotebookDisplayed = 'JVSC_INTRO_NATIVE_NB_DISPLAYED';

/**
 * Display a notebook introducing Native Notebooks to those users in the stable Notebook experiment & have previously run a notebook.
 */
@injectable()
export class IntroduceNativeNotebookStartPage implements IExtensionSingleActivationService {
    private readonly introNotebook: Uri;
    constructor(
        @inject(UseVSCodeNotebookEditorApi) private readonly useVSCNotebook: boolean,
        @inject(ICommandManager) private readonly commandManager: ICommandManager,
        @inject(ITrustService) private readonly trustService: ITrustService,
        @inject(IExtensionContext) private readonly context: IExtensionContext,
        @inject(IApplicationEnvironment) private readonly appEnv: IApplicationEnvironment,
        @inject(IMemento) @named(GLOBAL_MEMENTO) private readonly memento: Memento
    ) {
        this.introNotebook = Uri.file(path.join(this.context.extensionPath, 'resources/startNativeNotebooks.ipynb'));
    }
    public async activate(): Promise<void> {
        if (
            this.appEnv.channel !== 'stable' ||
            this.memento.get<boolean>(IntroduceNativeNotebookDisplayed, false) ||
            !this.useVSCNotebook
        ) {
            return;
        }

        // Only display to users who have run a notebook at least once before.
        if (this.memento.get<number>(InsidersNotebookSurveyStateKeys.ExecutionCount, 0) === 0) {
            this.doNotShowStartPageAgain().then(noop, noop);
            return;
        }
        this.trustAndOpenIntroNotebook().catch(noop);
    }
    private async doNotShowStartPageAgain() {
        await this.memento.update(IntroduceNativeNotebookDisplayed, true);
    }
    @swallowExceptions('Open Intro Native Notebook')
    private async trustAndOpenIntroNotebook() {
        // Ensure we display once & it is trusted.
        await this.doNotShowStartPageAgain();
        const contents = await fs.readFile(this.introNotebook.fsPath, 'utf8');
        await this.trustService.trustNotebook(this.introNotebook, contents);
        await this.commandManager.executeCommand(
            Commands.OpenNotebook,
            this.introNotebook,
            undefined,
            CommandSource.auto
        );
    }
}
