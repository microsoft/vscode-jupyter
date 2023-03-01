// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import * as fs from 'fs-extra';
import { Uri } from 'vscode';
import { extractRequireConfigFromWidgetEntry } from './baseIPyWidgetScriptManager';
import * as path from '../../../../platform/vscode-path/path';
import { EXTENSION_ROOT_DIR_FOR_TESTS } from '../../../../test/constants.node';

/* eslint-disable , @typescript-eslint/no-explicit-any */
suite('ipywidget - CDN', () => {
    [
        {
            file: 'beakerx',
            config: {
                beakerx: 'nbextensions/beakerx/index',
                'jupyter-js-widgets': 'nbextensions/jupyter-js-widgets/extension',
                '@jupyter-widgets/base': 'nbextensions/jupyter-js-widgets/extension',
                '@jupyter-widgets/controls': 'nbextensions/jupyter-js-widgets/extension'
            }
        },
        {
            file: 'bqplot',
            config: {
                bqplot: 'nbextensions/bqplot/index'
            }
        },
        {
            file: 'catboost',
            config: {
                'catboost-widget': 'nbextensions/catboost-widget/index'
            }
        },
        {
            file: 'ipytree',
            config: {
                ipytree: 'nbextensions/ipytree/index'
            }
        },
        {
            file: 'ipyvolume',
            config: {
                ipyvolume: 'nbextensions/ipyvolume/index',
                'jupyter-js-widgets': 'nbextensions/jupyter-js-widgets/extension'
            }
        },
        {
            file: 'jupyter-leaflet',
            config: {
                'jupyter-leaflet': 'nbextensions/jupyter-leaflet/index'
            }
        },
        {
            file: 'jupyter-matplotlib',
            config: {
                'jupyter-matplotlib': 'nbextensions/jupyter-matplotlib/index'
            }
        },
        {
            file: 'jupyter-threejs',
            config: {
                'jupyter-threejs': 'nbextensions/jupyter-threejs/index',
                three: 'nbextensions/jupyter-threejs/three'
            }
        },
        {
            file: 'nglview-js-widgets',
            config: {
                'nglview-js-widgets': 'nbextensions/nglview-js-widgets/index'
            }
        }
    ].forEach((item) => {
        test(`Extract require.js configuration mapping for ${item.file}`, async () => {
            const nbExtensionsFolder = path.join(
                EXTENSION_ROOT_DIR_FOR_TESTS,
                'src',
                'test',
                'datascience',
                'ipywidgets',
                'samples'
            );
            const file = path.join(nbExtensionsFolder, item.file, 'extension.js');
            const contents = fs.readFileSync(file).toString();
            const config = await extractRequireConfigFromWidgetEntry(Uri.file(nbExtensionsFolder), item.file, contents);
            // Convert values to strings for easy comparison.
            Object.keys(config!).forEach((key) => (config![key] = config![key].toString() as any));

            const expectedConfig: Record<string, any> = item.config;
            Object.keys(item.config).forEach((key) => {
                expectedConfig[key] = Uri.file(path.join(nbExtensionsFolder, expectedConfig[key])).toString();
            });
            assert.deepEqual(config, expectedConfig);
        });
    });
});
