// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Product } from './types';

// Licensed under the MIT License.
export function translateProductToModule(product: Product): string {
    switch (product) {
        case Product.jupyter:
            return 'jupyter';
        case Product.notebook:
            return 'notebook';
        case Product.pandas:
            return 'pandas';
        case Product.ipykernel:
            return 'ipykernel';
        case Product.nbconvert:
            return 'nbconvert';
        case Product.kernelspec:
            return 'kernelspec';
        case Product.pip:
            return 'pip';
        case Product.ensurepip:
            return 'ensurepip';
        default: {
            throw new Error(`Product ${product} cannot be installed as a Python Module.`);
        }
    }
}
