// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

const builder = require('./webpack.datascience-ui.config.builder');
module.exports = [builder.viewers, builder.ipywidgetsKernel, builder.ipywidgetsRenderer];
