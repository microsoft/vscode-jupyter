// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable, named } from 'inversify';
import { EventEmitter, Memento } from 'vscode';
import { GLOBAL_MEMENTO, IMemento, IsWebExtension } from '../../../platform/common/types';

export const mementoKeyToIndicateIfConnectingToLocalKernelsOnly = 'connectToLocalKernelsOnly';

@injectable()
export class ServerConnectionType {
    private _isLocalLaunch?: boolean;
    private readonly _onDidChange = new EventEmitter<void>();
    public readonly onDidChange = this._onDidChange.event;
    constructor(
        @inject(IMemento) @named(GLOBAL_MEMENTO) private readonly memento: Memento,
        @inject(IsWebExtension) private readonly isWebExtension: boolean
    ) {}

    public get isLocalLaunch() {
        if (this.isWebExtension) {
            return false;
        }
        if (typeof this._isLocalLaunch === 'boolean') {
            return this._isLocalLaunch;
        }
        const connectToLocalOnly = this.memento.get<boolean>(mementoKeyToIndicateIfConnectingToLocalKernelsOnly, true);
        if (typeof this._isLocalLaunch !== 'boolean') {
            this._isLocalLaunch = connectToLocalOnly;
        }
        return connectToLocalOnly;
    }
    public async setIsLocalLaunch(localLaunch: boolean) {
        if (this.isWebExtension) {
            return;
        }
        this._isLocalLaunch = localLaunch;
        this._onDidChange.fire();
        await this.memento.update(mementoKeyToIndicateIfConnectingToLocalKernelsOnly, localLaunch);
    }
}
