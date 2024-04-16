# Query Jupyter server for the info about a dataframe
from collections import namedtuple
from importlib.util import find_spec
import json

maxStringLength = 1000
collectionTypes = ["list", "tuple", "set"]
arrayPageSize = 50


def truncateString(variable):
    string = repr(variable)
    if len(string) > maxStringLength:
        sizeInfo = "\n\nLength: " + str(len(variable)) if type(variable) == str else ""
        return string[: maxStringLength - 1] + "..." + sizeInfo
    else:
        return string


DisplayOptions = namedtuple("DisplayOptions", ["width", "max_columns"])


def set_pandas_display_options(display_options=None):
    if find_spec("pandas") is not None:
        try:
            import pandas as _VSCODE_PD

            original_display = DisplayOptions(
                width=_VSCODE_PD.options.display.width,
                max_columns=_VSCODE_PD.options.display.max_columns,
            )

            if display_options:
                _VSCODE_PD.options.display.max_columns = display_options.max_columns
                _VSCODE_PD.options.display.width = display_options.width
            else:
                _VSCODE_PD.options.display.max_columns = 100
                _VSCODE_PD.options.display.width = 1000

            return original_display
        except ImportError:
            pass
        finally:
            del _VSCODE_PD


def getValue(variable):
    original_display = None
    if type(variable).__name__ == "DataFrame" and find_spec("pandas") is not None:
        original_display = set_pandas_display_options()

    try:
        return truncateString(variable=variable)
    finally:
        if original_display:
            set_pandas_display_options(original_display)


def getPropertyNames(variable):
    props = []
    privateProps = []
    for prop in dir(variable):
        if not prop.startswith("_"):
            props.append(prop)
        elif not prop.startswith("__"):
            privateProps.append(prop)
    return props + privateProps


def getFullType(varType):
    module = ""
    if hasattr(varType, "__module__") and varType.__module__ != "builtins":
        module = varType.__module__ + "."
    if hasattr(varType, "__qualname__"):
        return module + varType.__qualname__
    elif hasattr(varType, "__name__"):
        return module + varType.__name__


typesToExclude = ["module", "function", "method", "class", "type"]


def getVariableDescription(variable):
    result = {}

    varType = type(variable)
    result["type"] = getFullType(varType)
    if hasattr(varType, "__mro__"):
        result["interfaces"] = [getFullType(t) for t in varType.__mro__]

    if hasattr(variable, "__len__") and result["type"] in collectionTypes:
        result["count"] = len(variable)

    result["hasNamedChildren"] = hasattr(variable, "__dict__") or type(variable) == dict

    result["value"] = getValue(variable)
    return result


def getChildProperty(root, propertyChain):
    try:
        variable = root
        for property in propertyChain:
            if type(property) == int:
                if hasattr(variable, "__getitem__"):
                    variable = variable[property]
                elif type(variable) == set:
                    variable = list(variable)[property]
                else:
                    return None
            elif hasattr(variable, property):
                variable = getattr(variable, property)
            elif type(variable) == dict and property in variable:
                variable = variable[property]
            else:
                return None
    except Exception:
        return None

    return variable


### Get info on variables at the root level
def _VSCODE_getVariableDescriptions(varNames):
    variables = [
        {
            "name": varName,
            **getVariableDescription(globals()[varName]),
            "root": varName,
            "propertyChain": [],
            "language": "python",
        }
        for varName in varNames
        if varName in globals()
        and type(globals()[varName]).__name__ not in typesToExclude
    ]

    return json.dumps(variables)


### Get info on children of a variable reached through the given property chain
def _VSCODE_getAllChildrenDescriptions(rootVarName, propertyChain, startIndex):
    root = globals()[rootVarName]
    if root is None:
        return []

    parent = root
    if len(propertyChain) > 0:
        parent = getChildProperty(root, propertyChain)

    children = []
    parentInfo = getVariableDescription(parent)
    if "count" in parentInfo:
        if parentInfo["count"] > 0:
            lastItem = min(parentInfo["count"], startIndex + arrayPageSize)
            indexRange = range(startIndex, lastItem)
            children = [
                {
                    **getVariableDescription(getChildProperty(parent, [i])),
                    "name": str(i),
                    "root": rootVarName,
                    "propertyChain": propertyChain + [i],
                    "language": "python",
                }
                for i in indexRange
            ]
    elif parentInfo["hasNamedChildren"]:
        childrenNames = []
        if hasattr(parent, "__dict__"):
            childrenNames = getPropertyNames(parent)
        elif type(parent) == dict:
            childrenNames = list(parent.keys())

        children = []
        for prop in childrenNames:
            child_property = getChildProperty(parent, [prop])
            if (
                child_property is not None
                and type(child_property).__name__ not in typesToExclude
            ):
                child = {
                    **getVariableDescription(child_property),
                    "name": prop,
                    "root": rootVarName,
                    "propertyChain": propertyChain + [prop],
                }
                children.append(child)

    return json.dumps(children)


def _VSCODE_getVariableSummary(variable):
    if variable is None:
        return None
    # check if the variable is a dataframe
    if type(variable).__name__ == "DataFrame" and find_spec("pandas") is not None:
        import io

        buffer = io.StringIO()
        variable.info(buf=buffer)
        return json.dumps({"summary": buffer.getvalue()})

    return None
