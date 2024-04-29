// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { NotebookVariableProvider } from 'vscode';

export const IJupyterVariablesProvider = Symbol('IJupyterVariablesProvider');
export interface IJupyterVariablesProvider extends NotebookVariableProvider {}
