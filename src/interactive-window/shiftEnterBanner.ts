// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { ConfigurationTarget, window } from 'vscode';
import { Telemetry } from '../platform/common/constants';
import { IJupyterExtensionBanner, IPersistentStateFactory, IConfigurationService } from '../platform/common/types';
import * as localize from '../platform/common/utils/localize';
import { sendTelemetryEvent, captureUsageTelemetry } from '../telemetry';

export const BANNER_NAME_INTERACTIVE_SHIFTENTER: string = 'InteractiveShiftEnterBanner';

export enum InteractiveShiftEnterStateKeys {
    ShowBanner = 'InteractiveShiftEnterBanner'
}

enum InteractiveShiftEnterLabelIndex {
    Yes,
    No
}

// Create a banner to ask users if they want to send shift-enter to the interactive window or not
@injectable()
export class InteractiveShiftEnterBanner implements IJupyterExtensionBanner {
    private initialized?: boolean;
    private disabledInCurrentSession: boolean = false;
    private bannerMessage: string = localize.InteractiveShiftEnterBanner.bannerMessage;
    private bannerLabels: string[] = [localize.Common.bannerLabelYes, localize.Common.bannerLabelNo];

    constructor(
        @inject(IPersistentStateFactory) private persistentState: IPersistentStateFactory,
        @inject(IConfigurationService) private configuration: IConfigurationService
    ) {
        this.initialize();
    }

    public initialize() {
        if (this.initialized) {
            return;
        }
        this.initialized = true;

        if (!this.isEnabled()) {
            return;
        }
    }

    public isEnabled(): boolean {
        return this.persistentState.createGlobalPersistentState<boolean>(
            InteractiveShiftEnterStateKeys.ShowBanner,
            true
        ).value;
    }

    public async showBanner(): Promise<void> {
        if (!this.isEnabled()) {
            return;
        }

        const show = await this.shouldShowBanner();
        if (!show) {
            return;
        }

        sendTelemetryEvent(Telemetry.ShiftEnterBannerShown);
        const response = await window.showInformationMessage(this.bannerMessage, ...this.bannerLabels);
        switch (response) {
            case this.bannerLabels[InteractiveShiftEnterLabelIndex.Yes]: {
                await this.enableInteractiveShiftEnter();
                break;
            }
            case this.bannerLabels[InteractiveShiftEnterLabelIndex.No]: {
                await this.disableInteractiveShiftEnter();
                break;
            }
            default: {
                // Disable for the current session.
                this.disabledInCurrentSession = true;
            }
        }
    }

    public async shouldShowBanner(): Promise<boolean> {
        const settings = this.configuration.getSettings();
        return Promise.resolve(
            this.isEnabled() && !this.disabledInCurrentSession && !settings.sendSelectionToInteractiveWindow
        );
    }

    @captureUsageTelemetry(Telemetry.DisableInteractiveShiftEnter)
    public async disableInteractiveShiftEnter(): Promise<void> {
        await this.configuration.updateSetting(
            'interactiveWindow.textEditor.executeSelection',
            false,
            undefined,
            ConfigurationTarget.Global
        );
        await this.disableBanner();
    }

    @captureUsageTelemetry(Telemetry.EnableInteractiveShiftEnter)
    public async enableInteractiveShiftEnter(): Promise<void> {
        await this.configuration.updateSetting(
            'interactiveWindow.textEditor.executeSelection',
            true,
            undefined,
            ConfigurationTarget.Global
        );
        await this.disableBanner();
    }

    private async disableBanner(): Promise<void> {
        await this.persistentState
            .createGlobalPersistentState<boolean>(InteractiveShiftEnterStateKeys.ShowBanner, false)
            .updateValue(false);
    }
}
