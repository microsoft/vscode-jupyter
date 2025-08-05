// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// This code is required to initialize the common node API in the tests.
// We have different test environments,
// web and desktop (node), hence different ways to start the Jupyter Kernels.
// For local tests we will always assume we're running against desktop (node) environment.

// This file will be dynamically imported in mocha, see `.vscode-test.mjs`

import { initializeCommonNodeApi } from './common.node';

initializeCommonNodeApi();
