// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export const ChatMime = 'application/vnd.vscode.chat_message';

export const chatStartupPythonCode = `
def __VSCODE_inject_module():

    def __VSCODE_call_function(function, callback, data=None):
        __VSCODE_send_chat_message__(function, data, callback=callback)

    def __VSCODE_send_chat_message__(function, data, callback):
        requests = {}
        try:
            requests = __VSCODE_send_chat_message__.__requests
        except Exception:
            __VSCODE_send_chat_message__.__requests = requests

        import uuid as __VSCODE_send_chat_message__uuid
        import IPython.display as __VSCODE_send_chat_message__ipython_display

        id = str(__VSCODE_send_chat_message__uuid.uuid4())
        requests[id] = callback
        data_is_none = data is None
        __VSCODE_send_chat_message__ipython_display.display({"${ChatMime}": data}, metadata={"id":id, "function": function, "dataIsNone": data_is_none}, raw=True)

        del __VSCODE_send_chat_message__ipython_display
        del __VSCODE_send_chat_message__uuid

    def __VSCODE_on_chat_message(id, data):
        requests = {}
        try:
            requests = __VSCODE_send_chat_message__.__requests
        except Exception:
            __VSCODE_send_chat_message__.__requests = requests

        if id in requests:
            requests[id](data)
            del requests[id]
        else:
            raise NotImplementedError(f"Callback not found for message {id}")

    import sys as __VSCODE_send_chat_message__sys
    import IPython as __VSCODE_send_chat_message__IPython
    chat = type(__VSCODE_send_chat_message__IPython)("chat")
    chat.send_message = __VSCODE_send_chat_message__
    chat.call_function = __VSCODE_call_function
    chat.__on_message = __VSCODE_on_chat_message
    __VSCODE_send_chat_message__sys.modules["vscode"] = type(__VSCODE_send_chat_message__IPython)("vscode")
    __VSCODE_send_chat_message__sys.modules["vscode"].chat = chat
    del __VSCODE_send_chat_message__sys
    del __VSCODE_send_chat_message__IPython


__VSCODE_inject_module()
del __VSCODE_inject_module
`;

const replacements: [toEscape: RegExp, replacement: string][] = [
    [new RegExp('\\\\', 'g'), '\\\\'],
    [new RegExp('"', 'g'), '\\"'],
    [new RegExp("'", 'g'), `\'`],
    [new RegExp('\\\b', 'g'), '\\b'],
    [new RegExp('\\f', 'g'), '\\f'],
    [new RegExp('\\n', 'g'), '\\n'],
    [new RegExp('\\r', 'g'), '\\r'],
    [new RegExp('\\t', 'g'), '\\t']
];

export function generatePythonCodeToInvokeCallback(requestId: string, response?: string): string {
    const escaped = escapeStringToEmbedInPythonCode(response);
    const value = typeof escaped === 'string' ? `"${escaped}"` : 'None';
    return `
import vscode as __vscode
try:
    __vscode.chat.__on_message('${requestId}', ${value})
finally:
    del __vscode
`;
}

export function escapeStringToEmbedInPythonCode(value: string | undefined): string | undefined {
    if (typeof value !== 'string') {
        return value;
    }
    for (const [toEscape, replacement] of replacements) {
        value = value.replace(toEscape, replacement);
    }
    return value;
}
