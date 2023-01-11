// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';
import '../../../platform/common/extensions';

import { inject, injectable } from 'inversify';

import { capturePerfTelemetry } from '../../../telemetry';
import { IDataViewer, IDataViewerDataProvider, IDataViewerFactory } from './types';
import debounce from 'lodash/debounce';
import { ICommandManager } from '../../../platform/common/application/types';
import { ContextKey } from '../../../platform/common/contextKey';
import { IAsyncDisposable, IAsyncDisposableRegistry, IDisposableRegistry } from '../../../platform/common/types';
import { IServiceContainer } from '../../../platform/ioc/types';
import { noop } from '../../../platform/common/utils/misc';
import { Commands, EditorContexts, Telemetry } from '../../../platform/common/constants';

@injectable()
export class DataViewerFactory implements IDataViewerFactory, IAsyncDisposable {
    private knownViewers = new Set<IDataViewer>();
    private viewContext: ContextKey;

    constructor(
        @inject(IServiceContainer) private serviceContainer: IServiceContainer,
        @inject(IAsyncDisposableRegistry) asyncRegistry: IAsyncDisposableRegistry,
        @inject(IDisposableRegistry) private disposables: IDisposableRegistry,
        @inject(ICommandManager) private commandManager: ICommandManager
    ) {
        asyncRegistry.push(this);
        this.viewContext = new ContextKey(EditorContexts.IsDataViewerActive, this.commandManager);
        this.disposables.push(
            this.commandManager.registerCommand(Commands.RefreshDataViewer, this.refreshDataViewer, this)
        );
    }

    public async dispose() {
        for (const viewer of this.knownViewers) {
            viewer.dispose();
        }
    }

    @capturePerfTelemetry(Telemetry.StartShowDataViewer)
    public async create(dataProvider: IDataViewerDataProvider, title: string): Promise<IDataViewer> {
        let result: IDataViewer | undefined;

        // Create the data explorer
        const dataExplorer = this.serviceContainer.get<IDataViewer>(IDataViewer);
        try {
            // Then load the data.
            this.knownViewers.add(dataExplorer);
            dataExplorer.onDidDisposeDataViewer(this.updateOpenDataViewers, this, this.disposables);
            dataExplorer.onDidChangeDataViewerViewState(this.updateViewStateContext, this, this.disposables);
            // Show the window and the data
            await dataExplorer.showData(dataProvider, title);
            result = dataExplorer;
        } finally {
            if (!result) {
                // If throw any errors, close the window we opened.
                dataExplorer.dispose();
            }
        }
        return result;
    }

    public get activeViewer() {
        return [...this.knownViewers.values()].find((v) => v.active);
    }

    private updateOpenDataViewers(viewer: IDataViewer) {
        this.knownViewers.delete(viewer);
    }

    private async updateViewStateContext() {
        // A data viewer's view state has changed. Look through our known viewers to see if any are active
        let hasActiveViewer = false;
        this.knownViewers.forEach((viewer) => {
            if (viewer.active) {
                hasActiveViewer = true;
            }
        });
        await this.viewContext.set(hasActiveViewer);
    }

    // Refresh command is mapped to a keybinding. Refresh
    // is expensive. Ensure we debounce refresh requests
    // in case the user is mashing the refresh shortcut.
    private refreshDataViewer = debounce(() => {
        // Find the data viewer which is currently active
        for (const viewer of this.knownViewers) {
            if (viewer.active) {
                // There should only be one of these
                viewer.refreshData().then(noop, noop);
            }
        }
    }, 1000);
}
