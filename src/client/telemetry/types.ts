// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { IEventNamePropertyMapping } from '../telemetry/index';
import { EventName } from './constants';

export type EditorLoadTelemetry = IEventNamePropertyMapping[EventName.EDITOR_LOAD];

export type LinterTrigger = 'auto' | 'save';

export type LintingTelemetry = IEventNamePropertyMapping[EventName.LINTING];

export type PythonInterpreterTelemetry = IEventNamePropertyMapping[EventName.PYTHON_INTERPRETER];
export type CodeExecutionTelemetry = IEventNamePropertyMapping[EventName.EXECUTION_CODE];
export type DebuggerTelemetry = IEventNamePropertyMapping[EventName.DEBUGGER];
export type ImportNotebook = {
    scope: 'command';
};
export const IImportTracker = Symbol('IImportTracker');
export interface IImportTracker {}
