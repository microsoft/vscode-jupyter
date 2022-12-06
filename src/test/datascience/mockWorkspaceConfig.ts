// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { ConfigurationTarget, WorkspaceConfiguration } from 'vscode';

export class MockWorkspaceConfiguration implements WorkspaceConfiguration {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    private values = new Map<string, any>();

    constructor(defaultSettings?: any) {
        if (defaultSettings) {
            const keys = [...Object.keys(defaultSettings)];
            keys.forEach((k) => this.values.set(k, defaultSettings[k]));
        }

        // Special case python path (not in the object)
        if (defaultSettings && defaultSettings.defaultInterpreterPath) {
            this.values.set('defaultInterpreterPath', defaultSettings.defaultInterpreterPath);
        }
    }

    public get<T>(key: string, defaultValue?: T): T | undefined {
        // eslint-disable-next-line
        if (this.values.has(key)) {
            return this.values.get(key);
        }

        return arguments.length > 1 ? defaultValue : (undefined as any);
    }
    public has(section: string): boolean {
        return this.values.has(section);
    }
    public inspect<T>(_section: string):
        | {
              key: string;
              defaultValue?: T | undefined;
              globalValue?: T | undefined;
              workspaceValue?: T | undefined;
              workspaceFolderValue?: T | undefined;
          }
        | undefined {
        return;
    }
    public update(
        section: string,
        value: any,
        _configurationTarget?: boolean | ConfigurationTarget | undefined
    ): Promise<void> {
        this.values.set(section, value);
        return Promise.resolve();
    }
}
