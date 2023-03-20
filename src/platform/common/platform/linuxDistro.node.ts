// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from 'fs-extra';
import * as os from 'os';
import { splitLines } from '../helpers';
import { traceError } from '../../logging';
export type DistroInfo = {
    id: string;
    version_id: string;
};

const knownDistros = [
    'Mint',
    'Manjaro',
    'Ubuntu',
    'Fuduntu',
    'Kubuntu',
    'Xubuntu',
    'Elementary',
    'Fedora',
    'Zorin',
    'Debian',
    'MX Linux',
    'Pop!_OS',
    'Kali',
    'Raspbian',
    'CentOS',
    'Red Hat Enterprise Linux',
    'Red Hat Linux',
    'Red Hat',
    'openSUSE',
    'AlmaLinux',
    'Asianux',
    'ClearOS',
    'Fermi',
    'Miracle',
    'Oracle',   'Rocks',
    'Rocky',
    'Scientific',
    'Amazon',
    'Berry',
    'Gecko',
    'Rosa',

];

/**
 * Gets the linux distro information.
 * If we fail to get the information, we return an empty object.
 */
export async function getDistroInfo(): Promise<DistroInfo> {
    const distro = {
        id: '',
        version_id: ''
    };
    if (os.platform() === 'darwin' || os.platform() === 'win32') {
        return distro;
    }
    try {
        const contents = await fs.readFile('/etc/os-release', 'utf-8');
        const requiredKeys = new Set(Object.keys(distro));

        splitLines(contents).forEach((line) => {
            if (!line.includes('=')) {
                return;
            }
            const key = line.substring(0, line.indexOf('='));
            const value = line.substring(line.indexOf('=') + 1).replace(/"/g, '');
            if (key in distro) {
                (distro as Record<string, string>)[key] = value;
                requiredKeys.delete(key);
            }
        });
    } catch (ex) {
        traceError(`Failed to read distro info`, ex);
    }

    return distro;
}
