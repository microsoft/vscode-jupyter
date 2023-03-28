// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { injectable } from 'inversify';
import { InteractiveWindowView, JupyterNotebookView } from '../platform/common/constants';
import { IStartupCodeProvider, IStartupCodeProviders } from './types';

@injectable()
export class KernelStartupCodeProviders implements IStartupCodeProviders {
    private readonly providers = new Map<
        typeof JupyterNotebookView | typeof InteractiveWindowView,
        IStartupCodeProvider[]
    >();
    public getProviders(
        notebookViewType: typeof JupyterNotebookView | typeof InteractiveWindowView
    ): IStartupCodeProvider[] {
        return (this.providers.get(notebookViewType) || []).slice();
    }
    register(
        provider: IStartupCodeProvider,
        notebookViewType: typeof JupyterNotebookView | typeof InteractiveWindowView
    ): void {
        this.providers.set(notebookViewType, this.providers.get(notebookViewType) || []);
        this.providers.get(notebookViewType)!.push(provider);
    }
}
