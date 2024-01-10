def _VSCODE_getVariable(what_to_get, is_debugging, *args):
    # Query Jupyter server for the info about a dataframe
    import json as _VSCODE_json
    import builtins as _VSCODE_builtins

    maxStringLength = 50

    def truncateString(value):
        if builtins.len(value) > maxStringLength:
            return value[: maxStringLength - 1] + "..."
        else:
            return value

    def getValue(variable, nested=False):
        if _VSCODE_builtins.type(variable) == str:
            return truncateString(variable)
        elif (
            _VSCODE_builtins.type(variable) == int
            or _VSCODE_builtins.type(variable) == float
        ):
            return str(variable)
        elif _VSCODE_builtins.type(variable) == list:
            return "[...]"
        elif _VSCODE_builtins.type(variable) == tuple:
            return "(...)"
        elif _VSCODE_builtins.type(variable) == set:
            return "{...}"
        elif _VSCODE_builtins.type(variable) == dict:
            return "{...}"
        else:
            return truncateString(str(variable))

    def getPropertyNames(variable):
        props = []
        for prop in builtins.dir(variable):
            if not prop.startswith("__"):
                props.append(prop)
        return props

    def getChildProperty(root, propertyChain):
        variable = root
        for property in propertyChain:
            if _VSCODE_builtins.type(property) == int:
                if _VSCODE_builtins.hasattr(variable, "__getitem__"):
                    variable = variable[property]
                elif _VSCODE_builtins.type(variable) == set:
                    variable = list(variable)[property]
                else:
                    return None
            elif _VSCODE_builtins.hasattr(variable, property):
                variable = getattr(variable, property)
            elif _VSCODE_builtins.type(variable) == dict and property in variable:
                variale = variable[property]
            else:
                return None
        return variable

    def _VSCODE_getVariableDescription(rootVarName, propertyChain=[]):
        result = {}
        root = globals()[rootVarName]
        variable = root
        if len(propertyChain) > 0:
            variable = getChildProperty(root, propertyChain)

        if variable is not None:
            result["type"] = _VSCODE_builtins.type(variable).__name__
            if _VSCODE_builtins.hasattr(variable, "__len__"):
                result["len"] = _VSCODE_builtins.len(variable)
            if _VSCODE_builtins.hasattr(variable, "__dict__"):
                result["properties"] = getPropertyNames(variable)
            elif _VSCODE_builtins.type(variable) == dict:
                result["properties"] = list(variable.keys())

        result["value"] = getValue(variable)
        if is_debugging:
            return _VSCODE_json.dumps(result)
        else:
            return _VSCODE_builtins.print(_VSCODE_json.dumps(result))

    # Function to do our work. It will return the object
    def _VSCODE_getVariableInfo(var):
        # Start out without the information
        result = {}
        result["shape"] = ""
        result["count"] = 0
        result["type"] = ""

        typeName = None
        try:
            vartype = _VSCODE_builtins.type(var)
            if _VSCODE_builtins.hasattr(vartype, "__name__"):
                result["type"] = typeName = vartype.__name__
        except TypeError:
            pass

        # Find shape and count if available
        if _VSCODE_builtins.hasattr(var, "shape"):
            try:
                # Get a bit more restrictive with exactly what we want to count as a shape, since anything can define it
                if (
                    _VSCODE_builtins.isinstance(var.shape, _VSCODE_builtins.tuple)
                    or typeName is not None
                    and typeName == "EagerTensor"
                ):
                    _VSCODE_shapeStr = _VSCODE_builtins.str(var.shape)
                    if (
                        _VSCODE_builtins.len(_VSCODE_shapeStr) >= 3
                        and _VSCODE_shapeStr[0] == "("
                        and _VSCODE_shapeStr[-1] == ")"
                        and "," in _VSCODE_shapeStr
                    ):
                        result["shape"] = _VSCODE_shapeStr
                    elif _VSCODE_shapeStr.startswith("torch.Size(["):
                        result["shape"] = "(" + _VSCODE_shapeStr[12:-2] + ")"
                    del _VSCODE_shapeStr
            except _VSCODE_builtins.TypeError:
                pass

        if _VSCODE_builtins.hasattr(var, "__len__"):
            try:
                result["count"] = _VSCODE_builtins.len(var)
            except _VSCODE_builtins.TypeError:
                pass

        # return our json object as a string
        if is_debugging:
            return _VSCODE_json.dumps(result)
        else:
            return _VSCODE_builtins.print(_VSCODE_json.dumps(result))

    def _VSCODE_getVariableProperties(var, listOfAttributes):
        result = {
            attr: _VSCODE_builtins.repr(_VSCODE_builtins.getattr(var, attr))
            for attr in listOfAttributes
            if _VSCODE_builtins.hasattr(var, attr)
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
                vartype = _VSCODE_builtins.type(globals()[name])
                if _VSCODE_builtins.hasattr(vartype, "__name__"):
                    result[name] = vartype.__name__
            except _VSCODE_builtins.TypeError:
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
        elif what_to_get == "description":
            return _VSCODE_getVariableDescription(*args)
        else:
            return _VSCODE_getVariableTypes(*args)
    finally:
        del _VSCODE_json
        del _VSCODE_builtins
