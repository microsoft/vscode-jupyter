# Query Jupyter server for the info about a dataframe
import json as _VSCODE_json
import builtins as _VSCODE_builtins
import re as _VSCODE_re

_VSCODE_torchSizePattern = _VSCODE_re.compile(r"torch.Size\(\[(\d+(?:, \d+)*)\]\)")

# Function to do our work. It will return the object
def _VSCODE_getVariableInfo(var):
    # Start out without the information
    result = {}
    result["shape"] = ""
    result["count"] = 0

    # Find shape and count if available
    if hasattr(var, "shape"):
        try:
            vartype = type(var)
            # Get a bit more restrictive with exactly what we want to count as a shape, since anything can define it
            if (
                isinstance(var.shape, tuple)
                or hasattr(vartype, "__name__")
                and vartype.__name__ == "EagerTensor"
            ):
                _VSCODE_shapeStr = str(var.shape)
                if (
                    len(_VSCODE_shapeStr) >= 3
                    and _VSCODE_shapeStr[0] == "("
                    and _VSCODE_shapeStr[-1] == ")"
                    and "," in _VSCODE_shapeStr
                ):
                    result["shape"] = _VSCODE_shapeStr
                elif _VSCODE_shapeStr.startswith("torch.Size"):
                    matches = _VSCODE_torchSizePattern.match(_VSCODE_shapeStr)
                    if matches:
                        result["shape"] = "(" + matches.group(1) + ")"
                del _VSCODE_shapeStr
        except TypeError:
            pass

    if hasattr(var, "__len__"):
        try:
            result["count"] = len(var)
        except TypeError:
            pass

    # return our json object as a string
    return _VSCODE_json.dumps(result)
