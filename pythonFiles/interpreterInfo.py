# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.

import json
import sys

obj = {}
obj["versionInfo"] = tuple(sys.version_info)
obj["sysPrefix"] = sys.prefix
obj["version"] = sys.version

print(json.dumps(obj))
