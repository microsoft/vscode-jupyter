// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { injectable, inject, named } from 'inversify';
import { Memento } from 'vscode';
import { IApplicationEnvironment, IApplicationShell } from '../common/application/types';
import { JVSC_EXTENSION_ID } from '../common/constants';
import { GLOBAL_MEMENTO, IExtensions, IMemento } from '../common/types';
import { PromiseChain } from '../common/utils/async';
import { Common } from '../common/utils/localize';

type ApiExtensionInfo = {
    extensionId: string;
    allowed: 'yes' | 'no';
}[];

const API_ACCESS_GLOBAL_KEY = 'JUPYTER_API_ACCESS_INFORMATION';
// Some publishers like our own `ms-tolsai` will always be allowed to access the API.
const TrustedExtensionPublishers = new Set([JVSC_EXTENSION_ID.split('.')[0]]);
// We dont want to expose this API to everyone, else we'll keep track of who has access to this.
// However, the user will still be prompted to grant these extensions access to the kernels..
const PublishersAllowedWithPrompts = new Set([JVSC_EXTENSION_ID.split('.')[0]]);

@injectable()
export class ApiAccessService {
    private readonly extensionAccess = new Map<string, Promise<{ extensionId: string; accessAllowed: boolean }>>();
    private promiseChain = new PromiseChain();
    constructor(
        @inject(IExtensions) private readonly extensions: IExtensions,
        @inject(IMemento) @named(GLOBAL_MEMENTO) private globalState: Memento,
        @inject(IApplicationShell) private appShell: IApplicationShell,
        @inject(IApplicationEnvironment) private appEnv: IApplicationEnvironment
    ) {}
    public async getAccessInformation(): Promise<{ extensionId: string; accessAllowed: boolean }> {
        const info = await this.extensions.determineExtensionFromCallStack();
        const publisherId = info.extensionId.split('.')[0];
        // For now, this API is only available in insiders.
        // This way, insider (exploratory API that provides insider/exploratory features are only available in insiders).
        if (this.appEnv.channel !== 'insiders') {
            return { extensionId: info.extensionId, accessAllowed: false };
        }
        // Some extensions like our own (stuff we publish for exploration) are always allowed to access the API.
        if (TrustedExtensionPublishers.has(publisherId)) {
            return { extensionId: info.extensionId, accessAllowed: true };
        }
        // We will always expose insiders as an opt in like VS Code.
        if (!PublishersAllowedWithPrompts.has(publisherId)) {
            // This cannot happen in the real world, unless someone has written an extension.
            // without testing it at all. Safe to display an error message.
            // This way extension author knows they need to contact us.
            void this.appShell.showErrorMessage(`Please contact the Jupyter Extension to get access to the Kernel API`);
            return { extensionId: info.extensionId, accessAllowed: false };
        }
        const extensionPermissions = this.globalState.get<ApiExtensionInfo | undefined>(API_ACCESS_GLOBAL_KEY);
        const extensionPermission = extensionPermissions?.find((item) => item.extensionId === info.extensionId);
        if (extensionPermission) {
            return { extensionId: info.extensionId, accessAllowed: extensionPermission.allowed === 'yes' };
        }
        if (this.extensionAccess.get(info.extensionId)) {
            return this.extensionAccess.get(info.extensionId)!;
        }

        const promise = (async () => {
            const msg = `Extension '${
                info.displayName
            }' is requesting access to your Jupyter kernels. Clicking '${Common.bannerLabelYes()}' allows this extension to execute code against all Jupyter Kernels on your behalf.`;
            const selection = await this.appShell.showInformationMessage(
                msg,
                { modal: true },
                Common.bannerLabelYes(),
                Common.bannerLabelNo()
            );
            const allow = selection === Common.bannerLabelYes();
            void this.promiseChain.chainFinally(async () => {
                let extensionPermissions = [...this.globalState.get<ApiExtensionInfo>(API_ACCESS_GLOBAL_KEY, [])];
                extensionPermissions = extensionPermissions.filter((item) => item.extensionId !== info.extensionId);
                extensionPermissions.push({ allowed: allow ? 'yes' : 'no', extensionId: info.extensionId });
                return this.globalState.update(API_ACCESS_GLOBAL_KEY, extensionPermissions);
            });
            return { extensionId: info.extensionId, accessAllowed: allow };
        })();

        this.extensionAccess.set(info.extensionId, promise);
        return promise;
    }
}
