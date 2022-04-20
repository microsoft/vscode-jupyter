import { env } from 'vscode';

let originalProperty: PropertyDescriptor | undefined;

export function overrideTelemetrySettingForCi() {

    originalProperty = Object.getOwnPropertyDescriptor(env, 'isTelemetryEnabled');
    Object.defineProperty(env, 'isTelemetryEnabled', {
        get: function () {
            return true;
        }
    });
}

export function undoTelemetrySettingOverride() {
    if (originalProperty){
        Object.defineProperty(env, 'isTelemetryEnabled', originalProperty);
    }
}
