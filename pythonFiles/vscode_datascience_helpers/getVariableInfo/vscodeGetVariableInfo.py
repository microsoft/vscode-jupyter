def _VSCODE_getVariable(what_to_get, is_debugging, *args):
    # Query Jupyter server for the info about a dataframe
    import json as _VSCODE_json
    import builtins as _VSCODE_builtins

    maxStringLength = 50
    collectionTypes = ["list", "tuple", "set"]
    arrayPageSize = 50

    def truncateString(string):
        if _VSCODE_builtins.len(string) > maxStringLength:
            return string[: maxStringLength - 1] + "..."
        else:
            return string

    def getValue(variable, nested=False):
        if _VSCODE_builtins.type(variable) == _VSCODE_builtins.str:
            return f"'{truncateString(variable)}'"
        elif (
            _VSCODE_builtins.type(variable) == _VSCODE_builtins.int
            or _VSCODE_builtins.type(variable) == _VSCODE_builtins.float
        ):
            return _VSCODE_builtins.str(variable)
        elif _VSCODE_builtins.type(variable) == _VSCODE_builtins.list:
            return "[...]"
        elif _VSCODE_builtins.type(variable) == _VSCODE_builtins.tuple:
            return "(...)"
        elif _VSCODE_builtins.type(variable) == _VSCODE_builtins.set:
            return "{...}"
        elif _VSCODE_builtins.type(variable) == _VSCODE_builtins.dict:
            return "{...}"
        else:
            return truncateString(str(variable))

    def getPropertyNames(variable):
        props = []
        for prop in _VSCODE_builtins.dir(variable):
            if not prop.startswith("__"):
                props.append(prop)
        return props

    def getVariableDescription(variable):
        result = {}

        result["type"] = _VSCODE_builtins.type(variable).__name__
        if (
            _VSCODE_builtins.hasattr(variable, "__len__")
            and result["type"] in collectionTypes
        ):
            result["count"] = _VSCODE_builtins.len(variable)
        if _VSCODE_builtins.hasattr(variable, "__dict__"):
            result["properties"] = getPropertyNames(variable)
        elif _VSCODE_builtins.type(variable) == _VSCODE_builtins.dict:
            result["properties"] = _VSCODE_builtins.list(variable.keys())

        result["value"] = getValue(variable)
        return result

    def getChildProperty(root, propertyChain):
        variable = root
        for property in propertyChain:
            if _VSCODE_builtins.type(property) == _VSCODE_builtins.int:
                if _VSCODE_builtins.hasattr(variable, "__getitem__"):
                    variable = variable[property]
                elif _VSCODE_builtins.type(variable) == _VSCODE_builtins.set:
                    variable = _VSCODE_builtins.list(variable)[property]
                else:
                    return None
            elif _VSCODE_builtins.hasattr(variable, property):
                variable = getattr(variable, property)
            elif (
                _VSCODE_builtins.type(variable) == _VSCODE_builtins.dict
                and property in variable
            ):
                variable = variable[property]
            else:
                return None
        return variable

    ### Get info on variables at the root level
    def _VSCODE_getAllVariableDescriptions(varNames):
        variables = [
            {
                "name": varName,
                **getVariableDescription(globals()[varName]),
                "root": varName,
                "propertyChain": [],
            }
            for varName in varNames
            if varName in globals()
        ]

        if is_debugging:
            return _VSCODE_json.dumps(variables)
        else:
            return _VSCODE_builtins.print(_VSCODE_json.dumps(variables))

    ### Get info on children of a variable reached through the given property chain
    def _VSCODE_getAllChildrenDescriptions(rootVarName, propertyChain, startIndex):
        root = globals()[rootVarName]
        if root is None:
            return []

        parent = root
        if _VSCODE_builtins.len(propertyChain) > 0:
            parent = getChildProperty(root, propertyChain)

        children = []
        parentInfo = getVariableDescription(parent)
        if "count" in parentInfo:
            if parentInfo["count"] > 0:
                lastItem = _VSCODE_builtins.min(
                    parentInfo["count"], startIndex + arrayPageSize
                )
                range = _VSCODE_builtins.range(startIndex, lastItem)
                children = [
                    {
                        **getVariableDescription(getChildProperty(parent, [i])),
                        "name": str(i),
                        "root": rootVarName,
                        "propertyChain": propertyChain + [i],
                    }
                    for i in range
                ]
        elif "properties" in parentInfo:
            children = [
                {
                    **getVariableDescription(getChildProperty(parent, [prop])),
                    "name": prop,
                    "root": rootVarName,
                    "propertyChain": propertyChain + [prop],
                }
                for prop in parentInfo["properties"]
            ]

        if is_debugging:
            return _VSCODE_json.dumps(children)
        else:
            return _VSCODE_builtins.print(_VSCODE_json.dumps(children))

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
        elif what_to_get == "AllVariableDescriptions":
            return _VSCODE_getAllVariableDescriptions(*args)
        elif what_to_get == "AllChildrenDescriptions":
            return _VSCODE_getAllChildrenDescriptions(*args)
        else:
            return _VSCODE_getVariableTypes(*args)
    finally:
        del _VSCODE_json
        del _VSCODE_builtins
