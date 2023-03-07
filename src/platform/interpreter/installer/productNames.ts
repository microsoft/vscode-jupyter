// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Product } from './types';

export const ProductNames = new Map<Product, string>();
ProductNames.set(Product.jupyter, 'jupyter');
ProductNames.set(Product.notebook, 'notebook');
ProductNames.set(Product.ipykernel, 'ipykernel');
ProductNames.set(Product.nbconvert, 'nbconvert');
ProductNames.set(Product.kernelspec, 'kernelspec');
ProductNames.set(Product.pandas, 'pandas');
ProductNames.set(Product.pip, 'pip');
ProductNames.set(Product.ensurepip, 'ensurepip');
