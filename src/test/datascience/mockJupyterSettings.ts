import { JupyterSettings } from '../../client/common/configSettings';
import { IJupyterSettings } from '../../client/common/types';

export class MockJupyterSettings extends JupyterSettings {
    public fireChangeEvent() {
        this.fireChangeNotification();
    }

    public assign(partial: Partial<IJupyterSettings>) {
        Object.assign(this, { ...this, ...partial });
    }

    protected getPythonExecutable(v: string) {
        // Don't validate python paths during tests. On windows this can take 4 or 5 seconds
        // and slow down every test
        return v;
    }
}
