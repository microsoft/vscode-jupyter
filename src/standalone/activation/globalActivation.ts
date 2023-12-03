// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable, multiInject, optional } from 'inversify';
import { PYTHON_LANGUAGE } from '../../platform/common/constants';
import { ContextKey } from '../../platform/common/contextKey';
import {
    IConfigurationService,
    IDataScienceCommandListener,
    IDisposable,
    IDisposableRegistry
} from '../../platform/common/types';
import { noop } from '../../platform/common/utils/misc';
import { EditorContexts } from '../../platform/common/constants';
import { IExtensionSyncActivationService } from '../../platform/activation/types';
import { IRawNotebookSupportedService } from '../../kernels/raw/types';
import { hasCells } from '../../interactive-window/editor-integration/cellFactory';
import { window } from 'vscode';

/**
 * Singleton class that activate a bunch of random things that didn't fit anywhere else.
 * Could probably be broken up.
 */
@injectable()
export class GlobalActivation implements IExtensionSyncActivationService {
    public isDisposed: boolean = false;
    private changeHandler: IDisposable | undefined;
    private startTime: number = Date.now();
    constructor(
        @inject(IDisposableRegistry) private disposableRegistry: IDisposableRegistry,
        @inject(IConfigurationService) private configuration: IConfigurationService,
        @inject(IRawNotebookSupportedService)
        @optional()
        private rawSupported: IRawNotebookSupportedService | undefined,
        @multiInject(IDataScienceCommandListener)
        private commandListeners: IDataScienceCommandListener[]
    ) {}

    public get activationStartTime(): number {
        return this.startTime;
    }

    public activate() {
        // Set our initial settings and sign up for changes
        this.onSettingsChanged();
        this.changeHandler = this.configuration.getSettings(undefined).onDidChange(this.onSettingsChanged.bind(this));
        this.disposableRegistry.push(this);

        // Listen for active editor changes so we can detect have code cells or not
        this.disposableRegistry.push(window.onDidChangeActiveTextEditor(() => this.onChangedActiveTextEditor()));
        this.onChangedActiveTextEditor();

        // Figure out the ZMQ available context key
        this.computeZmqAvailable();

        if (this.commandListeners) {
            this.commandListeners.forEach((c) => c.register());
        }
    }

    public async dispose() {
        if (this.changeHandler) {
            this.changeHandler.dispose();
            this.changeHandler = undefined;
        }
    }

    private onSettingsChanged = () => {
        const settings = this.configuration.getSettings(undefined);
        const ownsSelection = settings.sendSelectionToInteractiveWindow;
        const editorContext = new ContextKey(EditorContexts.OwnsSelection);
        editorContext.set(ownsSelection).catch(noop);
    };

    private computeZmqAvailable() {
        const zmqContext = new ContextKey(EditorContexts.ZmqAvailable);
        zmqContext.set(this.rawSupported ? this.rawSupported.isSupported : false).then(noop, noop);
    }

    private onChangedActiveTextEditor() {
        // Setup the editor context for the cells
        const editorContext = new ContextKey(EditorContexts.HasCodeCells);
        const activeEditor = window.activeTextEditor;

        if (activeEditor && activeEditor.document.languageId === PYTHON_LANGUAGE) {
            // Inform the editor context that we have cells, fire and forget is ok on the promise here
            // as we don't care to wait for this context to be set and we can't do anything if it fails
            editorContext.set(hasCells(activeEditor.document, this.configuration.getSettings())).catch(noop);
        } else {
            editorContext.set(false).catch(noop);
        }
    }
}
