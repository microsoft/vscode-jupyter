// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { PlatformService } from '../../../platform/common/platform/platformService.node';
import { OSType } from '../../../platform/common/utils/platform';

use(chaiAsPromised);

// eslint-disable-next-line
suite('PlatformService', () => {
    const osType = getOSType();

    test('isWindows', async () => {
        const expected = osType === OSType.Windows;
        const svc = new PlatformService();
        const result = svc.isWindows;

        expect(result).to.be.equal(expected, 'invalid value');
    });

    test('isMac', async () => {
        const expected = osType === OSType.OSX;
        const svc = new PlatformService();
        const result = svc.isMac;

        expect(result).to.be.equal(expected, 'invalid value');
    });

    test('isLinux', async () => {
        const expected = osType === OSType.Linux;
        const svc = new PlatformService();
        const result = svc.isLinux;

        expect(result).to.be.equal(expected, 'invalid value');
    });
});

function getOSType(platform: string = process.platform): OSType {
    if (/^win/.test(platform)) {
        return OSType.Windows;
    } else if (/^darwin/.test(platform)) {
        return OSType.OSX;
    } else if (/^linux/.test(platform)) {
        return OSType.Linux;
    } else {
        return OSType.Unknown;
    }
}
