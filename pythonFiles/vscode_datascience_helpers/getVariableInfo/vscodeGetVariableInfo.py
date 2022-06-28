def _VSCODE_getVariable(what_to_get, is_debugging, *args):

    # Query Jupyter server for the info about a dataframe
    import json as _VSCODE_json
    import builtins as _VSCODE_builtins

    # Function to do our work. It will return the object
    def _VSCODE_getVariableInfo(var):
        # Start out without the information
        result = {}
        result["shape"] = ""
        result["count"] = 0
        result["type"] = ""

        typeName = None
        try:
            vartype = type(var)
            if hasattr(vartype, "__name__"):
                result["type"] = typeName = vartype.__name__
        except TypeError:
            pass

        # Find shape and count if available
        if hasattr(var, "shape"):
            try:
                # Get a bit more restrictive with exactly what we want to count as a shape, since anything can define it
                if (
                    isinstance(var.shape, tuple)
                    or typeName is not None
                    and typeName == "EagerTensor"
                ):
                    _VSCODE_shapeStr = str(var.shape)
                    if (
                        len(_VSCODE_shapeStr) >= 3
                        and _VSCODE_shapeStr[0] == "("
                        and _VSCODE_shapeStr[-1] == ")"
                        and "," in _VSCODE_shapeStr
                    ):
                        result["shape"] = _VSCODE_shapeStr
                    elif _VSCODE_shapeStr.startswith("torch.Size(["):
                        result["shape"] = "(" + _VSCODE_shapeStr[12:-2] + ")"
                    del _VSCODE_shapeStr
            except TypeError:
                pass

        if hasattr(var, "__len__"):
            try:
                result["count"] = len(var)
            except TypeError:
                pass

        # return our json object as a string
        if is_debugging:
            return _VSCODE_json.dumps(result)
        else:
            return _VSCODE_builtins.print(_VSCODE_json.dumps(result))

    def _VSCODE_getVariableProperties(var, listOfAttributes):
        result = {
            attr: repr(getattr(var, attr))
            for attr in listOfAttributes
            if hasattr(var, attr)
        }
        if is_debugging:
            return _VSCODE_json.dumps(result)
        else:
            return _VSCODE_builtins.print(_VSCODE_json.dumps(result))

    def _VSCODE_getVariableTypes(varnames):
        # Map with key: varname and value: vartype
        result = {}
        for name in varnames:
            try:
                vartype = type(globals()[name])
                if hasattr(vartype, "__name__"):
                    result[name] = vartype.__name__
            except TypeError:
                pass
        if is_debugging:
            return _VSCODE_json.dumps(result)
        else:
            return _VSCODE_builtins.print(_VSCODE_json.dumps(result))

    try:
        if what_to_get == "properties":
            return _VSCODE_getVariableProperties(*args)
        elif what_to_get == "info":
            return _VSCODE_getVariableInfo(*args)
        else:
            return _VSCODE_getVariableTypes(*args)
    finally:
        del _VSCODE_json
        del _VSCODE_builtins
