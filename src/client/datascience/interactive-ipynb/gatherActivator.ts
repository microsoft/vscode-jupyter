import { inject, injectable } from 'inversify';
import { IExtensionSingleActivationService } from '../../activation/types';
import { IExtensions } from '../../common/types';
import { noop } from '../../common/utils/misc';

// We can delete this file when we deprecate the webview notebook editor.
// The reason we need it is that, vscode can't tell when we open a webview,
// so we need to forcefully activate it in the notebook editor use case.
// Every other case (native notebook, custom editor, IW) has a related event
// where the gather extension is activated.
@injectable()
export class GatherActivator implements IExtensionSingleActivationService {
    constructor(@inject(IExtensions) private extensions: IExtensions) {}
    public async activate() {
        const gather = this.extensions.getExtension('ms-python.gather');
        if (gather) {
            gather.activate().then(noop, noop);
        }
    }
}
