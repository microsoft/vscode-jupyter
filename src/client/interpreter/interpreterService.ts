import { injectable } from 'inversify';
import { Event, EventEmitter, Uri } from 'vscode';
import { PythonEnvironment } from '../pythonEnvironments/info';
import { IInterpreterService } from './contracts';

export type GetInterpreterOptions = {
    onSuggestion?: boolean;
};

@injectable()
export class InterpreterService implements IInterpreterService {
    public get onDidChangeInterpreter(): Event<void> {
        return new EventEmitter<void>().event;
    }
    public async getInterpreters(_resource?: Uri, _options?: GetInterpreterOptions): Promise<PythonEnvironment[]> {
        return [];
    }
    public async getActiveInterpreter(_resource?: Uri): Promise<PythonEnvironment | undefined> {
        return;
    }
    public async getInterpreterDetails(_pythonPath: string, _resource?: Uri): Promise<undefined | PythonEnvironment> {
        return;
    }
    public initialize(): void {
        //
    }
}
