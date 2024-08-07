// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable, multiInject, optional } from 'inversify';
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
}
