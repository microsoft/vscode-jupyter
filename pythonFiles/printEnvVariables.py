# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.

import os
import builtins
import json
import sys

builtins.print("e976ee50-99ed-4aba-9b6b-9dcd5634d07d")

# Special case PYTHONPATH to include sys.path
formatted_sys_path = os.pathsep.join(sys.path)
existing = f"{os.getenv('PYTHONPATH')};" if os.getenv("PYTHONPATH") else ""
os.environ["PYTHONPATH"] = f"{existing}{formatted_sys_path}"

# Dump results
builtins.print(json.dumps(dict(os.environ)))
