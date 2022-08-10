// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IServiceContainer } from './types';

let container: IServiceContainer;
export function getServiceContainer() {
    return container;
}
export function setServiceContainer(serviceContainer: IServiceContainer) {
    container = serviceContainer;
}
