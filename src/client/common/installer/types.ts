// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { Uri } from 'vscode';
import { PythonEnvironment } from '../../pythonEnvironments/info';
import { Product, Resource } from '../types';

export type InterpreterUri = Resource | PythonEnvironment;
export const IProductPathService = Symbol('IProductPathService');
export interface IProductPathService {
    getExecutableNameFromSettings(product: Product, resource?: Uri): string;
    isExecutableAModule(product: Product, resource?: Uri): Boolean;
}
