// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { ConfigurationChangeEvent, ConfigurationTarget, Event, EventEmitter } from 'vscode';
import { IWorkspaceService } from '../application/types';
import { traceDecorators } from '../logger';
import { IConfigurationService, IDisposable, IDisposableRegistry, IJupyterSettings } from '../types';
import { ExtensionChannels, IExtensionChannelService } from './types';

export const insidersChannelSetting: keyof IJupyterSettings = 'insidersChannel';

@injectable()
export class ExtensionChannelService implements IExtensionChannelService {
    public _onDidChannelChange: EventEmitter<ExtensionChannels> = new EventEmitter<ExtensionChannels>();
    constructor(
        @inject(IConfigurationService) private readonly configService: IConfigurationService,
        @inject(IWorkspaceService) private readonly workspaceService: IWorkspaceService,
        @inject(IDisposableRegistry) disposables: IDisposable[]
    ) {
        disposables.push(this.workspaceService.onDidChangeConfiguration(this.onDidChangeConfiguration.bind(this)));
    }
    public getChannel(): ExtensionChannels {
        const settings = this.configService.getSettings();
        return settings.insidersChannel;
    }

    public get isChannelUsingDefaultConfiguration(): boolean {
        const settings = this.workspaceService
            .getConfiguration('jupyter')
            .inspect<ExtensionChannels>(insidersChannelSetting);
        if (!settings) {
            throw new Error(
                `WorkspaceConfiguration.inspect returns 'undefined' for setting 'python.${insidersChannelSetting}'`
            );
        }
        return !settings.globalValue;
    }

    @traceDecorators.error('Updating channel failed')
    public async updateChannel(value: ExtensionChannels): Promise<void> {
        await this.configService.updateSetting(insidersChannelSetting, value, undefined, ConfigurationTarget.Global);
    }

    public get onDidChannelChange(): Event<ExtensionChannels> {
        return this._onDidChannelChange.event;
    }

    public async onDidChangeConfiguration(event: ConfigurationChangeEvent) {
        if (event.affectsConfiguration(`jupyter.${insidersChannelSetting}`)) {
            const settings = this.configService.getSettings();
            this._onDidChannelChange.fire(settings.insidersChannel);
        }
    }
}
