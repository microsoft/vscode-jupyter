// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { injectable } from 'inversify';
import { IExtensionSyncActivationService } from '../../activation/types';
import { registerErrorTelemetryUpdater } from '../../telemetry';
import { populateTelemetryWithErrorInfo } from './telemetry';

@injectable()
export class ErrorClassificationRegistration implements IExtensionSyncActivationService {
    activate(): void {
        registerErrorTelemetryUpdater(populateTelemetryWithErrorInfo);
    }
}
