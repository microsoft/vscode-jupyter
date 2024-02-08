// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export const ChatMime = 'application/vnd.vscode.chat_message';

export const chatStartupPythonCode = `
def __VSCODE_inject_module():

    def __VSCODE_send_chat_message__(function, data, callback):
        requests = {}
        try:
            requests = __VSCODE_send_chat_message__.__requests
        except Exception:
            __VSCODE_send_chat_message__.__requests = requests

        import uuid as __VSCODE_send_chat_message__uuid
        import IPython.display as __VSCODE_send_chat_message__ipython_display
        import json as __VSCODE_send_chat_message__json
        import datetime as __VSCODE_send_chat_message__datetime
        ISO8601 = "%Y-%m-%dT%H:%M:%S.%f"

        class DateTimeEncoder(__VSCODE_send_chat_message__json.JSONEncoder):
            def default(self, obj):
                if isinstance(obj, __VSCODE_send_chat_message__datetime):
                    # return obj.isoformat()
                    return obj.strftime(ISO8601)
                return super().default(obj)

        # Convert object to JSON
        id = str(__VSCODE_send_chat_message__uuid.uuid4())
        json_data = __VSCODE_send_chat_message__json.dumps(data, cls=DateTimeEncoder)
        requests[id] = callback
        __VSCODE_send_chat_message__ipython_display.display({"${ChatMime}": json_data}, metadata={"id":id, "function": function}, raw=True)

        del __VSCODE_send_chat_message__ipython_display
        del __VSCODE_send_chat_message__json
        del __VSCODE_send_chat_message__datetime

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
    chat.__on_message = __VSCODE_on_chat_message
    __VSCODE_send_chat_message__sys.modules["vscode"] = type(__VSCODE_send_chat_message__IPython)("vscode")
    __VSCODE_send_chat_message__sys.modules["vscode"].chat = chat
    del __VSCODE_send_chat_message__sys
    del __VSCODE_send_chat_message__IPython


__VSCODE_inject_module()
del __VSCODE_inject_module
`;
