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
    'AlmaLinux',
    'Alt',
    'Amazon',
    'Arch',
    'ArchLinux',
    'Asahi',
    'Asahi Linux',
    'Asianux',
    'Alpine',
    'Berry',
    'BlackArch',
    'BlackArch Linux',
    'Cent',
    'CentOS',
    'Clear',
    'Clear Linux',
    'Clear',
    'ClearOS',
    'Debian',
    'Elementary',
    'Endeavour',
    'EndeavourOS',
    'Easy',
    'EasyOS',
    'Fedora',
    'Fermi',
    'Fuduntu',
    'FreeBSD',
    'Gecko',
    'Gentoo',
    'Kali',
    'KDE',
    'Knoppix',
    'Kubuntu',
    'Linux',
    'LinuxMint',
    'Mageia',
    'Manjaro',
    'Mint',
    'Miracle',
    'MX',
    'MX Linux',
    'Navy',
    'Navy Linux',
    'Nitrux',
    'NixOS',
    'openSUSE',
    'Oracle',
    'Pop!_OS',
    'RasPiOS',
    'Raspbian',
    'Red Hat Enterprise Linux',
    'Red Hat Linux',
    'Red Hat',
    'Rocks',
    'Rocky',
    'Rocky Linux',
    'Rosa',
    'Scientific',
    'Scientific Linux',
    'Slackware',
    'SmartOS',
    'SUSE',
    'SUSE Linux',
    'SUSE Liberty Linux',
    'Ubuntu',
    'VZLinux',
    'Xubuntu',
    'Zorin'
];

const VERSION_REG = new RegExp(/^[0-9 .]*$/);
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

        splitLines(contents).forEach((line) => {
            const isId = line.toUpperCase().trim().startsWith('ID=');
            const isVersion = line.toUpperCase().trim().startsWith('VERSION_ID=');
            if (isId || isVersion) {
                const value = line
                    .substring(line.indexOf('=') + 1)
                    .replace(/"/g, '')
                    .toUpperCase();
                if (isId) {
                    distro.id = knownDistros.filter((known) => value.includes(known.toUpperCase())).join(', ');
                } else {
                    const versionNumber = parseFloat(value) || '';
                    distro.version_id = VERSION_REG.test(value) ? value : versionNumber.toString();
                }
            }
        });
    } catch (ex) {
        traceError(`Failed to read distro info`, ex);
    }

    return distro;
}
