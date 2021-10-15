// import { INotebookControllerManager } from './types';

import { inject, injectable } from 'inversify';
import { ConfigurationTarget, EventEmitter } from 'vscode';
import { IWorkspaceService } from '../../../common/application/types';
import { disposeAllDisposables } from '../../../common/helpers';
import { IConfigurationService, IDisposable, IDisposableRegistry } from '../../../common/types';
import { KernelConnectionMetadata } from '../../jupyter/kernels/types';

@injectable()
export class KernelFilterStorage implements IDisposable {
    private readonly disposables: IDisposable[] = [];
    private _onDidChange = new EventEmitter<void>();
    public get onDidChagne() {
        return this._onDidChange.event;
    }
    constructor(
        @inject(IConfigurationService) private readonly config: IConfigurationService,
        @inject(IWorkspaceService) private readonly workspace: IWorkspaceService,
        @inject(IDisposableRegistry) disposales: IDisposableRegistry
    ) {
        disposales.push(this);
    }
    public dispose() {
        disposeAllDisposables(this.disposables);
    }
    public getHiddenKernels(): KernelConnectionMetadata[] {
        if (!Array.isArray(this.workspace.workspaceFolders) || this.workspace.workspaceFolders.length === 0) {
            return [];
        }
        return [];
    }
    public async storeHiddenKernels(hiddenKernels: KernelConnectionMetadata[]) {
        const itemsToHide = hiddenKernels.map((item) => item.id);
        const folders = (this.workspace.workspaceFolders || []).map((item) => item.uri);
        if (folders.length === 0) {
            await Promise.all(
                folders.map((item) =>
                    this.config.updateSetting('kernels.filter', itemsToHide, item, ConfigurationTarget.Workspace)
                )
            );
        } else {
            await this.config.updateSetting('kernels.filter', [], undefined, ConfigurationTarget.Global);
        }
    }
}
