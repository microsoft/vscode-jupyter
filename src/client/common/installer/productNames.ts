// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { Product } from '../types';

// eslint-disable-next-line @typescript-eslint/naming-convention, no-underscore-dangle, id-blacklist, id-match
export const ProductNames = new Map<Product, string>();
ProductNames.set(Product.jupyter, 'jupyter');
ProductNames.set(Product.notebook, 'notebook');
ProductNames.set(Product.ipykernel, 'ipykernel');
ProductNames.set(Product.nbconvert, 'nbconvert');
ProductNames.set(Product.kernelspec, 'kernelspec');
ProductNames.set(Product.pandas, 'pandas');
