// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable, named } from 'inversify';
import { ExtensionContext, Memento } from 'vscode';
import { IExtensionSingleActivationService } from '../activation/types';
import { ExtensionFeatureLastUsedTime, ExtensionLastActivatedTime } from '../common/extensionUsage';
import { disposeAllDisposables } from '../common/helpers';
import { IPlatformService } from '../common/platform/types';
import { GLOBAL_MEMENTO, IDisposable, IDisposableRegistry, IExtensionContext, IMemento } from '../common/types';
import { noop } from '../common/utils/misc';
import { OSType } from '../common/utils/platform';
import { IInteractiveWindowProvider, INotebookEditorProvider } from './types';

/**
 * If user opens a notebook or interactive window, then we assume the user has used DS functionality.
 */
@injectable()
export class FeatureUsageTracker implements IExtensionSingleActivationService, IDisposable {
    private readonly disposables: IDisposable[] = [];
    private readonly extensionsPath: string;
    constructor(
        @inject(IMemento) @named(GLOBAL_MEMENTO) private readonly globalMemento: Memento,
        @inject(IPlatformService) private readonly platform: IPlatformService,
        @inject(IExtensionContext) context: ExtensionContext,
        @inject(INotebookEditorProvider) private readonly notebookEditorProvider: INotebookEditorProvider,
        @inject(IInteractiveWindowProvider) private readonly interactiveWidowProvider: IInteractiveWindowProvider,
        @inject(IDisposableRegistry) disposables: IDisposableRegistry
    ) {
        disposables.push(this);
        this.extensionsPath = context.asAbsolutePath('../');
    }
    public dispose() {
        disposeAllDisposables(this.disposables);
    }
    public async activate(): Promise<void> {
        // Keep track of the last time this extension was activated.
        this.globalMemento.update(ExtensionLastActivatedTime, new Date().getTime()).then(noop, noop);
        // Keep track of the last time this extension was used (opened a notebook or interactive window).
        this.notebookEditorProvider.onDidOpenNotebookEditor(this.onDidOpenNotebookEditor, this, this.disposables);
        this.interactiveWidowProvider.onDidCreateInteractiveWindow(
            () => this.trackUsage().catch(noop),
            this,
            this.disposables
        );
    }

    /**
     * If user opens any notebook (other than start page), then assume DS functionality has been used.
     */
    private onDidOpenNotebookEditor() {
        const nbFile = this.notebookEditorProvider.activeEditor?.file.fsPath;
        if (!nbFile || this.isPotentialStartPage(nbFile)) {
            return;
        }
        this.trackUsage().catch(noop);
    }
    /**
     * If a notebook is opened from the extensions folder, then assume its the start page.
     * Else assume user opened a notebook.
     */
    private isPotentialStartPage(nbFile: string) {
        if (
            this.platform.osType === OSType.Windows &&
            nbFile.toLowerCase().startsWith(this.extensionsPath.toLowerCase())
        ) {
            return true;
        }
        if (this.platform.osType !== OSType.Windows && nbFile.startsWith(this.extensionsPath)) {
            return true;
        }
        return false;
    }
    public async trackUsage() {
        await this.globalMemento.update(ExtensionFeatureLastUsedTime, new Date().getTime());
    }
}
