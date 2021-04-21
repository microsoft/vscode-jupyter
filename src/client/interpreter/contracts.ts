import { Event, Uri } from 'vscode';
import { PythonEnvironment } from '../pythonEnvironments/info';

export const IInterpreterService = Symbol.for('IInterpreterService');
export interface IInterpreterService {
    onDidChangeInterpreter: Event<void>;
    getInterpreters(resource?: Uri): Promise<PythonEnvironment[]>;
    getActiveInterpreter(resource?: Uri): Promise<PythonEnvironment | undefined>;
    getInterpreterDetails(pythonPath: string, resource?: Uri): Promise<undefined | PythonEnvironment>;
}
