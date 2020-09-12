import { Event, Uri } from 'vscode';
import { PythonEnvironment } from '../pythonEnvironments/info';
import { GetInterpreterOptions } from './interpreterService';

export const IInterpreterService = Symbol('IInterpreterService');
export interface IInterpreterService {
    onDidChangeInterpreter: Event<void>;
    getInterpreters(resource?: Uri, options?: GetInterpreterOptions): Promise<PythonEnvironment[]>;
    getActiveInterpreter(resource?: Uri): Promise<PythonEnvironment | undefined>;
    getInterpreterDetails(pythonPath: string, resource?: Uri): Promise<undefined | PythonEnvironment>;
    initialize(): void;
}
