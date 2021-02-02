// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable, named } from 'inversify';
import { Memento } from 'vscode';
import { GLOBAL_MEMENTO, IMemento } from './types';
import {
    KeyBindingsMigratedMementoKey,
    SettingsMigratedMementoKey
} from '../activation/migrateDataScienceSettingsService';

export const ExtensionFeatureLastUsedTime = 'JVSC_LAST_USED_TIME';
export const ExtensionLastActivatedTime = 'JVSC_LAST_ACTIVATED_TIME';

@injectable()
export class ExtensionUsage {
    private _isFirstTimeUser = false;
    constructor(@inject(IMemento) @named(GLOBAL_MEMENTO) private readonly globalMemento: Memento) {}
    public get isFirstTimeUser() {
        if (this._isFirstTimeUser) {
            return this._isFirstTimeUser;
        }
        if (this.globalMemento.get<boolean>(SettingsMigratedMementoKey, false)) {
            return false;
        }
        if (this.globalMemento.get<boolean>(KeyBindingsMigratedMementoKey, false)) {
            return false;
        }
        this._isFirstTimeUser = true;
        return true;
    }
}
