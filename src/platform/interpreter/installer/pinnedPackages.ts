// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Product } from './types';
import { translateProductToModule } from './utils';

const jupyterNotebookModuleNames = [
    translateProductToModule(Product.jupyter),
    translateProductToModule(Product.notebook)
];
export function getPinnedPackages(installer: 'conda' | 'pip', moduleName: string): string[] {
    if (!jupyterNotebookModuleNames.includes(moduleName)) {
        return [];
    }
    // https://github.com/microsoft/vscode-jupyter/issues/12775
    // https://github.com/jupyter/jupyter_client/issues/926
    // Pin dependencies for jupyter-client and pyzmq as a work around.
    if (installer === 'pip') {
        return ['jupyter-client<8', 'pyzmq<25'];
    } else {
        return ['jupyter_client<8', 'pyzmq<25'];
    }
}
