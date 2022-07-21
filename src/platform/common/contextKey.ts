import { ICommandManager } from './application/types';

/**
 * Utility case used to [setContext](https://code.visualstudio.com/api/extension-guides/command#using-a-custom-when-clause-context) for VS code state.
 */
export class ContextKey {
    public get value(): boolean | undefined {
        return this.lastValue;
    }
    private lastValue?: boolean;

    constructor(private name: string, private commandManager: ICommandManager) {}

    public async set(value: boolean): Promise<void> {
        if (this.lastValue === value) {
            return;
        }
        this.lastValue = value;
        await this.commandManager.executeCommand('setContext', this.name, this.lastValue);
    }
}
